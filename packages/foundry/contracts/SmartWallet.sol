//SPDX-License-Identifier: MIT
pragma solidity >=0.8.24 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/**
 * @title SmartWallet
 * @notice A progressive self-custody smart contract wallet with passkey authentication
 * @notice Supports guardian recovery, deadman's switch, and facilitator-paid gas
 * @author BuidlGuidl
 */
contract SmartWallet is Ownable, IERC1271, Initializable {
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    // ============ Core State ============
    
    // Nonce for replay protection (keyed by passkey address)
    mapping(address => uint256) public nonces;

    // Passkey public key storage (keyed by derived address)
    mapping(address => bytes32) public passkeyQx;
    mapping(address => bytes32) public passkeyQy;

    // Track if any passkey has been created
    bool public passkeyCreated;

    // Map credentialId hash to passkey address for login lookup
    mapping(bytes32 => address) public credentialIdToAddress;

    // ============ Guardian & Recovery State ============
    
    // Guardian address (facilitator by default, can trigger deadman recovery)
    address public guardian;
    
    // Withdraw address for recovery (set by user, funds go here on deadman execution)
    address public withdrawAddress;
    
    // Recovery password hash: keccak256(abi.encodePacked(walletAddress, password))
    bytes32 public recoveryPasswordHash;
    
    // Last activity timestamp (updated on every meta-tx)
    uint256 public lastActivityTimestamp;
    
    // Deadman's switch delay (default 24 hours)
    uint256 public deadmanDelay;
    
    // When deadman was triggered (0 = not triggered)
    uint256 public deadmanTriggeredAt;

    // ============ Events ============
    
    event Executed(address indexed target, uint256 value, bytes data);
    event PasskeyAdded(address indexed passkeyAddress, bytes32 qx, bytes32 qy);
    event PasskeyRemoved(address indexed passkeyAddress);
    event MetaExecuted(address indexed passkey, address indexed target, uint256 value, bytes data);
    event GuardianChanged(address indexed oldGuardian, address indexed newGuardian);
    event WithdrawAddressSet(address indexed withdrawAddress);
    event RecoveryPasswordHashSet();
    event DeadmanTriggered(uint256 executionTime);
    event DeadmanCancelled();
    event DeadmanExecuted(address indexed withdrawAddress, uint256 amount);

    // ============ Errors ============
    
    error NotAuthorized();
    error ExecutionFailed();
    error InvalidSignature();
    error ExpiredSignature();
    error PasskeyAlreadyRegistered();
    error PasskeyNotRegistered();
    error NotGuardian();
    error InvalidPasswordHash();
    error DeadmanNotTriggered();
    error DeadmanAlreadyTriggered();
    error DeadmanDelayNotPassed();
    error NoWithdrawAddress();

    // ============ Constants ============
    
    uint256 public constant DEFAULT_DEADMAN_DELAY = 24 hours;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() Ownable(address(1)) {
        _disableInitializers();
    }

    /**
     * @notice Initialize the wallet with an owner and guardian
     * @param _owner The address of the wallet owner
     * @param _guardian The address of the guardian (facilitator)
     */
    function initialize(address _owner, address _guardian) external initializer {
        _transferOwnership(_owner);
        guardian = _guardian;
        deadmanDelay = DEFAULT_DEADMAN_DELAY;
        lastActivityTimestamp = block.timestamp;
    }

    /**
     * @notice Initialize the wallet with an owner (guardian defaults to owner)
     * @param _owner The address of the wallet owner
     */
    function initialize(address _owner) external initializer {
        _transferOwnership(_owner);
        guardian = _owner;
        deadmanDelay = DEFAULT_DEADMAN_DELAY;
        lastActivityTimestamp = block.timestamp;
    }

    // ============ Modifiers ============
    
    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }
    
    modifier updateActivity() {
        lastActivityTimestamp = block.timestamp;
        _;
    }

    // ============ Passkey Functions ============

    /**
     * @notice Derive a deterministic address from passkey public key coordinates
     */
    function getPasskeyAddress(bytes32 qx, bytes32 qy) public pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(qx, qy)))));
    }

    /**
     * @notice Add a passkey
     */
    function addPasskey(bytes32 qx, bytes32 qy, bytes32 credentialIdHash) external onlyOwner {
        address passkeyAddr = getPasskeyAddress(qx, qy);
        if (passkeyQx[passkeyAddr] != bytes32(0)) revert PasskeyAlreadyRegistered();

        passkeyQx[passkeyAddr] = qx;
        passkeyQy[passkeyAddr] = qy;
        credentialIdToAddress[credentialIdHash] = passkeyAddr;

        if (!passkeyCreated) {
            passkeyCreated = true;
        }

        emit PasskeyAdded(passkeyAddr, qx, qy);
    }

    /**
     * @notice Remove a passkey
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
     */
    function isPasskey(address addr) public view returns (bool) {
        return passkeyQx[addr] != bytes32(0);
    }

    /**
     * @notice Get passkey info by credentialId hash
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
    }

    // ============ Execution Functions ============

    /**
     * @notice Execute a call to any contract (owner only)
     */
    function exec(address target, uint256 value, bytes calldata data) 
        external 
        onlyOwner 
        updateActivity
        returns (bytes memory result) 
    {
        (bool success, bytes memory returnData) = target.call{value: value}(data);
        if (!success) revert ExecutionFailed();
        
        emit Executed(target, value, data);
        return returnData;
    }

    /**
     * @notice Execute multiple calls atomically (owner only)
     */
    function batchExec(Call[] calldata calls) 
        external 
        onlyOwner 
        updateActivity
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
     * @notice Execute a call via passkey meta transaction
     */
    function metaExecPasskey(
        address target,
        uint256 value,
        bytes calldata data,
        bytes32 qx,
        bytes32 qy,
        uint256 deadline,
        WebAuthn.WebAuthnAuth calldata auth
    ) external updateActivity returns (bytes memory result) {
        if (block.timestamp > deadline) revert ExpiredSignature();

        address passkeyAddr = getPasskeyAddress(qx, qy);
        if (passkeyQx[passkeyAddr] != qx || passkeyQy[passkeyAddr] != qy) revert PasskeyNotRegistered();

        bytes memory challenge = abi.encodePacked(keccak256(abi.encodePacked(
            block.chainid,
            address(this),
            target,
            value,
            data,
            nonces[passkeyAddr],
            deadline
        )));

        if (!WebAuthn.verify(challenge, auth, qx, qy)) revert InvalidSignature();

        nonces[passkeyAddr]++;

        (bool success, bytes memory returnData) = target.call{value: value}(data);
        if (!success) revert ExecutionFailed();

        emit MetaExecuted(passkeyAddr, target, value, data);
        return returnData;
    }

    /**
     * @notice Execute multiple calls via passkey meta transaction
     */
    function metaBatchExecPasskey(
        Call[] calldata calls,
        bytes32 qx,
        bytes32 qy,
        uint256 deadline,
        WebAuthn.WebAuthnAuth calldata auth
    ) external updateActivity returns (bytes[] memory results) {
        if (block.timestamp > deadline) revert ExpiredSignature();

        address passkeyAddr = getPasskeyAddress(qx, qy);
        if (passkeyQx[passkeyAddr] != qx || passkeyQy[passkeyAddr] != qy) revert PasskeyNotRegistered();

        bytes memory challenge = abi.encodePacked(keccak256(abi.encodePacked(
            block.chainid,
            address(this),
            keccak256(abi.encode(calls)),
            nonces[passkeyAddr],
            deadline
        )));

        if (!WebAuthn.verify(challenge, auth, qx, qy)) revert InvalidSignature();

        nonces[passkeyAddr]++;

        results = new bytes[](calls.length);
        for (uint256 i = 0; i < calls.length; i++) {
            (bool success, bytes memory returnData) = calls[i].target.call{value: calls[i].value}(calls[i].data);
            if (!success) revert ExecutionFailed();
            emit MetaExecuted(passkeyAddr, calls[i].target, calls[i].value, calls[i].data);
            results[i] = returnData;
        }
    }

    // ============ Guardian & Recovery Functions ============

    /**
     * @notice Set the withdraw address (owner only, or via meta-tx)
     * @param _withdrawAddress The address to send funds on recovery
     */
    function setWithdrawAddress(address _withdrawAddress) external onlyOwner {
        withdrawAddress = _withdrawAddress;
        emit WithdrawAddressSet(_withdrawAddress);
    }

    /**
     * @notice Set the recovery password hash (owner only, or via meta-tx)
     * @param _recoveryPasswordHash keccak256(abi.encodePacked(walletAddress, password))
     */
    function setRecoveryPasswordHash(bytes32 _recoveryPasswordHash) external onlyOwner {
        recoveryPasswordHash = _recoveryPasswordHash;
        emit RecoveryPasswordHashSet();
    }

    /**
     * @notice Change the guardian address (owner only)
     * @param _newGuardian The new guardian address
     */
    function setGuardian(address _newGuardian) external onlyOwner {
        address oldGuardian = guardian;
        guardian = _newGuardian;
        emit GuardianChanged(oldGuardian, _newGuardian);
    }

    /**
     * @notice Change the deadman delay (owner only)
     * @param _delay The new delay in seconds
     */
    function setDeadmanDelay(uint256 _delay) external onlyOwner {
        deadmanDelay = _delay;
    }

    /**
     * @notice Trigger the deadman switch with password verification (guardian only)
     * @param password The plain text password to verify
     */
    function triggerDeadmanWithPassword(string calldata password) external onlyGuardian {
        if (deadmanTriggeredAt != 0) revert DeadmanAlreadyTriggered();
        if (withdrawAddress == address(0)) revert NoWithdrawAddress();
        
        // Verify password hash
        bytes32 computedHash = keccak256(abi.encodePacked(address(this), password));
        if (computedHash != recoveryPasswordHash) revert InvalidPasswordHash();
        
        deadmanTriggeredAt = block.timestamp;
        emit DeadmanTriggered(block.timestamp + deadmanDelay);
    }

    /**
     * @notice Cancel the deadman switch (passkey owner can cancel via meta-tx)
     */
    function cancelDeadman() external onlyOwner {
        if (deadmanTriggeredAt == 0) revert DeadmanNotTriggered();
        
        deadmanTriggeredAt = 0;
        emit DeadmanCancelled();
    }

    /**
     * @notice Execute the deadman switch - send all funds to withdraw address (guardian only)
     * @param token The ERC20 token to withdraw (address(0) for ETH)
     */
    function executeDeadman(address token) external onlyGuardian {
        if (deadmanTriggeredAt == 0) revert DeadmanNotTriggered();
        if (block.timestamp < deadmanTriggeredAt + deadmanDelay) revert DeadmanDelayNotPassed();
        if (withdrawAddress == address(0)) revert NoWithdrawAddress();
        
        uint256 amount;
        if (token == address(0)) {
            // Withdraw ETH
            amount = address(this).balance;
            (bool success, ) = withdrawAddress.call{value: amount}("");
            if (!success) revert ExecutionFailed();
        } else {
            // Withdraw ERC20
            amount = IERC20(token).balanceOf(address(this));
            bool success = IERC20(token).transfer(withdrawAddress, amount);
            if (!success) revert ExecutionFailed();
        }
        
        emit DeadmanExecuted(withdrawAddress, amount);
    }

    /**
     * @notice Get time remaining until deadman can be executed
     * @return remaining Seconds remaining (0 if can execute now, type(uint256).max if not triggered)
     */
    function getDeadmanTimeRemaining() external view returns (uint256 remaining) {
        if (deadmanTriggeredAt == 0) return type(uint256).max;
        
        uint256 executionTime = deadmanTriggeredAt + deadmanDelay;
        if (block.timestamp >= executionTime) return 0;
        
        return executionTime - block.timestamp;
    }

    // ============ ERC-1271 Signature Validation ============

    /**
     * @notice ERC-1271 signature validation (ECDSA only)
     */
    function isValidSignature(bytes32 hash, bytes memory signature) 
        external 
        view 
        returns (bytes4 magicValue) 
    {
        address signer = ECDSA.recover(hash, signature);
        
        if (signer == owner()) {
            return IERC1271.isValidSignature.selector;
        }
        
        return 0xffffffff;
    }

    // ============ Receive Hooks ============

    receive() external payable {}

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

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
