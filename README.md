# Progressive Self-Custody

**DeFi-enabled passkey wallets purpose-built for a single application.**

Progressive Self-Custody enables users to interact with smart contracts using only biometrics (Face ID/fingerprint) - no seed phrases, no gas management, no wallet extensions required.

## The Vision

Any user with USDC on a centralized exchange can:
1. **Create an account** with a single tap (generates a passkey)
2. **Send USDC** to their smart wallet address
3. **Interact with your app** via simple button clicks + biometric scan
4. **Withdraw anytime** to their CEX or any address

All without understanding ECDSA keypairs, wallet mnemonics, or gas fees.

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│  User taps [Create Account]                                     │
│  → Passkey generated (Face ID / fingerprint)                    │
│  → Counterfactual wallet address computed                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  User sends USDC from CEX to wallet address                     │
│  → Facilitator deploys wallet (CREATE2)                         │
│  → USDC auto-invested in DeFi (earns yield)                     │
│  → Small fee covers deployment gas                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  User clicks [Pay USDC] in your app                             │
│  → Signs batch transaction with passkey (biometric)             │
│  → Facilitator submits tx, pays gas                             │
│  → USDC flows from wallet → your app contract                   │
│  → Small USDC fee reimburses facilitator                        │
└─────────────────────────────────────────────────────────────────┘
```

## Key Features

### For Users
- **No seed phrases** - Passkeys are secured by device biometrics
- **No gas tokens** - Facilitator pays gas, recovered via small USDC fees
- **No wallet apps** - Works in any browser with WebAuthn support
- **Auto yield** - Idle USDC earns DeFi yield automatically
- **Easy recovery** - Set a recovery password to recover funds if passkey is lost

### For Developers
- **Drop-in wallet system** - Users pay your app in USDC with one tap
- **Gasless UX** - Users never need ETH
- **Progressive custody** - Users can upgrade to full self-custody anytime

### Recovery System
- **Withdraw address** - Set once, withdraw anytime
- **Recovery password** - If passkey lost, trigger 24h recovery countdown
- **Guardian system** - Facilitator acts as guardian by default
- **Advanced mode** - Power users can become their own guardian

## Architecture

| Component | Purpose |
|-----------|---------|
| **SmartWallet.sol** | User's smart contract wallet - holds assets, executes transactions |
| **Factory.sol** | Deploys wallet clones via CREATE2 (deterministic addresses) |
| **Example.sol** | Sample app contract demonstrating USDC payments |
| **Facilitator API** | Relays signed transactions, pays gas, recovers fees in USDC |
| **Guardian API** | Handles password-based recovery for lost passkeys |

## Tech Stack

- **Smart Contracts**: Solidity, Foundry
- **Frontend**: Next.js 14, TypeScript, Tailwind CSS
- **Wallet**: WebAuthn passkeys, EIP-1167 minimal proxies
- **DeFi**: Aave V3 (USDC yield)
- **Network**: Base (L2)

Built on [Scaffold-ETH 2](https://scaffoldeth.io).

## Quick Start

### Prerequisites
- Node.js >= v20
- Yarn
- Git

### Development

1. Install dependencies:
```bash
yarn install
```

2. Start local blockchain:
```bash
yarn chain
```

3. Deploy contracts:
```bash
yarn deploy
```

4. Start frontend:
```bash
yarn start
```

Visit `http://localhost:3000`

### Environment Variables

Create `.env.local` in `packages/nextjs/`:

```env
# Facilitator wallet (pays gas, receives USDC fees)
FACILITATOR_PRIVATE_KEY=0x...
FACILITATOR_ADDRESS=0x...

# Alchemy API key for Base
ALCHEMY_API_KEY=...
```

## User Flows

### New User Onboarding
1. Land on app → Click **[Create Account]**
2. Biometric prompt → Passkey created
3. See wallet address + QR code
4. Send USDC from CEX
5. Wallet deployed, set recovery password
6. Gamification: "Withdraw $1 to verify" → sets withdraw address

### Returning User
1. Land on app → Click **[Existing Account]**
2. Biometric prompt → Passkey authenticated
3. Access wallet, make transactions

### Lost Passkey Recovery
1. Go to `/recover`
2. Enter wallet address + recovery password
3. Trigger 24h countdown
4. After 24h, funds sent to withdraw address

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md)

## License

MIT

Please see [CONTRIBUTING.MD](https://github.com/scaffold-eth/scaffold-eth-2/blob/main/CONTRIBUTING.md) for more information and guidelines for contributing to Scaffold-ETH 2.