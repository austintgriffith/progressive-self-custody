# Progressive Self-Custody - Implementation Plan

## Overview

Build a passkey-based smart contract wallet system that enables users to interact with DeFi applications using only biometrics (Face ID/fingerprint), with automatic USDC yield generation, facilitator-paid gas, and guardian recovery mechanisms.

---

## Phase 1: Smart Contracts

### 1.1 Core Contracts (from SlopWallet)

Copy and adapt from the existing SlopWallet implementation:

| Contract | File | Purpose |
|----------|------|---------|
| SmartWallet | `contracts/SmartWallet.sol` | User's wallet with passkey auth |
| Factory | `contracts/Factory.sol` | CREATE2 deployment of wallet clones |
| Clones | `contracts/Clones.sol` | EIP-1167 minimal proxy library |

### 1.2 SmartWallet Modifications

Add the following to SmartWallet.sol:

**New State Variables:**
```solidity
address public withdrawAddress;           // CEX/ENS address for recovery
address public guardian;                  // Facilitator by default
bytes32 public recoveryPasswordHash;      // keccak256(password) for guardian recovery
uint256 public lastActivityTimestamp;     // For deadman's switch
uint256 public deadmanDelay;              // Default 24 hours
uint256 public deadmanTriggeredAt;        // When recovery was initiated (0 = not triggered)
```

**New Functions:**
- `setWithdrawAddress(address)` - passkey-signed meta-tx
- `setRecoveryPasswordHash(bytes32)` - passkey-signed, set during onboarding
- `triggerDeadmanWithPassword(string password)` - guardian can call if hash matches
- `cancelDeadman()` - passkey owner cancels
- `executeDeadman()` - guardian executes after delay expires
- `heartbeat()` - update lastActivityTimestamp (called in every meta-tx)

### 1.3 Example.sol (Application Contract)

A sample contract representing any app that accepts USDC payments:

```solidity
contract Example {
    address public owner;
    IERC20 public usdc;
    
    event PaymentReceived(address indexed from, uint256 amount);
    
    function payUSDC(uint256 amount) external;
    function withdraw(address to) external;
}
```

### 1.4 DeFi Integration (Phase 2)

For MVP on Base, integrate with Aave V3:
- Deposit USDC → receive aUSDC
- Track balance via aUSDC holdings
- Auto-deposit on receive, auto-withdraw on spend

---

## Phase 2: Facilitator API

### 2.1 Design

The facilitator:
- Has a private key in `FACILITATOR_PRIVATE_KEY` env var
- Receives signed meta-tx bundles from users
- Submits transactions and pays gas upfront
- Recovers gas cost via USDC transfer at end of each bundle

### 2.2 Gas Recovery Model

Every transaction bundle includes a final USDC transfer to facilitator:

```javascript
calls = [
  { ...userAction1 },
  { ...userAction2 },
  { target: USDC, data: transfer(facilitatorAddress, gasFeeInUSDC) }
]
```

### 2.3 API Endpoints

**POST /api/facilitate**
- Input: Signed meta-tx with passkey auth
- Action: Submit to chain, pay gas
- Output: `{ txHash }`

**POST /api/deploy-wallet**
- Input: `{ qx, qy, credentialIdHash }`
- Action: Deploy via Factory, add passkey, take deployment fee
- Output: `{ walletAddress, txHash }`

**POST /api/prepare-call**
- Input: `{ wallet, action, params, qx, qy }`
- Output: `{ calls, nonce, deadline, challengeHash, estimatedGasFee }`

---

## Phase 3: Guardian API & Password Recovery

### 3.1 Recovery Password Setup

During onboarding:
1. User enters password (client-side only)
2. Hash: `keccak256(walletAddress + password)`
3. Sign meta-tx: `setRecoveryPasswordHash(hash)`
4. Facilitator executes

### 3.2 Guardian API Endpoints

**POST /api/guardian/trigger-recovery**
```typescript
Input: { smartWalletAddress, password }
Action: Verify hash, call triggerDeadmanWithPassword()
Output: { success, executionTime }
```

**GET /api/guardian/recovery-status**
```typescript
Input: ?wallet=0x...
Output: { triggered, executionTime, withdrawAddress }
```

**POST /api/guardian/execute-recovery**
```typescript
Input: { smartWalletAddress }
Action: Check delay passed, call executeDeadman()
Output: { txHash }
```

### 3.3 Recovery Flow

1. User enters wallet address + password at `/recover`
2. Guardian verifies password hash matches on-chain
3. Guardian triggers 24h countdown
4. After 24h, user can execute recovery
5. All funds sent to withdraw address

---

## Phase 4: Frontend

### 4.1 Landing Page (`/`)

```
[Create Account]   ← Primary CTA
[Existing Account] ← Secondary CTA

[Advanced]         ← Small link at bottom
```

### 4.2 Onboarding Flow

1. **Create Account**: Generate passkey → show counterfactual address
2. **Deposit Prompt**: QR code + address, wait for USDC
3. **First Deposit Detected**:
   - Deploy wallet (facilitator takes fee)
   - Prompt for withdraw address
   - Prompt for recovery password
4. **Gamification**: "Withdraw $1 to verify your CEX works"

### 4.3 Wallet Page (`/wallet/[address]`)

- Balance display (USDC in DeFi + yield)
- [Pay USDC] button for Example contract
- Withdraw to saved address
- Settings (change withdraw address, recovery password)

### 4.4 Recovery Page (`/recover`)

- Enter wallet address
- Enter recovery password
- Shows withdraw address (masked)
- [Trigger Recovery] button
- Status countdown
- [Execute Recovery] after 24h

### 4.5 Advanced Page (`/advanced`)

For power users with ECDSA wallets:
- Connect via RainbowKit
- Become guardian
- Become owner
- Manage passkeys
- Self-facilitate

---

## Phase 5: Transaction Bundle Preparation

### 5.1 Bundle Examples

**Pay USDC to Example Contract:**
```javascript
calls = [
  // 1. Withdraw from DeFi (if integrated)
  { target: AavePool, data: withdraw(USDC, amount + fee, wallet) },
  // 2. Approve Example contract
  { target: USDC, data: approve(Example, amount) },
  // 3. Pay to Example
  { target: Example, data: payUSDC(amount) },
  // 4. Gas fee to facilitator
  { target: USDC, data: transfer(facilitator, fee) }
]
```

**Withdraw USDC:**
```javascript
calls = [
  // 1. Withdraw from DeFi
  { target: AavePool, data: withdraw(USDC, amount + fee, wallet) },
  // 2. Transfer to withdraw address
  { target: USDC, data: transfer(withdrawAddress, amount) },
  // 3. Gas fee to facilitator
  { target: USDC, data: transfer(facilitator, fee) }
]
```

---

## File Structure

```
packages/
├── foundry/
│   ├── contracts/
│   │   ├── SmartWallet.sol
│   │   ├── Factory.sol
│   │   ├── Clones.sol
│   │   └── Example.sol
│   ├── script/
│   │   └── Deploy.s.sol
│   └── test/
│       ├── SmartWallet.t.sol
│       └── Guardian.t.sol
├── nextjs/
│   ├── app/
│   │   ├── page.tsx
│   │   ├── wallet/[address]/page.tsx
│   │   ├── recover/page.tsx
│   │   └── advanced/page.tsx
│   ├── app/api/
│   │   ├── facilitate/route.ts
│   │   ├── deploy-wallet/route.ts
│   │   ├── prepare-call/route.ts
│   │   └── guardian/
│   │       ├── trigger-recovery/route.ts
│   │       ├── recovery-status/route.ts
│   │       └── execute-recovery/route.ts
│   ├── contracts/
│   │   └── SmartWalletAbi.ts
│   └── utils/
│       └── passkey.ts
```

---

## Implementation Order

| Priority | Task |
|----------|------|
| P0 | Copy SlopWallet contracts |
| P0 | Add SmartWallet modifications (guardian, recovery, deadman) |
| P0 | Create Example.sol |
| P0 | Facilitator API with gas recovery |
| P0 | Guardian API with password recovery |
| P0 | Landing page + onboarding flow |
| P0 | Wallet page |
| P1 | Recovery page |
| P1 | DeFi integration (Aave) |
| P1 | Transaction bundle preparation with gas fees |
| P2 | Advanced page |

---

## Environment Variables

```env
# Facilitator wallet
FACILITATOR_PRIVATE_KEY=0x...
FACILITATOR_ADDRESS=0x...

# Chain config
ALCHEMY_API_KEY=...
TARGET_CHAIN_ID=8453

# Contract addresses (after deployment)
FACTORY_ADDRESS=0x...
SMART_WALLET_IMPL_ADDRESS=0x...
EXAMPLE_ADDRESS=0x...
USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
```

