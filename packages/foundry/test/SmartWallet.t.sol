// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/SmartWallet.sol";
import "../contracts/Factory.sol";
import "../contracts/Example.sol";
import "../script/DeployYourContract.s.sol";

contract SmartWalletTest is Test {
    SmartWallet public implementation;
    Factory public factory;
    MockUSDC public usdc;
    Example public example;
    
    address public owner = address(0x1);
    address public guardian = address(0x2);
    address public user = address(0x3);
    address public withdrawAddr = address(0x4);
    
    SmartWallet public wallet;
    
    function setUp() public {
        // Deploy implementation
        implementation = new SmartWallet();
        
        // Deploy factory with guardian
        factory = new Factory(address(implementation), guardian);
        
        // Deploy mock USDC
        usdc = new MockUSDC();
        
        // Deploy example contract
        example = new Example(address(usdc));
        
        // Create a wallet for testing
        vm.prank(guardian);
        address walletAddr = factory.createWallet(owner, bytes32(0));
        wallet = SmartWallet(payable(walletAddr));
        
        // Fund the wallet with USDC
        usdc.mint(address(wallet), 1000 * 10**6);
        
        // Fund the wallet with ETH
        vm.deal(address(wallet), 1 ether);
    }
    
    function testWalletDeployment() public view {
        assertEq(wallet.owner(), owner);
        assertEq(wallet.guardian(), guardian);
    }
    
    function testPredictAddress() public view {
        address predicted = factory.getWalletAddress(user, bytes32(uint256(1)));
        
        // Deploy should create at predicted address
        vm.prank(guardian);
        address actual = factory.createWallet(user, bytes32(uint256(1)));
        
        assertEq(predicted, actual);
    }
    
    function testOwnerCanExec() public {
        // Transfer USDC via exec
        vm.prank(owner);
        wallet.exec(
            address(usdc),
            0,
            abi.encodeWithSelector(usdc.transfer.selector, user, 100 * 10**6)
        );
        
        assertEq(usdc.balanceOf(user), 100 * 10**6);
    }
    
    function testOwnerCanBatchExec() public {
        SmartWallet.Call[] memory calls = new SmartWallet.Call[](2);
        
        // Approve and pay USDC
        calls[0] = SmartWallet.Call({
            target: address(usdc),
            value: 0,
            data: abi.encodeWithSelector(usdc.approve.selector, address(example), 50 * 10**6)
        });
        calls[1] = SmartWallet.Call({
            target: address(example),
            value: 0,
            data: abi.encodeWithSelector(example.payUSDC.selector, 50 * 10**6)
        });
        
        vm.prank(owner);
        wallet.batchExec(calls);
        
        assertEq(example.getUserPayments(address(wallet)), 50 * 10**6);
    }
    
    function testSetWithdrawAddress() public {
        vm.prank(owner);
        wallet.setWithdrawAddress(withdrawAddr);
        
        assertEq(wallet.withdrawAddress(), withdrawAddr);
    }
    
    function testSetRecoveryPasswordHash() public {
        bytes32 hash = keccak256(abi.encodePacked(address(wallet), "mypassword"));
        
        vm.prank(owner);
        wallet.setRecoveryPasswordHash(hash);
        
        assertEq(wallet.recoveryPasswordHash(), hash);
    }
    
    function testTriggerDeadmanWithPassword() public {
        // Setup: Set withdraw address and password hash
        vm.startPrank(owner);
        wallet.setWithdrawAddress(withdrawAddr);
        bytes32 hash = keccak256(abi.encodePacked(address(wallet), "mypassword"));
        wallet.setRecoveryPasswordHash(hash);
        vm.stopPrank();
        
        // Guardian triggers deadman with correct password
        vm.prank(guardian);
        wallet.triggerDeadmanWithPassword("mypassword");
        
        assertGt(wallet.deadmanTriggeredAt(), 0);
    }
    
    function testTriggerDeadmanFailsWithWrongPassword() public {
        // Setup
        vm.startPrank(owner);
        wallet.setWithdrawAddress(withdrawAddr);
        bytes32 hash = keccak256(abi.encodePacked(address(wallet), "mypassword"));
        wallet.setRecoveryPasswordHash(hash);
        vm.stopPrank();
        
        // Guardian triggers with wrong password
        vm.prank(guardian);
        vm.expectRevert(SmartWallet.InvalidPasswordHash.selector);
        wallet.triggerDeadmanWithPassword("wrongpassword");
    }
    
    function testCancelDeadman() public {
        // Setup and trigger
        vm.startPrank(owner);
        wallet.setWithdrawAddress(withdrawAddr);
        bytes32 hash = keccak256(abi.encodePacked(address(wallet), "mypassword"));
        wallet.setRecoveryPasswordHash(hash);
        vm.stopPrank();
        
        vm.prank(guardian);
        wallet.triggerDeadmanWithPassword("mypassword");
        
        // Owner cancels
        vm.prank(owner);
        wallet.cancelDeadman();
        
        assertEq(wallet.deadmanTriggeredAt(), 0);
    }
    
    function testExecuteDeadmanAfterDelay() public {
        // Setup and trigger
        vm.startPrank(owner);
        wallet.setWithdrawAddress(withdrawAddr);
        bytes32 hash = keccak256(abi.encodePacked(address(wallet), "mypassword"));
        wallet.setRecoveryPasswordHash(hash);
        vm.stopPrank();
        
        vm.prank(guardian);
        wallet.triggerDeadmanWithPassword("mypassword");
        
        // Fast forward past delay
        vm.warp(block.timestamp + 25 hours);
        
        // Execute deadman for USDC
        uint256 balanceBefore = usdc.balanceOf(withdrawAddr);
        vm.prank(guardian);
        wallet.executeDeadman(address(usdc));
        
        // All USDC should be transferred
        assertEq(usdc.balanceOf(withdrawAddr), balanceBefore + 1000 * 10**6);
    }
    
    function testExecuteDeadmanFailsBeforeDelay() public {
        // Setup and trigger
        vm.startPrank(owner);
        wallet.setWithdrawAddress(withdrawAddr);
        bytes32 hash = keccak256(abi.encodePacked(address(wallet), "mypassword"));
        wallet.setRecoveryPasswordHash(hash);
        vm.stopPrank();
        
        vm.prank(guardian);
        wallet.triggerDeadmanWithPassword("mypassword");
        
        // Try to execute before delay
        vm.prank(guardian);
        vm.expectRevert(SmartWallet.DeadmanDelayNotPassed.selector);
        wallet.executeDeadman(address(usdc));
    }
    
    function testChangeGuardian() public {
        address newGuardian = address(0x5);
        
        vm.prank(owner);
        wallet.setGuardian(newGuardian);
        
        assertEq(wallet.guardian(), newGuardian);
    }
    
    function testNonOwnerCannotExec() public {
        vm.prank(user);
        vm.expectRevert();
        wallet.exec(address(usdc), 0, "");
    }
    
    function testNonGuardianCannotTriggerDeadman() public {
        vm.startPrank(owner);
        wallet.setWithdrawAddress(withdrawAddr);
        wallet.setRecoveryPasswordHash(keccak256(abi.encodePacked(address(wallet), "pass")));
        vm.stopPrank();
        
        vm.prank(user);
        vm.expectRevert(SmartWallet.NotGuardian.selector);
        wallet.triggerDeadmanWithPassword("pass");
    }
}

