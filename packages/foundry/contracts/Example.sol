//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Example
 * @notice A dumb dice roll game - bet 0.05 USDC, win 0.10 USDC (or get refunded if broke)
 * @notice Demonstrates how SmartWallet users can interact with dApps via passkey signatures
 * @author BuidlGuidl
 */
contract Example is Ownable {
    // USDC token address (set in constructor for the target chain)
    IERC20 public immutable usdc;
    
    // Bet amounts (USDC has 6 decimals)
    uint256 public constant BET_AMOUNT = 50000;   // 0.05 USDC
    uint256 public constant WIN_AMOUNT = 100000;  // 0.10 USDC

    // Events
    event DiceRoll(address indexed player, bool won, uint256 payout);
    event FundsWithdrawn(address indexed to, uint256 amount);

    // Errors
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
     * @notice Roll the dice! Bet 0.05 USDC for a chance to win 0.10 USDC
     * @dev User must approve this contract to spend 0.05 USDC first
     *      Uses block.prevrandao % 2 to determine win/lose (even = win)
     *      If contract can't pay out, refunds the bet
     */
    function dumbDiceRoll() external {
        // Transfer 0.05 USDC from caller
        bool transferSuccess = usdc.transferFrom(msg.sender, address(this), BET_AMOUNT);
        if (!transferSuccess) revert TransferFailed();
        
        // Determine outcome: prevrandao % 2 (even = win, odd = lose)
        bool won = block.prevrandao % 2 == 0;
        
        if (won) {
            uint256 balance = usdc.balanceOf(address(this));
            if (balance >= WIN_AMOUNT) {
                // Pay double!
                usdc.transfer(msg.sender, WIN_AMOUNT);
                emit DiceRoll(msg.sender, true, WIN_AMOUNT);
            } else {
                // Refund bet - contract is broke
                usdc.transfer(msg.sender, BET_AMOUNT);
                emit DiceRoll(msg.sender, true, BET_AMOUNT);
            }
        } else {
            // Lost - keep the bet
            emit DiceRoll(msg.sender, false, 0);
        }
    }

    /**
     * @notice Withdraw collected USDC (owner only)
     * @param to The address to send USDC to
     * @param amount The amount to withdraw (0 = all)
     */
    function withdraw(address to, uint256 amount) external onlyOwner {
        uint256 balance = usdc.balanceOf(address(this));
        uint256 withdrawAmount = amount == 0 ? balance : amount;
        
        if (withdrawAmount > balance) revert WithdrawFailed();
        
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
