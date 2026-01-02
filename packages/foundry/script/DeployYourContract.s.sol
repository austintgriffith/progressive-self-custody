// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import "../contracts/SmartWallet.sol";
import "../contracts/Factory.sol";
import "../contracts/Example.sol";

/**
 * @notice Deploy script for Progressive Self-Custody contracts
 * @dev Deploys SmartWallet implementation, Factory, and Example contracts
 *      Always uses real Base USDC (testing is done via Base fork)
 */
contract DeployYourContract is ScaffoldETHDeploy {
    // Base USDC address (used for both mainnet and local Base fork)
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    
    function run() external ScaffoldEthDeployerRunner {
        // Deploy SmartWallet implementation (not used directly, only as template for clones)
        SmartWallet smartWalletImpl = new SmartWallet();
        console.log("SmartWallet Implementation deployed at:", address(smartWalletImpl));
        
        // Deploy Factory with deployer as default guardian (facilitator)
        Factory factory = new Factory(address(smartWalletImpl), deployer);
        console.log("Factory deployed at:", address(factory));
        
        // Deploy Example contract with real Base USDC
        Example example = new Example(USDC);
        console.log("Example deployed at:", address(example));
        console.log("Using USDC at:", USDC);
    }
}
