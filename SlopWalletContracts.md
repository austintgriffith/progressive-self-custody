# SlopWallet Smart Contracts

This document contains the three core smart contracts that make up the SlopWallet system—a progressive self-custody solution using passkeys (WebAuthn) for secure, gasless transactions.

---

## Overview

| Contract | Purpose |
|----------|---------|
| **SmartWallet** | The main wallet contract that holds assets and executes transactions |
| **Factory** | Deploys new SmartWallet instances using minimal proxies (clones) |
| **Clones** | Library implementing EIP-1167 minimal proxy pattern |

---

## 1. SmartWallet

The core wallet contract that users interact with. It supports:

- **Owner-controlled execution** – The wallet owner can execute arbitrary calls via `exec()` and `batchExec()`
- **Passkey authentication** – Users can register WebAuthn passkeys and execute gasless meta-transactions via `metaExecPasskey()`
- **ERC-1271 signatures** – Enables off-chain message signing for dApps
- **Asset receiving** – Supports receiving ETH, ERC-721 NFTs, and ERC-1155 tokens

### Key Features

- **Passkey Management**: Owner can add/remove passkeys using `addPasskey()` and `removePasskey()`
- **Deterministic Passkey Addresses**: Passkeys are identified by deriving an address from their public key coordinates (qx, qy)
- **Credential ID Lookup**: Maps WebAuthn credential IDs to passkey addresses for easy login flow
- **Replay Protection**: Uses per-passkey nonces and chain ID in signed messages
- **Deadline Expiration**: Meta-transactions include expiration timestamps for security

```solidity
//SPDX-License-Identifier: MIT
pragma solidity >=0.8.24 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
// import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol"; // Only needed for EOA metaExec
import "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/**
 * @title SmartWallet
 * @notice A minimal smart contract wallet that allows an owner to execute arbitrary calls
 * @notice Supports ERC-1271 signature validation for off-chain signing
 * @author BuidlGuidl
 */
contract SmartWallet is Ownable, IERC1271, Initializable {
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    // Nonce for replay protection (keyed by passkey address)
    mapping(address => uint256) public nonces;

    // Passkey public key storage (keyed by derived address)
    // If passkeyQx[addr] != 0, then addr is a registered passkey
    mapping(address => bytes32) public passkeyQx;
    mapping(address => bytes32) public passkeyQy;

    // Track if any passkey has been created (controls frontend CTA)
    bool public passkeyCreated;

    // Map credentialId hash to passkey address for login lookup
    mapping(bytes32 => address) public credentialIdToAddress;

    event Executed(address indexed target, uint256 value, bytes data);
    event PasskeyAdded(address indexed passkeyAddress, bytes32 qx, bytes32 qy);
    event PasskeyRemoved(address indexed passkeyAddress);
    event MetaExecuted(address indexed passkey, address indexed target, uint256 value, bytes data);

    error NotAuthorized();
    error ExecutionFailed();
    error InvalidSignature();
    error ExpiredSignature();
    error PasskeyAlreadyRegistered();
    error PasskeyNotRegistered();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() Ownable(address(1)) {
        _disableInitializers();
    }

    /**
     * @notice Initialize the wallet with an owner (called by Factory on clone deployment)
     * @param _owner The address of the wallet owner
     */
    function initialize(address _owner) external initializer {
        _transferOwnership(_owner);
    }

    /**
     * @notice Derive a deterministic address from passkey public key coordinates
     * @param qx The x-coordinate of the passkey public key
     * @param qy The y-coordinate of the passkey public key
     * @return The derived address
     */
    function getPasskeyAddress(bytes32 qx, bytes32 qy) public pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(qx, qy)))));
    }

    /**
     * @notice Add a passkey
     * @param qx The x-coordinate of the passkey public key
     * @param qy The y-coordinate of the passkey public key
     * @param credentialIdHash The keccak256 hash of the WebAuthn credentialId for login lookup
     */
    function addPasskey(bytes32 qx, bytes32 qy, bytes32 credentialIdHash) external onlyOwner {
        address passkeyAddr = getPasskeyAddress(qx, qy);
        if (passkeyQx[passkeyAddr] != bytes32(0)) revert PasskeyAlreadyRegistered();

        passkeyQx[passkeyAddr] = qx;
        passkeyQy[passkeyAddr] = qy;
        credentialIdToAddress[credentialIdHash] = passkeyAddr;

        // Set flag on first passkey
        if (!passkeyCreated) {
            passkeyCreated = true;
        }

        emit PasskeyAdded(passkeyAddr, qx, qy);
    }

    /**
     * @notice Remove a passkey
     * @param qx The x-coordinate of the passkey public key
     * @param qy The y-coordinate of the passkey public key
     */
    function removePasskey(bytes32 qx, bytes32 qy) external onlyOwner {
        address passkeyAddr = getPasskeyAddress(qx, qy);
        if (passkeyQx[passkeyAddr] == bytes32(0)) revert PasskeyNotRegistered();

        delete passkeyQx[passkeyAddr];
        delete passkeyQy[passkeyAddr];

        emit PasskeyRemoved(passkeyAddr);
    }

    /**
     * @notice Check if an address is a registered passkey
     * @param addr The address to check
     * @return True if the address is a registered passkey
     */
    function isPasskey(address addr) public view returns (bool) {
        return passkeyQx[addr] != bytes32(0);
    }

    /**
     * @notice Get passkey info by credentialId hash (for login flow)
     * @param credentialIdHash The keccak256 hash of the WebAuthn credentialId
     * @return passkeyAddr The derived passkey address (address(0) if not registered)
     * @return qx The x-coordinate of the passkey public key
     * @return qy The y-coordinate of the passkey public key
     */
    function getPasskeyByCredentialId(bytes32 credentialIdHash) external view returns (
        address passkeyAddr,
        bytes32 qx,
        bytes32 qy
    ) {
        passkeyAddr = credentialIdToAddress[credentialIdHash];
        if (passkeyAddr != address(0)) {
            qx = passkeyQx[passkeyAddr];
            qy = passkeyQy[passkeyAddr];
        }
        // If passkeyAddr == address(0), passkey not registered
    }

    /**
     * @notice Execute a call to any contract 
     * @param target The address to call
     * @param value The ETH value to send
     * @param data The calldata to send
     * @return result The return data from the call
     */
    function exec(address target, uint256 value, bytes calldata data) 
        external 
        onlyOwner 
        returns (bytes memory result) 
    {
        (bool success, bytes memory returnData) = target.call{value: value}(data);
        if (!success) revert ExecutionFailed();
        
        emit Executed(target, value, data);
        return returnData;
    }

    /**
     * @notice Execute multiple calls atomically (for wallet_sendCalls / EIP-5792)
     * @param calls Array of calls to execute
     * @return results Array of return data from each call
     */
    function batchExec(Call[] calldata calls) 
        external 
        onlyOwner 
        returns (bytes[] memory results) 
    {
        results = new bytes[](calls.length);
        for (uint256 i = 0; i < calls.length; i++) {
            (bool success, bytes memory returnData) = calls[i].target.call{value: calls[i].value}(calls[i].data);
            if (!success) revert ExecutionFailed();
            emit Executed(calls[i].target, calls[i].value, calls[i].data);
            results[i] = returnData;
        }
    }

    /**
     * @notice Execute a call via passkey meta transaction (R1/WebAuthn signature)
     * @dev Anyone can relay this transaction on behalf of a registered passkey
     * @param target The address to call
     * @param value The ETH value to send
     * @param data The calldata to send
     * @param qx The x-coordinate of the passkey public key
     * @param qy The y-coordinate of the passkey public key
     * @param deadline The timestamp after which the signature expires
     * @param auth The WebAuthn authentication assertion data
     * @return result The return data from the call
     */
    function metaExecPasskey(
        address target,
        uint256 value,
        bytes calldata data,
        bytes32 qx,
        bytes32 qy,
        uint256 deadline,
        WebAuthn.WebAuthnAuth calldata auth
    ) external returns (bytes memory result) {
        // Check signature hasn't expired
        if (block.timestamp > deadline) revert ExpiredSignature();

        // Derive the passkey address and verify it's registered
        address passkeyAddr = getPasskeyAddress(qx, qy);
        if (passkeyQx[passkeyAddr] != qx || passkeyQy[passkeyAddr] != qy) revert PasskeyNotRegistered();

        // Build the challenge that was signed (includes chainId for cross-chain replay protection)
        bytes memory challenge = abi.encodePacked(keccak256(abi.encodePacked(
            block.chainid,
            address(this),
            target,
            value,
            data,
            nonces[passkeyAddr],
            deadline
        )));

        // Verify the WebAuthn signature
        if (!WebAuthn.verify(challenge, auth, qx, qy)) revert InvalidSignature();

        // Increment nonce
        nonces[passkeyAddr]++;

        // Execute the call
        (bool success, bytes memory returnData) = target.call{value: value}(data);
        if (!success) revert ExecutionFailed();

        emit MetaExecuted(passkeyAddr, target, value, data);
        return returnData;
    }

    /**
     * @notice Execute multiple calls via passkey meta transaction (R1/WebAuthn signature)
     * @dev Anyone can relay this transaction on behalf of a registered passkey
     * @param calls Array of calls to execute
     * @param qx The x-coordinate of the passkey public key
     * @param qy The y-coordinate of the passkey public key
     * @param deadline The timestamp after which the signature expires
     * @param auth The WebAuthn authentication assertion data
     * @return results Array of return data from each call
     */
    function metaBatchExecPasskey(
        Call[] calldata calls,
        bytes32 qx,
        bytes32 qy,
        uint256 deadline,
        WebAuthn.WebAuthnAuth calldata auth
    ) external returns (bytes[] memory results) {
        // Check signature hasn't expired
        if (block.timestamp > deadline) revert ExpiredSignature();

        // Derive the passkey address and verify it's registered
        address passkeyAddr = getPasskeyAddress(qx, qy);
        if (passkeyQx[passkeyAddr] != qx || passkeyQy[passkeyAddr] != qy) revert PasskeyNotRegistered();

        // Build the challenge that was signed (includes chainId for cross-chain replay protection)
        bytes memory challenge = abi.encodePacked(keccak256(abi.encodePacked(
            block.chainid,
            address(this),
            keccak256(abi.encode(calls)),
            nonces[passkeyAddr],
            deadline
        )));

        // Verify the WebAuthn signature
        if (!WebAuthn.verify(challenge, auth, qx, qy)) revert InvalidSignature();

        // Increment nonce
        nonces[passkeyAddr]++;

        // Execute all calls
        results = new bytes[](calls.length);
        for (uint256 i = 0; i < calls.length; i++) {
            (bool success, bytes memory returnData) = calls[i].target.call{value: calls[i].value}(calls[i].data);
            if (!success) revert ExecutionFailed();
            emit MetaExecuted(passkeyAddr, calls[i].target, calls[i].value, calls[i].data);
            results[i] = returnData;
        }
    }

    /**
     * @notice ERC-1271 signature validation (ECDSA only)
     * @dev Validates that the signature was created by the owner.
     *      Passkeys use WebAuthn signatures and should use metaExecPasskey instead.
     * @param hash The hash of the data that was signed
     * @param signature The signature bytes (ECDSA signature)
     * @return magicValue The magic value 0x1626ba7e if valid, 0xffffffff otherwise
     */
    function isValidSignature(bytes32 hash, bytes memory signature) 
        external 
        view 
        returns (bytes4 magicValue) 
    {
        // Recover the signer from the signature
        address signer = ECDSA.recover(hash, signature);
        
        // Check if signer is owner
        if (signer == owner()) {
            return IERC1271.isValidSignature.selector; // 0x1626ba7e
        }
        
        return 0xffffffff; // Invalid signature
    }

    /**
     * @notice Allow the wallet to receive ETH
     */
    receive() external payable {}

    /**
     * @notice ERC-721 receiver hook to allow receiving NFTs via safeTransferFrom
     */
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    /**
     * @notice ERC-1155 receiver hook to allow receiving tokens via safeTransferFrom
     */
    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    /**
     * @notice ERC-1155 batch receiver hook to allow receiving tokens via safeBatchTransferFrom
     */
    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }
}
```

---

## 2. Factory

A factory contract that deploys SmartWallet instances as minimal proxy clones (EIP-1167). This pattern significantly reduces deployment gas costs since each wallet is just a small proxy that delegates to a shared implementation.

### Key Features

- **Gas Efficient**: Each wallet clone costs ~45k gas vs ~2M+ for full contract deployment
- **Deterministic Addresses**: Uses CREATE2 so wallet addresses can be computed before deployment
- **Owner + Salt**: Combines owner address with a salt for unique CREATE2 derivation (allows multiple wallets per owner)

```solidity
//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "./SmartWallet.sol";
import "./Clones.sol";

/**
 * @title Factory
 * @notice A factory contract that deploys SmartWallet clones using EIP-1167 minimal proxies
 * @dev Uses CREATE2 for deterministic addresses with minimal gas costs per deployment
 * @author BuidlGuidl
 */
contract Factory {
    /// @notice The SmartWallet implementation contract that all clones delegate to
    address public immutable implementation;

    event WalletCreated(address indexed owner, address indexed wallet, bytes32 salt);

    /**
     * @notice Initialize the factory with a SmartWallet implementation address
     * @param _implementation The address of the deployed SmartWallet implementation
     */
    constructor(address _implementation) {
        implementation = _implementation;
    }

    /**
     * @notice Deploy a new SmartWallet clone for a given owner using CREATE2
     * @param owner The owner of the new SmartWallet
     * @param salt A salt value for CREATE2 (allows multiple wallets per owner)
     * @return wallet The address of the deployed SmartWallet clone
     */
    function createWallet(address owner, bytes32 salt) external returns (address wallet) {
        // Combine owner and salt for unique CREATE2 salt
        bytes32 finalSalt = keccak256(abi.encodePacked(owner, salt));
        
        // Deploy minimal proxy clone using CREATE2
        wallet = Clones.cloneDeterministic(implementation, finalSalt);
        
        // Initialize the clone with the owner
        SmartWallet(payable(wallet)).initialize(owner);
        
        emit WalletCreated(owner, wallet, salt);
    }

    /**
     * @notice Compute the address of a SmartWallet clone before deployment
     * @param owner The owner of the SmartWallet
     * @param salt The salt value that will be used for CREATE2
     * @return The predicted address of the SmartWallet clone
     */
    function getWalletAddress(address owner, bytes32 salt) external view returns (address) {
        bytes32 finalSalt = keccak256(abi.encodePacked(owner, salt));
        return Clones.predictDeterministicAddress(implementation, finalSalt, address(this));
    }
}
```

---

## 3. Clones

A library implementing the EIP-1167 minimal proxy pattern. Minimal proxies are tiny contracts (~45 bytes) that forward all calls to an implementation contract using `DELEGATECALL`.

### How It Works

The minimal proxy bytecode:
```
3d602d80600a3d3981f3363d3d373d3d3d363d73<implementation>5af43d82803e903d91602b57fd5bf3
```

When called, this bytecode:
1. Copies the incoming calldata
2. Forwards it to the implementation via `DELEGATECALL`
3. Returns or reverts with the result

```solidity
//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

/**
 * @title Clones
 * @notice EIP-1167 Minimal Proxy (Clone) library
 * @dev Deploys minimal proxy contracts that delegate all calls to an implementation
 * @author BuidlGuidl (based on OpenZeppelin Clones)
 */
library Clones {
    /**
     * @dev A clone instance deployment failed.
     */
    error CloneCreationFailed();

    /**
     * @notice Deploys a clone of `implementation` using CREATE2 with `salt`
     * @param implementation The address of the implementation contract
     * @param salt The salt for CREATE2
     * @return instance The address of the deployed clone
     */
    function cloneDeterministic(address implementation, bytes32 salt) internal returns (address instance) {
        // EIP-1167 minimal proxy bytecode
        // 3d602d80600a3d3981f3363d3d373d3d3d363d73<implementation>5af43d82803e903d91602b57fd5bf3
        assembly {
            // Store the bytecode in memory
            let ptr := mload(0x40)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(ptr, 0x14), shl(0x60, implementation))
            mstore(add(ptr, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            
            // Deploy using CREATE2
            instance := create2(0, ptr, 0x37, salt)
        }
        if (instance == address(0)) {
            revert CloneCreationFailed();
        }
    }

    /**
     * @notice Predicts the address of a clone deployed with `cloneDeterministic`
     * @param implementation The address of the implementation contract
     * @param salt The salt for CREATE2
     * @param deployer The address that will deploy the clone (usually address(this))
     * @return predicted The predicted address of the clone
     */
    function predictDeterministicAddress(
        address implementation,
        bytes32 salt,
        address deployer
    ) internal pure returns (address predicted) {
        // First compute the init code hash
        bytes32 initCodeHash;
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(ptr, 0x14), shl(0x60, implementation))
            mstore(add(ptr, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            initCodeHash := keccak256(ptr, 0x37)
        }
        
        // CREATE2 address = keccak256(0xff ++ deployer ++ salt ++ initCodeHash)[12:]
        predicted = address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff),
            deployer,
            salt,
            initCodeHash
        )))));
    }
}
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         User / dApp                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                          Factory                                 │
│  • createWallet(owner, salt) → deploys clone                    │
│  • getWalletAddress(owner, salt) → predicts address             │
└─────────────────────────────────────────────────────────────────┘
                              │
                    uses Clones library
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              SmartWallet Clone (Minimal Proxy)                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Storage (unique per clone)                                │   │
│  │  • owner                                                  │   │
│  │  • nonces[passkeyAddr]                                    │   │
│  │  • passkeyQx[addr], passkeyQy[addr]                      │   │
│  │  • credentialIdToAddress[hash]                            │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                     DELEGATECALL                                 │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ SmartWallet Implementation (shared logic)                 │   │
│  │  • exec(), batchExec()                                    │   │
│  │  • metaExecPasskey(), metaBatchExecPasskey()             │   │
│  │  • addPasskey(), removePasskey()                          │   │
│  │  • isValidSignature() (ERC-1271)                          │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Security Considerations

1. **Initialization**: The implementation contract disables initializers in its constructor to prevent front-running attacks
2. **Replay Protection**: Meta-transactions include chain ID, wallet address, and nonces
3. **Deadline Expiration**: All meta-transactions have expiration timestamps
4. **WebAuthn Verification**: Uses OpenZeppelin's audited WebAuthn library for passkey signature verification

