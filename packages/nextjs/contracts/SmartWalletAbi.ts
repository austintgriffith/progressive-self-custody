// SmartWallet ABI for contract interactions
export const SMART_WALLET_ABI = [
  // Read functions
  {
    inputs: [],
    name: "owner",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "guardian",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "withdrawAddress",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "recoveryPasswordHash",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "lastActivityTimestamp",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "deadmanDelay",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "deadmanTriggeredAt",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "passkeyCreated",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "addr", type: "address" }],
    name: "isPasskey",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "addr", type: "address" }],
    name: "nonces",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "addr", type: "address" }],
    name: "passkeyQx",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "addr", type: "address" }],
    name: "passkeyQy",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "qx", type: "bytes32" },
      { name: "qy", type: "bytes32" },
    ],
    name: "getPasskeyAddress",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [{ name: "credentialIdHash", type: "bytes32" }],
    name: "getPasskeyByCredentialId",
    outputs: [
      { name: "passkeyAddr", type: "address" },
      { name: "qx", type: "bytes32" },
      { name: "qy", type: "bytes32" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getDeadmanTimeRemaining",
    outputs: [{ name: "remaining", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // Write functions (owner)
  {
    inputs: [
      { name: "qx", type: "bytes32" },
      { name: "qy", type: "bytes32" },
      { name: "credentialIdHash", type: "bytes32" },
    ],
    name: "addPasskey",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "qx", type: "bytes32" },
      { name: "qy", type: "bytes32" },
    ],
    name: "removePasskey",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "_withdrawAddress", type: "address" }],
    name: "setWithdrawAddress",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "_recoveryPasswordHash", type: "bytes32" }],
    name: "setRecoveryPasswordHash",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "_newGuardian", type: "address" }],
    name: "setGuardian",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "_delay", type: "uint256" }],
    name: "setDeadmanDelay",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "cancelDeadman",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    name: "exec",
    outputs: [{ name: "result", type: "bytes" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
        name: "calls",
        type: "tuple[]",
      },
    ],
    name: "batchExec",
    outputs: [{ name: "results", type: "bytes[]" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Meta-transaction functions
  {
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "qx", type: "bytes32" },
      { name: "qy", type: "bytes32" },
      { name: "deadline", type: "uint256" },
      {
        components: [
          { name: "authenticatorData", type: "bytes" },
          { name: "clientDataJSON", type: "string" },
          { name: "challengeIndex", type: "uint256" },
          { name: "typeIndex", type: "uint256" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
        ],
        name: "auth",
        type: "tuple",
      },
    ],
    name: "metaExecPasskey",
    outputs: [{ name: "result", type: "bytes" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
        name: "calls",
        type: "tuple[]",
      },
      { name: "qx", type: "bytes32" },
      { name: "qy", type: "bytes32" },
      { name: "deadline", type: "uint256" },
      {
        components: [
          { name: "authenticatorData", type: "bytes" },
          { name: "clientDataJSON", type: "string" },
          { name: "challengeIndex", type: "uint256" },
          { name: "typeIndex", type: "uint256" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
        ],
        name: "auth",
        type: "tuple",
      },
    ],
    name: "metaBatchExecPasskey",
    outputs: [{ name: "results", type: "bytes[]" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Guardian functions
  {
    inputs: [{ name: "password", type: "string" }],
    name: "triggerDeadmanWithPassword",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "token", type: "address" }],
    name: "executeDeadman",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "target", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
      { indexed: false, name: "data", type: "bytes" },
    ],
    name: "Executed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "passkeyAddress", type: "address" },
      { indexed: false, name: "qx", type: "bytes32" },
      { indexed: false, name: "qy", type: "bytes32" },
    ],
    name: "PasskeyAdded",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [{ indexed: true, name: "passkeyAddress", type: "address" }],
    name: "PasskeyRemoved",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "passkey", type: "address" },
      { indexed: true, name: "target", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
      { indexed: false, name: "data", type: "bytes" },
    ],
    name: "MetaExecuted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [{ indexed: false, name: "executionTime", type: "uint256" }],
    name: "DeadmanTriggered",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [],
    name: "DeadmanCancelled",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "withdrawAddress", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
    name: "DeadmanExecuted",
    type: "event",
  },
] as const;

// Factory ABI
export const FACTORY_ABI = [
  {
    inputs: [],
    name: "implementation",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "defaultGuardian",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "salt", type: "bytes32" },
    ],
    name: "createWallet",
    outputs: [{ name: "wallet", type: "address" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "guardian", type: "address" },
      { name: "salt", type: "bytes32" },
    ],
    name: "createWalletWithGuardian",
    outputs: [{ name: "wallet", type: "address" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "salt", type: "bytes32" },
    ],
    name: "getWalletAddress",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: true, name: "wallet", type: "address" },
      { indexed: true, name: "guardian", type: "address" },
      { indexed: false, name: "salt", type: "bytes32" },
    ],
    name: "WalletCreated",
    type: "event",
  },
] as const;

// ERC20 ABI (for USDC)
export const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transferFrom",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
