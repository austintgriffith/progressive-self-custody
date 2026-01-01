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
    
    /// @notice Default guardian address (facilitator) for new wallets
    address public defaultGuardian;

    event WalletCreated(address indexed owner, address indexed wallet, address indexed guardian, bytes32 salt);
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
     * @notice Deploy a new SmartWallet clone for a given owner using CREATE2
     * @param owner The owner of the new SmartWallet
     * @param salt A salt value for CREATE2 (allows multiple wallets per owner)
     * @return wallet The address of the deployed SmartWallet clone
     */
    function createWallet(address owner, bytes32 salt) external returns (address wallet) {
        return createWalletWithGuardian(owner, defaultGuardian, salt);
    }

    /**
     * @notice Deploy a new SmartWallet clone with a custom guardian
     * @param owner The owner of the new SmartWallet
     * @param guardian The guardian address for recovery
     * @param salt A salt value for CREATE2 (allows multiple wallets per owner)
     * @return wallet The address of the deployed SmartWallet clone
     */
    function createWalletWithGuardian(address owner, address guardian, bytes32 salt) public returns (address wallet) {
        // Combine owner and salt for unique CREATE2 salt
        bytes32 finalSalt = keccak256(abi.encodePacked(owner, salt));
        
        // Deploy minimal proxy clone using CREATE2
        wallet = Clones.cloneDeterministic(implementation, finalSalt);
        
        // Initialize the clone with the owner and guardian
        SmartWallet(payable(wallet)).initialize(owner, guardian);
        
        emit WalletCreated(owner, wallet, guardian, salt);
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
