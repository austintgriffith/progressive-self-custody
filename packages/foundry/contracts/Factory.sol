//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "./SmartWallet.sol";
import "./Clones.sol";

/**
 * @title Factory
 * @notice A factory contract that deploys SmartWallet clones using EIP-1167 minimal proxies
 * @notice Only supports passkey-based wallet creation
 * @dev Uses CREATE2 for deterministic addresses with minimal gas costs per deployment
 * @author BuidlGuidl
 */
contract Factory {
    /// @notice The SmartWallet implementation contract that all clones delegate to
    address public immutable implementation;
    
    /// @notice Default guardian address (facilitator) for new wallets
    address public defaultGuardian;

    event WalletCreated(address indexed passkeyAddress, address indexed wallet, address indexed guardian, bytes32 salt);
    event DefaultGuardianChanged(address indexed oldGuardian, address indexed newGuardian);

    /**
     * @notice Initialize the factory with a SmartWallet implementation address
     * @param _implementation The address of the deployed SmartWallet implementation
     * @param _defaultGuardian The default guardian (facilitator) for new wallets
     */
    constructor(address _implementation, address _defaultGuardian) {
        implementation = _implementation;
        defaultGuardian = _defaultGuardian;
    }

    /**
     * @notice Deploy a new SmartWallet clone with a passkey
     * @dev The wallet address is deterministic based on passkey coordinates and salt
     * @param salt A salt value for CREATE2 (allows multiple wallets per passkey)
     * @param qx The x-coordinate of the passkey public key
     * @param qy The y-coordinate of the passkey public key
     * @param credentialIdHash Hash of the WebAuthn credential ID
     * @return wallet The address of the deployed SmartWallet clone
     */
    function createWallet(
        bytes32 salt,
        bytes32 qx,
        bytes32 qy,
        bytes32 credentialIdHash
    ) external returns (address wallet) {
        // Derive passkey address from coordinates
        address passkeyAddress = SmartWallet(payable(implementation)).getPasskeyAddress(qx, qy);
        
        // Combine passkey address and salt for unique CREATE2 salt
        bytes32 finalSalt = keccak256(abi.encodePacked(passkeyAddress, salt));
        
        // Deploy minimal proxy clone using CREATE2
        wallet = Clones.cloneDeterministic(implementation, finalSalt);
        
        // Initialize the clone with passkey and default guardian
        SmartWallet(payable(wallet)).initialize(defaultGuardian, qx, qy, credentialIdHash);
        
        emit WalletCreated(passkeyAddress, wallet, defaultGuardian, salt);
    }

    /**
     * @notice Compute the address of a SmartWallet clone before deployment
     * @param qx The x-coordinate of the passkey public key
     * @param qy The y-coordinate of the passkey public key
     * @param salt The salt value that will be used for CREATE2
     * @return The predicted address of the SmartWallet clone
     */
    function getWalletAddress(bytes32 qx, bytes32 qy, bytes32 salt) external view returns (address) {
        address passkeyAddress = SmartWallet(payable(implementation)).getPasskeyAddress(qx, qy);
        bytes32 finalSalt = keccak256(abi.encodePacked(passkeyAddress, salt));
        return Clones.predictDeterministicAddress(implementation, finalSalt, address(this));
    }

    /**
     * @notice Update the default guardian for new wallets (only callable by current default guardian)
     * @param _newGuardian The new default guardian address
     */
    function setDefaultGuardian(address _newGuardian) external {
        require(msg.sender == defaultGuardian, "Only guardian can change");
        address oldGuardian = defaultGuardian;
        defaultGuardian = _newGuardian;
        emit DefaultGuardianChanged(oldGuardian, _newGuardian);
    }
}
