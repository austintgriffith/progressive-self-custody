//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Example
 * @notice A sample application contract that accepts USDC payments
 * @notice Demonstrates how SmartWallet users can interact with dApps via passkey signatures
 * @author BuidlGuidl
 */
contract Example is Ownable {
    // USDC token address (set in constructor for the target chain)
    IERC20 public immutable usdc;
    
    // Total payments received
    uint256 public totalPaymentsReceived;
    
    // Payments per user
    mapping(address => uint256) public userPayments;

    // Events
    event PaymentReceived(address indexed from, uint256 amount, uint256 timestamp);
    event FundsWithdrawn(address indexed to, uint256 amount);

    // Errors
    error InvalidAmount();
    error InsufficientAllowance();
    error TransferFailed();
    error WithdrawFailed();

    /**
     * @notice Initialize with USDC token address
     * @param _usdc The USDC token contract address
     */
    constructor(address _usdc) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
    }

    /**
     * @notice Pay USDC to this contract
     * @dev User must approve this contract to spend their USDC first
     * @param amount The amount of USDC to pay (in USDC decimals, usually 6)
     */
    function payUSDC(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        
        // Check allowance
        uint256 allowance = usdc.allowance(msg.sender, address(this));
        if (allowance < amount) revert InsufficientAllowance();
        
        // Transfer USDC from sender to this contract
        bool success = usdc.transferFrom(msg.sender, address(this), amount);
        if (!success) revert TransferFailed();
        
        // Update state
        totalPaymentsReceived += amount;
        userPayments[msg.sender] += amount;
        
        emit PaymentReceived(msg.sender, amount, block.timestamp);
    }

    /**
     * @notice Get a user's total payments
     * @param user The user address to check
     * @return The total amount paid by this user
     */
    function getUserPayments(address user) external view returns (uint256) {
        return userPayments[user];
    }

    /**
     * @notice Withdraw collected USDC (owner only)
     * @param to The address to send USDC to
     * @param amount The amount to withdraw (0 = all)
     */
    function withdraw(address to, uint256 amount) external onlyOwner {
        uint256 balance = usdc.balanceOf(address(this));
        uint256 withdrawAmount = amount == 0 ? balance : amount;
        
        if (withdrawAmount > balance) revert InvalidAmount();
        
        bool success = usdc.transfer(to, withdrawAmount);
        if (!success) revert WithdrawFailed();
        
        emit FundsWithdrawn(to, withdrawAmount);
    }

    /**
     * @notice Get the contract's USDC balance
     * @return The current USDC balance
     */
    function getBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}

