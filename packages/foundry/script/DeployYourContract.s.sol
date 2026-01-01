// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import "../contracts/SmartWallet.sol";
import "../contracts/Factory.sol";
import "../contracts/Example.sol";

/**
 * @notice Deploy script for Progressive Self-Custody contracts
 * @dev Deploys SmartWallet implementation, Factory, and Example contracts
 */
contract DeployYourContract is ScaffoldETHDeploy {
    // USDC addresses per chain
    // Base mainnet: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
    // Base sepolia: We'll deploy a mock
    // Local: We'll deploy a mock
    
    function run() external ScaffoldEthDeployerRunner {
        // Deploy SmartWallet implementation (not used directly, only as template for clones)
        SmartWallet smartWalletImpl = new SmartWallet();
        console.log("SmartWallet Implementation deployed at:", address(smartWalletImpl));
        
        // Deploy Factory with deployer as default guardian (facilitator)
        Factory factory = new Factory(address(smartWalletImpl), deployer);
        console.log("Factory deployed at:", address(factory));
        
        // For local/testnet: Deploy a mock USDC for testing
        // For mainnet: Use the real USDC address
        address usdcAddress;
        if (block.chainid == 8453) {
            // Base mainnet - use real USDC
            usdcAddress = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
        } else {
            // Local or testnet - deploy mock USDC
            MockUSDC mockUsdc = new MockUSDC();
            usdcAddress = address(mockUsdc);
            console.log("Mock USDC deployed at:", usdcAddress);
        }
        
        // Deploy Example contract
        Example example = new Example(usdcAddress);
        console.log("Example deployed at:", address(example));
    }
}

/**
 * @notice Mock USDC token for testing
 * @dev Simple ERC20 with 6 decimals like real USDC
 */
contract MockUSDC {
    string public name = "USD Coin";
    string public symbol = "USDC";
    uint8 public decimals = 6;
    
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;
    
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    
    constructor() {
        // Mint 1 million USDC to deployer for testing
        _mint(msg.sender, 1_000_000 * 10**6);
    }
    
    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }
    
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        return _transfer(from, to, amount);
    }
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    
    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
    
    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
