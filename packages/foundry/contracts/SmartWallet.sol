//SPDX-License-Identifier: MIT
pragma solidity >=0.8.24 <0.9.0;

import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/**
 * @title SmartWallet
 * @notice A single-passkey smart contract wallet designed for USDC on Base
 * @notice Supports guardian recovery and facilitator-paid gas
 * @notice All user actions are passkey-signed meta transactions
 * @author BuidlGuidl
 */
contract SmartWallet is Initializable {
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    // ============ Core State ============
    
    // Single nonce for replay protection
    uint256 public nonce;

    // Single passkey public key
    bytes32 public qx;
    bytes32 public qy;
    bytes32 public credentialIdHash;

    // ============ Guardian & Recovery State ============
    
    // Guardian address (facilitator by default, can trigger recovery)
    address public guardian;
    
    // Withdraw address for recovery (set by user, funds go here on recovery)
    address public withdrawAddress;

    // ============ Events ============
    
    event MetaExecuted(address indexed target, uint256 value, bytes data);
    event GuardianChanged(address indexed oldGuardian, address indexed newGuardian);
    event WithdrawAddressSet(address indexed withdrawAddress);
    event GuardianRecoveryExecuted(address indexed withdrawAddress, address indexed token, uint256 amount);

    // ============ Errors ============
    
    error ExecutionFailed();
    error InvalidSignature();
    error ExpiredSignature();
    error NotGuardian();
    error NoWithdrawAddress();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the wallet with a passkey and guardian
     * @param _guardian The address of the guardian (facilitator)
     * @param _qx The x-coordinate of the passkey public key
     * @param _qy The y-coordinate of the passkey public key
     * @param _credentialIdHash Hash of the WebAuthn credential ID
     */
    function initialize(
        address _guardian,
        bytes32 _qx,
        bytes32 _qy,
        bytes32 _credentialIdHash
    ) external initializer {
        guardian = _guardian;
        qx = _qx;
        qy = _qy;
        credentialIdHash = _credentialIdHash;
    }

    // ============ Modifiers ============
    
    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    // ============ Helper Functions ============

    /**
     * @notice Derive a deterministic address from passkey public key coordinates
     */
    function getPasskeyAddress(bytes32 _qx, bytes32 _qy) public pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(_qx, _qy)))));
    }

    /**
     * @notice Get the passkey address for this wallet
     */
    function getPasskeyAddress() public view returns (address) {
        return getPasskeyAddress(qx, qy);
    }

    /**
     * @notice Internal function to verify passkey signature
     */
    function _verifySignature(
        bytes memory challenge,
        uint256 deadline,
        WebAuthn.WebAuthnAuth calldata auth
    ) internal {
        if (block.timestamp > deadline) revert ExpiredSignature();
        if (!WebAuthn.verify(challenge, auth, qx, qy)) revert InvalidSignature();
        nonce++;
    }

    // ============ Meta Transaction Execution ============

    /**
     * @notice Execute multiple calls via passkey meta transaction
     * @dev This is the main execution function - use batch of 1 for single calls
     */
    function metaBatchExec(
        Call[] calldata calls,
        uint256 deadline,
        WebAuthn.WebAuthnAuth calldata auth
    ) external returns (bytes[] memory results) {
        bytes memory challenge = abi.encodePacked(keccak256(abi.encodePacked(
            block.chainid,
            address(this),
            keccak256(abi.encode(calls)),
            nonce,
            deadline
        )));

        _verifySignature(challenge, deadline, auth);

        results = new bytes[](calls.length);
        for (uint256 i = 0; i < calls.length; i++) {
            (bool success, bytes memory returnData) = calls[i].target.call{value: calls[i].value}(calls[i].data);
            if (!success) revert ExecutionFailed();
            emit MetaExecuted(calls[i].target, calls[i].value, calls[i].data);
            results[i] = returnData;
        }
    }

    // ============ Meta Transaction Settings Functions ============

    /**
     * @notice Set the withdraw address via passkey meta transaction
     * @param _withdrawAddress The address to send funds on recovery
     * @param deadline Signature expiration timestamp
     * @param auth WebAuthn authentication data
     */
    function metaSetWithdrawAddress(
        address _withdrawAddress,
        uint256 deadline,
        WebAuthn.WebAuthnAuth calldata auth
    ) external {
        bytes memory challenge = abi.encodePacked(keccak256(abi.encodePacked(
            block.chainid,
            address(this),
            bytes4(keccak256("setWithdrawAddress(address)")),
            _withdrawAddress,
            nonce,
            deadline
        )));

        _verifySignature(challenge, deadline, auth);
        
        withdrawAddress = _withdrawAddress;
        emit WithdrawAddressSet(_withdrawAddress);
    }

    /**
     * @notice Change the guardian address via passkey meta transaction
     * @param _newGuardian The new guardian address
     * @param deadline Signature expiration timestamp
     * @param auth WebAuthn authentication data
     */
    function metaSetGuardian(
        address _newGuardian,
        uint256 deadline,
        WebAuthn.WebAuthnAuth calldata auth
    ) external {
        bytes memory challenge = abi.encodePacked(keccak256(abi.encodePacked(
            block.chainid,
            address(this),
            bytes4(keccak256("setGuardian(address)")),
            _newGuardian,
            nonce,
            deadline
        )));

        _verifySignature(challenge, deadline, auth);
        
        address oldGuardian = guardian;
        guardian = _newGuardian;
        emit GuardianChanged(oldGuardian, _newGuardian);
    }

    // ============ Guardian Functions ============

    /**
     * @notice Guardian recovery - immediately send all funds to withdraw address
     * @param token The ERC20 token to withdraw (address(0) for ETH)
     */
    function guardianRecover(address token) external onlyGuardian {
        if (withdrawAddress == address(0)) revert NoWithdrawAddress();
        
        uint256 amount;
        if (token == address(0)) {
            // Withdraw ETH (shouldn't have any, but just in case)
            amount = address(this).balance;
            if (amount > 0) {
                (bool success, ) = withdrawAddress.call{value: amount}("");
                if (!success) revert ExecutionFailed();
            }
        } else {
            // Withdraw ERC20
            amount = IERC20(token).balanceOf(address(this));
            if (amount > 0) {
                bool success = IERC20(token).transfer(withdrawAddress, amount);
                if (!success) revert ExecutionFailed();
            }
        }
        
        emit GuardianRecoveryExecuted(withdrawAddress, token, amount);
    }

    // ============ Receive ETH ============
    
    receive() external payable {}
}
