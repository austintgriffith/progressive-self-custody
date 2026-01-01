# Passkey Wallet Page Reference

This document contains the full implementation of the passkey wallet page with tests and example UI for building passkey-based smart wallet interactions.

## Overview

This page (`/wallet/[address]`) provides a comprehensive UI for:
- Viewing smart wallet details (owner, balances)
- Passkey authentication (generate, login, add)
- Quick gasless transfers (ETH/USDC) via passkey
- Quick gasless swaps (ETH ↔ USDC) via passkey
- Meta-transaction signing and relaying
- WalletConnect integration
- Impersonator iframe for dApp interaction
- AI Agent for natural language transactions
- Raw transaction input/parsing
- External passkey management

## Key Features

### 1. Passkey Authentication Flow
- **Generate New Passkey**: Creates a new passkey using WebAuthn
- **Login with Existing Passkey**: Recovers public key from signature (single Touch ID if registered)
- **Add Passkey**: Owner registers passkey on-chain with credentialIdHash

### 2. Quick Transfer (Gasless)
- Uses `/api/transfer` to get calldata
- Signs with passkey
- Submits to `/api/facilitate` for relaying

### 3. Quick Swap (Gasless)
- Uses `/api/swap/quote` for price quotes
- Uses `/api/swap` to get swap calldata
- Supports both single and batch transactions (approve + swap)

### 4. Pending Transaction Queue
- Unified queue for Impersonator, WalletConnect, and manual transactions
- Passkey signing integration
- Facilitator API submission

---

## Full Component Code

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ImpersonatorIframe, ImpersonatorIframeProvider } from "@impersonator/iframe";
import { Address, AddressInput, Balance } from "@scaffold-ui/components";
import { QRCodeSVG } from "qrcode.react";
import { useDebounceValue } from "usehooks-ts";
import { encodeFunctionData, formatEther, formatUnits, isAddress, isHex, parseEther, parseUnits } from "viem";
import { base, hardhat } from "viem/chains";
import { normalize } from "viem/ens";
import { useAccount, useBalance, useChainId, useConfig, useEnsAddress, useReadContract, useWriteContract } from "wagmi";
import { readContract } from "wagmi/actions";
import { QrCodeIcon } from "@heroicons/react/24/outline";
import { PendingTransactionQueue, WalletConnectSection } from "~~/components/scaffold-eth";
import { SMART_WALLET_ABI } from "~~/contracts/SmartWalletAbi";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";
import scaffoldConfig from "~~/scaffold.config";
import {
  PendingTransaction,
  PendingTransactionStatus,
  SignedTransaction,
  createPendingTransaction,
} from "~~/types/pendingTransaction";
import {
  StoredPasskey,
  WebAuthnAuth,
  buildChallengeHash,
  clearPasskeyFromStorage,
  createPasskey,
  getCredentialIdHash,
  getPasskeyFromStorage,
  isWebAuthnSupported,
  loginWithPasskey,
  savePasskeyToStorage,
  signWithPasskey,
} from "~~/utils/passkey";

// USDC on Base
const USDC_ADDRESS_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const USDC_DECIMALS = 6;

// ZORA on Base
const ZORA_ADDRESS_BASE = "0x1111111111166b7FE7bd91427724B487980aFc69" as const;
const ZORA_DECIMALS = 18;

// WETH on Base
const WETH_ADDRESS_BASE = "0x4200000000000000000000000000000000000006" as const;

// Uniswap V3 SwapRouter02 on Base
const SWAP_ROUTER_ADDRESS = "0x2626664c2603336E57B271c5C0b26F421741e481" as const;

// Get RPC URL for Impersonator based on target network
const getImpersonatorRpcUrl = (chainId: number) => {
  // Base (8453) - use Alchemy
  if (chainId === 8453) {
    return `https://base-mainnet.g.alchemy.com/v2/${scaffoldConfig.alchemyApiKey}`;
  }
  // Mainnet (1) - use BuidlGuidl RPC
  if (chainId === 1) {
    return "https://mainnet.rpc.buidlguidl.com";
  }
  // Fallback to Base Alchemy
  return `https://base-mainnet.g.alchemy.com/v2/${scaffoldConfig.alchemyApiKey}`;
};

const ERC20_ABI = [
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
] as const;

// Uniswap V3 SwapRouter02 ABI (only the functions we need)
const SWAP_ROUTER_ABI = [
  {
    inputs: [
      {
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
        name: "params",
        type: "tuple",
      },
    ],
    name: "exactInputSingle",
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { name: "amountMinimum", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    name: "unwrapWETH9",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
] as const;

const WalletPage = () => {
  const params = useParams();
  const walletAddress = params.address as string;
  const { address: connectedAddress } = useAccount();

  // Transfer ETH state
  const [recipientAddress, setRecipientAddress] = useState("");
  const [ethAmount, setEthAmount] = useState("");

  // Transfer USDC state
  const [usdcRecipientAddress, setUsdcRecipientAddress] = useState("");
  const [usdcAmount, setUsdcAmount] = useState("");

  // Transfer ZORA state
  const [zoraRecipientAddress, setZoraRecipientAddress] = useState("");
  const [zoraAmount, setZoraAmount] = useState("");

  // Check passkey state
  const [checkPasskeyAddress, setCheckPasskeyAddress] = useState("");
  const [passkeyCheckTriggered, setPasskeyCheckTriggered] = useState(false);

  // Raw TX state
  const [rawTxJson, setRawTxJson] = useState("");
  const [parsedTx, setParsedTx] = useState<{
    isBatch: boolean;
    calls: Array<{ target: string; value: bigint; data: `0x${string}` }>;
  } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // Impersonator state
  const [appUrl, setAppUrl] = useState("");
  const [debouncedAppUrl] = useDebounceValue(appUrl, 500);

  // AI Agent state
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentResponse, setAgentResponse] = useState<string | null>(null);
  const [isAgentLoading, setIsAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);

  // Pending transaction queue state (unified queue for Impersonator, WalletConnect, etc.)
  const [pendingTransactions, setPendingTransactions] = useState<PendingTransaction[]>([]);
  const [signedTransactions, setSignedTransactions] = useState<SignedTransaction[]>([]);

  // Passkey state
  const [currentPasskey, setCurrentPasskey] = useState<StoredPasskey | null>(null);
  const [isGeneratingPasskey, setIsGeneratingPasskey] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isAddingPasskey, setIsAddingPasskey] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false); // Track client-side mount for hydration
  const [showQRModal, setShowQRModal] = useState(false);

  // Passkey Send ETH state
  const [passkeyRecipient, setPasskeyRecipient] = useState("");
  const [passkeyAmount, setPasskeyAmount] = useState("");
  const [isSigningWithPasskey, setIsSigningWithPasskey] = useState(false);
  const [isRelaying, setIsRelaying] = useState(false);
  const [signedMetaTx, setSignedMetaTx] = useState<{
    target: `0x${string}`;
    value: bigint;
    data: `0x${string}`;
    qx: `0x${string}`;
    qy: `0x${string}`;
    deadline: bigint;
    auth: WebAuthnAuth;
  } | null>(null);

  // Quick Transfer state (API-based passkey transfer)
  const [quickTransferRecipient, setQuickTransferRecipient] = useState("");
  const [quickTransferAmount, setQuickTransferAmount] = useState("");
  const [quickTransferAsset, setQuickTransferAsset] = useState<"ETH" | "USDC">("ETH");
  const [isQuickTransferring, setIsQuickTransferring] = useState(false);
  const [quickTransferStatus, setQuickTransferStatus] = useState<string | null>(null);
  const [quickTransferTxHash, setQuickTransferTxHash] = useState<string | null>(null);
  const [quickTransferError, setQuickTransferError] = useState<string | null>(null);

  // Quick Swap state (API-based passkey swap)
  const [swapDirection, setSwapDirection] = useState<"USDC_TO_ETH" | "ETH_TO_USDC">("USDC_TO_ETH");
  const [swapAmountIn, setSwapAmountIn] = useState("");
  const [debouncedSwapAmount] = useDebounceValue(swapAmountIn, 500);
  const [swapQuote, setSwapQuote] = useState<{
    amountOut: string;
    amountOutRaw: string;
    pricePerToken: string;
  } | null>(null);
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);
  const [isQuickSwapping, setIsQuickSwapping] = useState(false);
  const [swapStatus, setSwapStatus] = useState<string | null>(null);
  const [swapTxHash, setSwapTxHash] = useState<string | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);

  // External Passkey state (for adding passkeys from other devices)
  const [externalPasskeyQx, setExternalPasskeyQx] = useState("");
  const [externalPasskeyQy, setExternalPasskeyQy] = useState("");
  const [externalPasskeyCredentialId, setExternalPasskeyCredentialId] = useState("");
  const [isAddingExternalPasskey, setIsAddingExternalPasskey] = useState(false);
  const [externalPasskeyError, setExternalPasskeyError] = useState<string | null>(null);
  const [externalPasskeySuccess, setExternalPasskeySuccess] = useState<string | null>(null);

  // Resolve ENS name if needed
  const isEnsName = recipientAddress.endsWith(".eth");
  const { data: resolvedEnsAddress } = useEnsAddress({
    name: isEnsName ? normalize(recipientAddress) : undefined,
    chainId: 1, // ENS resolution on mainnet
  });

  // Get the final address to use (resolved ENS or direct address)
  const finalRecipientAddress = isEnsName ? resolvedEnsAddress : recipientAddress;

  // Resolve ENS for USDC recipient
  const isUsdcRecipientEns = usdcRecipientAddress.endsWith(".eth");
  const { data: resolvedUsdcRecipientAddress } = useEnsAddress({
    name: isUsdcRecipientEns ? normalize(usdcRecipientAddress) : undefined,
    chainId: 1,
  });
  const finalUsdcRecipientAddress = isUsdcRecipientEns ? resolvedUsdcRecipientAddress : usdcRecipientAddress;

  // Resolve ENS for ZORA recipient
  const isZoraRecipientEns = zoraRecipientAddress.endsWith(".eth");
  const { data: resolvedZoraRecipientAddress } = useEnsAddress({
    name: isZoraRecipientEns ? normalize(zoraRecipientAddress) : undefined,
    chainId: 1,
  });
  const finalZoraRecipientAddress = isZoraRecipientEns ? resolvedZoraRecipientAddress : zoraRecipientAddress;

  // Resolve ENS for passkey recipient
  const isPasskeyRecipientEns = passkeyRecipient.endsWith(".eth");
  const { data: resolvedPasskeyRecipient } = useEnsAddress({
    name: isPasskeyRecipientEns ? normalize(passkeyRecipient) : undefined,
    chainId: 1,
  });
  const finalPasskeyRecipient = isPasskeyRecipientEns ? resolvedPasskeyRecipient : passkeyRecipient;

  // Resolve ENS for check passkey
  const isCheckPasskeyEns = checkPasskeyAddress.endsWith(".eth");
  const { data: resolvedCheckPasskeyAddress } = useEnsAddress({
    name: isCheckPasskeyEns ? normalize(checkPasskeyAddress) : undefined,
    chainId: 1,
  });
  const finalCheckPasskeyAddress = isCheckPasskeyEns ? resolvedCheckPasskeyAddress : checkPasskeyAddress;

  // Validate address format
  const isValidAddress = walletAddress && isAddress(walletAddress);

  // Read owner from the SmartWallet
  const { data: owner, isLoading: ownerLoading } = useReadContract({
    address: isValidAddress ? (walletAddress as `0x${string}`) : undefined,
    abi: SMART_WALLET_ABI,
    functionName: "owner",
    query: {
      enabled: !!isValidAddress,
    },
  });

  // Check if connected address is a passkey (Note: connected EOA wallets aren't passkeys, only owner can exec directly)
  const { isLoading: passkeyCheckLoading } = useReadContract({
    address: isValidAddress ? (walletAddress as `0x${string}`) : undefined,
    abi: SMART_WALLET_ABI,
    functionName: "isPasskey",
    args: connectedAddress ? [connectedAddress] : undefined,
    query: {
      enabled: !!isValidAddress && !!connectedAddress,
    },
  });

  // Check if a specific address is a passkey (user-triggered)
  const { data: checkedAddressIsPasskey, isLoading: checkingPasskey } = useReadContract({
    address: isValidAddress ? (walletAddress as `0x${string}`) : undefined,
    abi: SMART_WALLET_ABI,
    functionName: "isPasskey",
    args:
      finalCheckPasskeyAddress && isAddress(finalCheckPasskeyAddress)
        ? [finalCheckPasskeyAddress as `0x${string}`]
        : undefined,
    query: {
      enabled:
        !!isValidAddress && !!finalCheckPasskeyAddress && isAddress(finalCheckPasskeyAddress) && passkeyCheckTriggered,
    },
  });

  // Read ETH balance
  const { data: ethBalance } = useBalance({
    address: isValidAddress ? (walletAddress as `0x${string}`) : undefined,
    query: {
      enabled: !!isValidAddress,
    },
  });

  // Read USDC balance on Base
  const { data: usdcBalance, isLoading: usdcLoading } = useReadContract({
    address: USDC_ADDRESS_BASE,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: isValidAddress ? [walletAddress as `0x${string}`] : undefined,
    chainId: base.id,
    query: {
      enabled: !!isValidAddress,
    },
  });

  // Read ZORA balance on Base
  const { data: zoraBalance, isLoading: zoraLoading } = useReadContract({
    address: ZORA_ADDRESS_BASE,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: isValidAddress ? [walletAddress as `0x${string}`] : undefined,
    chainId: base.id,
    query: {
      enabled: !!isValidAddress,
    },
  });

  // Get current chain ID for meta transaction signing
  const chainId = useChainId();

  // Get wagmi config for contract reads in callbacks
  const config = useConfig();

  // Get target network for Address component links
  const { targetNetwork } = useTargetNetwork();

  // Check if current passkey is registered
  const { data: isPasskeyRegistered, refetch: refetchPasskeyRegistered } = useReadContract({
    address: isValidAddress ? (walletAddress as `0x${string}`) : undefined,
    abi: SMART_WALLET_ABI,
    functionName: "isPasskey",
    args: currentPasskey ? [currentPasskey.passkeyAddress] : undefined,
    query: {
      enabled: !!isValidAddress && !!currentPasskey,
    },
  });

  // Get nonce for passkey meta transactions
  const { data: passkeyNonce, refetch: refetchPasskeyNonce } = useReadContract({
    address: isValidAddress ? (walletAddress as `0x${string}`) : undefined,
    abi: SMART_WALLET_ABI,
    functionName: "nonces",
    args: currentPasskey ? [currentPasskey.passkeyAddress] : undefined,
    query: {
      enabled: !!isValidAddress && !!currentPasskey,
    },
  });

  // Check if any passkey has been created (controls adaptive CTA)
  const { data: passkeyCreatedOnChain, refetch: refetchPasskeyCreated } = useReadContract({
    address: isValidAddress ? (walletAddress as `0x${string}`) : undefined,
    abi: SMART_WALLET_ABI,
    functionName: "passkeyCreated",
    query: {
      enabled: !!isValidAddress,
    },
  });

  // Track client-side mount for hydration safety
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Load passkey from localStorage on mount
  useEffect(() => {
    if (isValidAddress && typeof window !== "undefined") {
      const stored = getPasskeyFromStorage(walletAddress);
      if (stored) {
        setCurrentPasskey(stored);
      }
    }
  }, [walletAddress, isValidAddress]);

  // Determine role (only owner can exec directly, passkeys use meta transactions)
  const isOwner = connectedAddress && owner && connectedAddress.toLowerCase() === owner.toLowerCase();
  const isLoading = ownerLoading || passkeyCheckLoading;
  const hasPermissions = isOwner;

  // Write contract hooks
  const { writeContractAsync: writeExec, isPending: isTransferPending } = useWriteContract();
  const { writeContractAsync: writeAddPasskey } = useWriteContract();
  const { writeContractAsync: writeBatchExec, isPending: isSwapping } = useWriteContract();

  const handleTransferETH = async () => {
    if (!recipientAddress || !ethAmount) {
      console.log("Missing recipient or amount");
      return;
    }

    // Use resolved ENS address or direct address
    const targetAddress = finalRecipientAddress;

    if (!targetAddress || !isAddress(targetAddress)) {
      console.log("Invalid or unresolved address:", recipientAddress, "->", targetAddress);
      return;
    }

    try {
      console.log("Calling exec with:", {
        walletAddress,
        target: targetAddress,
        value: parseEther(ethAmount).toString(),
        data: "0x",
      });

      await writeExec({
        address: walletAddress as `0x${string}`,
        abi: SMART_WALLET_ABI,
        functionName: "exec",
        args: [targetAddress as `0x${string}`, parseEther(ethAmount), "0x"],
      });

      setRecipientAddress("");
      setEthAmount("");
    } catch (error) {
      console.error("Transfer failed:", error);
    }
  };

  const handleTransferUSDC = async () => {
    if (!usdcRecipientAddress || !usdcAmount) {
      console.log("Missing recipient or amount");
      return;
    }

    // Use resolved ENS address or direct address
    const targetAddress = finalUsdcRecipientAddress;

    if (!targetAddress || !isAddress(targetAddress)) {
      console.log("Invalid or unresolved address:", usdcRecipientAddress, "->", targetAddress);
      return;
    }

    try {
      // Encode the ERC20 transfer call
      const transferData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [targetAddress as `0x${string}`, parseUnits(usdcAmount, USDC_DECIMALS)],
      });

      console.log("Calling exec with USDC transfer:", {
        walletAddress,
        target: USDC_ADDRESS_BASE,
        value: "0",
        data: transferData,
      });

      await writeExec({
        address: walletAddress as `0x${string}`,
        abi: SMART_WALLET_ABI,
        functionName: "exec",
        args: [USDC_ADDRESS_BASE, 0n, transferData],
      });

      setUsdcRecipientAddress("");
      setUsdcAmount("");
    } catch (error) {
      console.error("USDC transfer failed:", error);
    }
  };

  const handleMaxETH = () => {
    if (ethBalance) {
      setEthAmount(formatUnits(ethBalance.value, 18));
    }
  };

  const handleMaxUSDC = () => {
    if (usdcBalance) {
      setUsdcAmount(formatUnits(usdcBalance, USDC_DECIMALS));
    }
  };

  const handleTransferZORA = async () => {
    if (!zoraRecipientAddress || !zoraAmount) {
      console.log("Missing recipient or amount");
      return;
    }

    // Use resolved ENS address or direct address
    const targetAddress = finalZoraRecipientAddress;

    if (!targetAddress || !isAddress(targetAddress)) {
      console.log("Invalid or unresolved address:", zoraRecipientAddress, "->", targetAddress);
      return;
    }

    try {
      // Encode the ERC20 transfer call
      const transferData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [targetAddress as `0x${string}`, parseUnits(zoraAmount, ZORA_DECIMALS)],
      });

      console.log("Calling exec with ZORA transfer:", {
        walletAddress,
        target: ZORA_ADDRESS_BASE,
        value: "0",
        data: transferData,
      });

      await writeExec({
        address: walletAddress as `0x${string}`,
        abi: SMART_WALLET_ABI,
        functionName: "exec",
        args: [ZORA_ADDRESS_BASE, 0n, transferData],
      });

      setZoraRecipientAddress("");
      setZoraAmount("");
    } catch (error) {
      console.error("ZORA transfer failed:", error);
    }
  };

  const handleMaxZORA = () => {
    if (zoraBalance) {
      setZoraAmount(formatUnits(zoraBalance, ZORA_DECIMALS));
    }
  };

  // Passkey handlers

  // Generate a NEW passkey and register it in one flow
  const handleGeneratePasskey = async () => {
    if (!isWebAuthnSupported()) {
      setPasskeyError("WebAuthn is not supported in this browser");
      return;
    }

    setIsGeneratingPasskey(true);
    setPasskeyError(null);

    try {
      // Create a new passkey - this returns qx, qy, credentialId
      const result = await createPasskey();
      const stored: StoredPasskey = {
        credentialId: result.credentialId,
        qx: result.qx,
        qy: result.qy,
        passkeyAddress: result.passkeyAddress,
      };

      // Save to localStorage for convenience
      savePasskeyToStorage(walletAddress, stored);
      setCurrentPasskey(stored);
    } catch (error) {
      console.error("Failed to generate passkey:", error);
      setPasskeyError(error instanceof Error ? error.message : "Failed to generate passkey");
    } finally {
      setIsGeneratingPasskey(false);
    }
  };

  // Login with existing passkey - recovers qx/qy from signature
  // Optimized: if passkey is already registered on-chain, only needs 1 Touch ID
  const handleLoginWithPasskey = async () => {
    if (!isWebAuthnSupported()) {
      setPasskeyError("WebAuthn is not supported in this browser");
      return;
    }

    setIsLoggingIn(true);
    setPasskeyError(null);

    try {
      // Callback to check if a candidate passkey address is registered
      // This enables single-signature login for registered passkeys
      const checkIsPasskey = async (passkeyAddress: `0x${string}`): Promise<boolean> => {
        const result = await readContract(config, {
          address: walletAddress as `0x${string}`,
          abi: SMART_WALLET_ABI,
          functionName: "isPasskey",
          args: [passkeyAddress],
        });
        return result as boolean;
      };

      // Call get() and recover public key from signature
      // If passkey is registered, only needs 1 Touch ID; otherwise needs 2
      const { credentialId, qx, qy, passkeyAddress } = await loginWithPasskey(checkIsPasskey);

      // Build the stored passkey object with recovered public key
      const stored: StoredPasskey = {
        credentialId,
        qx,
        qy,
        passkeyAddress,
      };

      // Save to localStorage for convenience
      savePasskeyToStorage(walletAddress, stored);
      setCurrentPasskey(stored);

      // Refetch registration status for this passkey
      await refetchPasskeyRegistered();
    } catch (error) {
      console.error("Failed to login with passkey:", error);
      setPasskeyError(error instanceof Error ? error.message : "Failed to login with passkey");
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Add passkey - includes credentialIdHash for on-chain lookup
  const handleAddPasskey = async () => {
    if (!currentPasskey) {
      setPasskeyError("No passkey available to add");
      return;
    }

    setIsAddingPasskey(true);
    setPasskeyError(null);

    try {
      // Compute the credentialIdHash for on-chain storage
      const credentialIdHash = getCredentialIdHash(currentPasskey.credentialId);

      await writeAddPasskey({
        address: walletAddress as `0x${string}`,
        abi: SMART_WALLET_ABI,
        functionName: "addPasskey",
        args: [currentPasskey.qx, currentPasskey.qy, credentialIdHash],
      });

      // Refetch registration status and passkeyCreated flag after adding
      await Promise.all([refetchPasskeyRegistered(), refetchPasskeyCreated()]);
    } catch (error) {
      console.error("Failed to add passkey:", error);
      setPasskeyError(error instanceof Error ? error.message : "Failed to add passkey");
    } finally {
      setIsAddingPasskey(false);
    }
  };

  const handleClearPasskey = () => {
    clearPasskeyFromStorage(walletAddress);
    setCurrentPasskey(null);
    setPasskeyError(null);
  };

  // Add external passkey (from another device)
  const handleAddExternalPasskey = async () => {
    if (!externalPasskeyQx || !externalPasskeyQy || !externalPasskeyCredentialId) {
      setExternalPasskeyError("Please fill in all fields (Qx, Qy, and Credential ID)");
      return;
    }

    // Validate hex format
    if (!externalPasskeyQx.startsWith("0x") || externalPasskeyQx.length !== 66) {
      setExternalPasskeyError("Qx must be a 32-byte hex string (0x + 64 hex chars)");
      return;
    }
    if (!externalPasskeyQy.startsWith("0x") || externalPasskeyQy.length !== 66) {
      setExternalPasskeyError("Qy must be a 32-byte hex string (0x + 64 hex chars)");
      return;
    }

    setIsAddingExternalPasskey(true);
    setExternalPasskeyError(null);
    setExternalPasskeySuccess(null);

    try {
      // Compute the credentialIdHash from the provided credential ID
      const credentialIdHash = getCredentialIdHash(externalPasskeyCredentialId);

      await writeAddPasskey({
        address: walletAddress as `0x${string}`,
        abi: SMART_WALLET_ABI,
        functionName: "addPasskey",
        args: [externalPasskeyQx as `0x${string}`, externalPasskeyQy as `0x${string}`, credentialIdHash],
      });

      // Success!
      setExternalPasskeySuccess("External passkey added successfully!");
      setExternalPasskeyQx("");
      setExternalPasskeyQy("");
      setExternalPasskeyCredentialId("");

      // Refetch passkeyCreated flag
      await refetchPasskeyCreated();
    } catch (error) {
      console.error("Failed to add external passkey:", error);
      setExternalPasskeyError(error instanceof Error ? error.message : "Failed to add external passkey");
    } finally {
      setIsAddingExternalPasskey(false);
    }
  };

  // Sign ETH transfer with passkey
  const handleSignWithPasskey = async () => {
    if (!currentPasskey || !finalPasskeyRecipient || !passkeyAmount) {
      setPasskeyError("Missing passkey, recipient, or amount");
      return;
    }

    if (!isAddress(finalPasskeyRecipient)) {
      setPasskeyError("Invalid recipient address");
      return;
    }

    setIsSigningWithPasskey(true);
    setPasskeyError(null);
    setSignedMetaTx(null);

    try {
      // IMPORTANT: Always fetch fresh nonce directly from chain before signing
      // This prevents stale nonce issues when signing multiple transactions in sequence
      const freshNonce = await readContract(config, {
        address: walletAddress as `0x${string}`,
        abi: SMART_WALLET_ABI,
        functionName: "nonces",
        args: [currentPasskey.passkeyAddress],
      });

      console.log("Signing with fresh nonce:", freshNonce);

      const target = finalPasskeyRecipient as `0x${string}`;
      const value = parseEther(passkeyAmount);
      const data = "0x" as `0x${string}`; // Empty data for ETH transfer
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour from now

      // Build the challenge hash
      const challengeHash = buildChallengeHash(
        BigInt(chainId),
        walletAddress as `0x${string}`,
        target,
        value,
        data,
        freshNonce,
        deadline,
      );

      // Convert hash to Uint8Array for WebAuthn
      const challengeBytes = new Uint8Array(
        (challengeHash.slice(2).match(/.{2}/g) || []).map(byte => parseInt(byte, 16)),
      );

      // Sign with passkey
      const { auth } = await signWithPasskey(currentPasskey.credentialId, challengeBytes);

      setSignedMetaTx({
        target,
        value,
        data,
        qx: currentPasskey.qx,
        qy: currentPasskey.qy,
        deadline,
        auth,
      });
    } catch (error) {
      console.error("Failed to sign with passkey:", error);
      setPasskeyError(error instanceof Error ? error.message : "Failed to sign with passkey");
    } finally {
      setIsSigningWithPasskey(false);
    }
  };

  // Relay the signed meta transaction
  const handleRelayTransaction = async () => {
    if (!signedMetaTx) {
      setPasskeyError("No signed transaction to relay");
      return;
    }

    setIsRelaying(true);
    setPasskeyError(null);

    try {
      await writeExec({
        address: walletAddress as `0x${string}`,
        abi: SMART_WALLET_ABI,
        functionName: "metaExecPasskey",
        args: [
          signedMetaTx.target,
          signedMetaTx.value,
          signedMetaTx.data,
          signedMetaTx.qx,
          signedMetaTx.qy,
          signedMetaTx.deadline,
          {
            r: signedMetaTx.auth.r,
            s: signedMetaTx.auth.s,
            challengeIndex: signedMetaTx.auth.challengeIndex,
            typeIndex: signedMetaTx.auth.typeIndex,
            authenticatorData: signedMetaTx.auth.authenticatorData,
            clientDataJSON: signedMetaTx.auth.clientDataJSON,
          },
        ],
      });

      // Clear the form and signed tx on success
      setPasskeyRecipient("");
      setPasskeyAmount("");
      setSignedMetaTx(null);
      // Refetch nonce for next transaction
      await refetchPasskeyNonce();
    } catch (error) {
      console.error("Failed to relay transaction:", error);
      setPasskeyError(error instanceof Error ? error.message : "Failed to relay transaction");
    } finally {
      setIsRelaying(false);
    }
  };

  // Clear signed meta transaction
  const handleClearSignedTx = () => {
    setSignedMetaTx(null);
  };

  // Resolve ENS for quick transfer recipient
  const isQuickTransferRecipientEns = quickTransferRecipient.endsWith(".eth");
  const { data: resolvedQuickTransferRecipient } = useEnsAddress({
    name: isQuickTransferRecipientEns ? normalize(quickTransferRecipient) : undefined,
    chainId: 1,
  });
  const finalQuickTransferRecipient = isQuickTransferRecipientEns
    ? resolvedQuickTransferRecipient
    : quickTransferRecipient;

  // Quick Transfer: Get calldata from API, sign with passkey, submit to facilitator
  const handleQuickTransfer = async () => {
    if (!currentPasskey) {
      setQuickTransferError("Please log in with a passkey first");
      return;
    }

    if (!finalQuickTransferRecipient || !isAddress(finalQuickTransferRecipient)) {
      setQuickTransferError("Invalid recipient address");
      return;
    }

    if (!quickTransferAmount || parseFloat(quickTransferAmount) <= 0) {
      setQuickTransferError("Invalid amount");
      return;
    }

    setIsQuickTransferring(true);
    setQuickTransferError(null);
    setQuickTransferTxHash(null);
    setQuickTransferStatus("Getting transfer data...");

    try {
      // Step 1: Get calldata from the transfer API
      const transferResponse = await fetch("/api/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset: quickTransferAsset,
          amount: quickTransferAmount,
          to: finalQuickTransferRecipient,
        }),
      });

      const transferData = await transferResponse.json();
      if (!transferData.success) {
        throw new Error(transferData.error || "Failed to get transfer calldata");
      }

      setQuickTransferStatus("Please sign with passkey...");

      // Step 2: Get fresh nonce and sign with passkey
      const freshNonce = await readContract(config, {
        address: walletAddress as `0x${string}`,
        abi: SMART_WALLET_ABI,
        functionName: "nonces",
        args: [currentPasskey.passkeyAddress],
        chainId: base.id,
      });

      const target = transferData.call.target as `0x${string}`;
      const value = BigInt(transferData.call.value);
      const data = transferData.call.data as `0x${string}`;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour

      // Build challenge hash for Base chain
      const challengeHash = buildChallengeHash(
        BigInt(base.id),
        walletAddress as `0x${string}`,
        target,
        value,
        data,
        freshNonce,
        deadline,
      );

      // Convert to bytes for WebAuthn
      const challengeBytes = new Uint8Array(
        (challengeHash.slice(2).match(/.{2}/g) || []).map(byte => parseInt(byte, 16)),
      );

      // Sign with passkey
      const { auth } = await signWithPasskey(currentPasskey.credentialId, challengeBytes);

      setQuickTransferStatus("Submitting transaction...");

      // Step 3: Submit to facilitator API
      const facilitateResponse = await fetch("/api/facilitate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smartWalletAddress: walletAddress,
          chainId: base.id,
          isBatch: false,
          calls: [
            {
              target,
              value: value.toString(),
              data,
            },
          ],
          qx: currentPasskey.qx,
          qy: currentPasskey.qy,
          deadline: deadline.toString(),
          auth: {
            r: auth.r,
            s: auth.s,
            challengeIndex: auth.challengeIndex.toString(),
            typeIndex: auth.typeIndex.toString(),
            authenticatorData: auth.authenticatorData,
            clientDataJSON: auth.clientDataJSON,
          },
        }),
      });

      const facilitateData = await facilitateResponse.json();

      if (facilitateData.success && facilitateData.txHash) {
        setQuickTransferTxHash(facilitateData.txHash);
        setQuickTransferStatus("Transaction confirmed!");
        // Clear the form
        setQuickTransferRecipient("");
        setQuickTransferAmount("");
        // Refetch nonce
        await refetchPasskeyNonce();
      } else {
        throw new Error(facilitateData.error || "Transaction failed");
      }
    } catch (error) {
      console.error("[Quick Transfer] Error:", error);
      setQuickTransferError(error instanceof Error ? error.message : "Transfer failed");
      setQuickTransferStatus(null);
    } finally {
      setIsQuickTransferring(false);
    }
  };

  // ===========================================
  // Quick Swap Functions
  // ===========================================

  // Fetch swap quote when amount changes
  useEffect(() => {
    const fetchQuote = async () => {
      if (!debouncedSwapAmount || parseFloat(debouncedSwapAmount) <= 0) {
        setSwapQuote(null);
        return;
      }

      setIsLoadingQuote(true);
      setSwapError(null);

      try {
        const from = swapDirection === "USDC_TO_ETH" ? "USDC" : "ETH";
        const to = swapDirection === "USDC_TO_ETH" ? "ETH" : "USDC";

        const response = await fetch(`/api/swap/quote?from=${from}&to=${to}&amountIn=${debouncedSwapAmount}`);
        const data = await response.json();

        if (data.error) {
          setSwapError(data.error);
          setSwapQuote(null);
        } else {
          setSwapQuote({
            amountOut: data.amountOut,
            amountOutRaw: data.amountOutRaw,
            pricePerToken: data.pricePerToken,
          });
        }
      } catch (error) {
        console.error("[Swap Quote] Error:", error);
        setSwapError("Failed to fetch quote");
        setSwapQuote(null);
      } finally {
        setIsLoadingQuote(false);
      }
    };

    fetchQuote();
  }, [debouncedSwapAmount, swapDirection]);

  // Execute swap: get calldata, sign with passkey, submit to facilitator
  const handleQuickSwap = async () => {
    if (!currentPasskey) {
      setSwapError("Please log in with a passkey first");
      return;
    }

    if (!swapAmountIn || parseFloat(swapAmountIn) <= 0) {
      setSwapError("Invalid amount");
      return;
    }

    if (!swapQuote) {
      setSwapError("Please wait for quote");
      return;
    }

    setIsQuickSwapping(true);
    setSwapError(null);
    setSwapTxHash(null);
    setSwapStatus("Getting swap data...");

    try {
      const from = swapDirection === "USDC_TO_ETH" ? "USDC" : "ETH";
      const to = swapDirection === "USDC_TO_ETH" ? "ETH" : "USDC";

      // Apply 0.5% slippage tolerance
      const amountOutNum = parseFloat(swapQuote.amountOut);
      const amountOutMinimum = (amountOutNum * 0.995).toString();

      // Step 1: Get swap calldata from API
      const swapResponse = await fetch("/api/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to,
          amountIn: swapAmountIn,
          amountOutMinimum,
          recipient: walletAddress,
        }),
      });

      const swapData = await swapResponse.json();
      if (!swapData.success) {
        throw new Error(swapData.error || "Failed to get swap calldata");
      }

      setSwapStatus("Please sign with passkey...");

      // Step 2: Get fresh nonce and build challenge hash for batch
      const freshNonce = await readContract(config, {
        address: walletAddress as `0x${string}`,
        abi: SMART_WALLET_ABI,
        functionName: "nonces",
        args: [currentPasskey.passkeyAddress],
        chainId: base.id,
      });

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour

      // Convert calls from API response to proper format
      const calls = swapData.calls.map((call: { target: string; value: string; data: string }) => ({
        target: call.target as `0x${string}`,
        value: BigInt(call.value),
        data: call.data as `0x${string}`,
      }));

      // Build challenge hash - use batch format for multiple calls, single format for one call
      let challengeHash: `0x${string}`;
      if (calls.length > 1) {
        // Import buildBatchChallengeHash for multi-call transactions
        const { buildBatchChallengeHash } = await import("~~/utils/passkey");
        challengeHash = buildBatchChallengeHash(
          BigInt(base.id),
          walletAddress as `0x${string}`,
          calls,
          freshNonce,
          deadline,
        );
      } else {
        // Single call - use single tx challenge hash
        const call = calls[0];
        challengeHash = buildChallengeHash(
          BigInt(base.id),
          walletAddress as `0x${string}`,
          call.target,
          call.value,
          call.data,
          freshNonce,
          deadline,
        );
      }

      // Convert to bytes for WebAuthn
      const challengeBytes = new Uint8Array(
        (challengeHash.slice(2).match(/.{2}/g) || []).map(byte => parseInt(byte, 16)),
      );

      // Sign with passkey
      const { auth } = await signWithPasskey(currentPasskey.credentialId, challengeBytes);

      setSwapStatus("Submitting transaction...");

      // Step 3: Submit to facilitator API
      const facilitateResponse = await fetch("/api/facilitate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smartWalletAddress: walletAddress,
          chainId: base.id,
          isBatch: calls.length > 1,
          calls: calls.map((c: { target: string; value: bigint; data: string }) => ({
            target: c.target,
            value: c.value.toString(),
            data: c.data,
          })),
          qx: currentPasskey.qx,
          qy: currentPasskey.qy,
          deadline: deadline.toString(),
          auth: {
            r: auth.r,
            s: auth.s,
            challengeIndex: auth.challengeIndex.toString(),
            typeIndex: auth.typeIndex.toString(),
            authenticatorData: auth.authenticatorData,
            clientDataJSON: auth.clientDataJSON,
          },
        }),
      });

      const facilitateData = await facilitateResponse.json();

      if (facilitateData.success && facilitateData.txHash) {
        setSwapTxHash(facilitateData.txHash);
        setSwapStatus("Swap completed!");
        // Clear the form
        setSwapAmountIn("");
        setSwapQuote(null);
        // Refetch nonce
        await refetchPasskeyNonce();
      } else {
        throw new Error(facilitateData.error || "Swap failed");
      }
    } catch (error) {
      console.error("[Quick Swap] Error:", error);
      setSwapError(error instanceof Error ? error.message : "Swap failed");
      setSwapStatus(null);
    } finally {
      setIsQuickSwapping(false);
    }
  };

  // ===========================================
  // Pending Transaction Queue Handlers
  // ===========================================

  // Add a transaction to the pending queue (called by Impersonator, WalletConnect, etc.)
  const addPendingTransaction = (pendingTx: PendingTransaction) => {
    setPendingTransactions(prev => [...prev, pendingTx]);
  };

  // Update the status of a pending transaction
  const updatePendingStatus = (id: string, status: PendingTransactionStatus, error?: string) => {
    setPendingTransactions(prev => prev.map(tx => (tx.id === id ? { ...tx, status, error: error || tx.error } : tx)));
  };

  // Remove a pending transaction
  const removePendingTransaction = (id: string) => {
    setPendingTransactions(prev => prev.filter(tx => tx.id !== id));
  };

  // Add a signed transaction
  const addSignedTransaction = (signedTx: SignedTransaction) => {
    setSignedTransactions(prev => [...prev, signedTx]);
  };

  // Remove a signed transaction
  const removeSignedTransaction = (pendingTxId: string) => {
    setSignedTransactions(prev => prev.filter(tx => tx.pendingTxId !== pendingTxId));
  };

  // Handler for Impersonator sendTransaction - adds to queue instead of executing
  const handleImpersonatorTransaction = (tx: {
    to?: string;
    value?: string | bigint;
    data?: string;
  }): Promise<string> => {
    return new Promise((resolve, reject) => {
      try {
        const pendingTx = createPendingTransaction(
          "impersonator",
          [
            {
              target: (tx.to || "0x0000000000000000000000000000000000000000") as `0x${string}`,
              value: BigInt(tx.value?.toString() || "0"),
              data: (tx.data || "0x") as `0x${string}`,
            },
          ],
          {
            appName: "Impersonator dApp",
            appUrl: debouncedAppUrl,
          },
        );

        addPendingTransaction(pendingTx);

        // Return a placeholder hash - the actual tx will be relayed after signing
        // This allows the dApp to continue its flow
        resolve(`0x${"0".repeat(64)}` as `0x${string}`);
      } catch (error) {
        reject(error);
      }
    });
  };

  const handleSwapUSDCtoETH = async () => {
    try {
      // Amount: 0.01 USDC = 10000 (6 decimals)
      const swapAmount = 10000n;

      // 1. Encode USDC approve call
      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [SWAP_ROUTER_ADDRESS, swapAmount],
      });

      // 2. Encode exactInputSingle call (USDC -> WETH, recipient = SwapRouter)
      const swapData = encodeFunctionData({
        abi: SWAP_ROUTER_ABI,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn: USDC_ADDRESS_BASE,
            tokenOut: WETH_ADDRESS_BASE,
            fee: 500, // 0.05% fee tier
            recipient: SWAP_ROUTER_ADDRESS, // WETH goes to router temporarily
            amountIn: swapAmount,
            amountOutMinimum: 0n, // No slippage protection for demo
            sqrtPriceLimitX96: 0n,
          },
        ],
      });

      // 3. Encode unwrapWETH9 call (unwrap WETH to ETH, send to wallet)
      const unwrapData = encodeFunctionData({
        abi: SWAP_ROUTER_ABI,
        functionName: "unwrapWETH9",
        args: [0n, walletAddress as `0x${string}`],
      });

      console.log("Executing swap batch:", {
        approve: { target: USDC_ADDRESS_BASE, data: approveData },
        swap: { target: SWAP_ROUTER_ADDRESS, data: swapData },
        unwrap: { target: SWAP_ROUTER_ADDRESS, data: unwrapData },
      });

      // Execute all 3 calls atomically via batchExec
      await writeBatchExec({
        address: walletAddress as `0x${string}`,
        abi: SMART_WALLET_ABI,
        functionName: "batchExec",
        args: [
          [
            { target: USDC_ADDRESS_BASE, value: 0n, data: approveData },
            { target: SWAP_ROUTER_ADDRESS, value: 0n, data: swapData },
            { target: SWAP_ROUTER_ADDRESS, value: 0n, data: unwrapData },
          ],
        ],
      });

      console.log("Swap completed successfully!");
    } catch (error) {
      console.error("Swap failed:", error);
    }
  };

  // Parse value string to bigint (supports both ETH notation like "0.1" and raw wei)
  const parseValueString = (value: string): bigint => {
    // If it's a very large number string (likely wei), parse directly
    if (/^\d{10,}$/.test(value)) {
      return BigInt(value);
    }
    // Otherwise treat as ETH amount
    return parseEther(value || "0");
  };

  // Parse and validate raw transaction JSON
  const handleParseRawTx = () => {
    setParseError(null);
    setParsedTx(null);

    if (!rawTxJson.trim()) {
      setParseError("Please enter transaction JSON");
      return;
    }

    try {
      const parsed = JSON.parse(rawTxJson);

      // Check if it's a batch transaction
      if (parsed.calls && Array.isArray(parsed.calls)) {
        const calls = parsed.calls.map((call: { target: string; value: string; data: string }, index: number) => {
          if (!call.target || !isAddress(call.target)) {
            throw new Error(`Invalid target address in call ${index + 1}`);
          }
          if (!call.data || !isHex(call.data)) {
            throw new Error(`Invalid data in call ${index + 1} (must be hex string starting with 0x)`);
          }
          return {
            target: call.target,
            value: parseValueString(call.value || "0"),
            data: call.data as `0x${string}`,
          };
        });

        setParsedTx({ isBatch: true, calls });
      }
      // Single transaction
      else if (parsed.target) {
        if (!isAddress(parsed.target)) {
          throw new Error("Invalid target address");
        }
        if (!parsed.data || !isHex(parsed.data)) {
          throw new Error("Invalid data (must be hex string starting with 0x)");
        }

        setParsedTx({
          isBatch: false,
          calls: [
            {
              target: parsed.target,
              value: parseValueString(parsed.value || "0"),
              data: parsed.data as `0x${string}`,
            },
          ],
        });
      } else {
        throw new Error("Invalid format. Expected { target, value, data } or { calls: [...] }");
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        setParseError("Invalid JSON syntax");
      } else if (error instanceof Error) {
        setParseError(error.message);
      } else {
        setParseError("Failed to parse transaction");
      }
    }
  };

  // Add the parsed raw transaction to the pending queue for passkey signing
  const handleAddRawTxToQueue = () => {
    if (!parsedTx) return;

    const pendingTx = createPendingTransaction(
      "manual",
      parsedTx.calls.map(c => ({
        target: c.target as `0x${string}`,
        value: c.value,
        data: c.data,
      })),
      {
        appName: "Raw Transaction",
      },
    );

    addPendingTransaction(pendingTx);

    // Clear the form after adding to queue
    setRawTxJson("");
    setParsedTx(null);
    console.log("Raw transaction added to queue for passkey signing");
  };

  // Clear the raw tx form
  const handleClearRawTx = () => {
    setRawTxJson("");
    setParsedTx(null);
    setParseError(null);
  };

  // Get function selector (first 4 bytes) from calldata
  const getFunctionSelector = (data: string): string => {
    if (data.length >= 10) {
      return data.slice(0, 10);
    }
    return data;
  };

  // AI Agent handler
  const handleAgentSubmit = async () => {
    if (!agentPrompt.trim()) return;

    setIsAgentLoading(true);
    setAgentError(null);
    setAgentResponse(null);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: agentPrompt, walletAddress }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Agent request failed");
      }

      if (data.response) {
        // Text response - display it
        setAgentResponse(data.response);
      } else if (data.calls && Array.isArray(data.calls)) {
        // Transaction batch - parse and add to pending queue
        const calls = data.calls.map((call: { target: string; value: string; data: string }) => ({
          target: call.target as `0x${string}`,
          value: BigInt(call.value || "0"),
          data: call.data as `0x${string}`,
        }));

        const pendingTx = createPendingTransaction("manual", calls, { appName: "AI Agent" });
        addPendingTransaction(pendingTx);

        // Clear prompt on success
        setAgentPrompt("");
        setAgentResponse("Transaction added to queue. Sign with your passkey below.");
      } else {
        // Unexpected format
        setAgentResponse(JSON.stringify(data, null, 2));
      }
    } catch (error) {
      console.error("Agent error:", error);
      setAgentError(error instanceof Error ? error.message : "Failed to get agent response");
    } finally {
      setIsAgentLoading(false);
    }
  };

  if (!isValidAddress) {
    return (
      <div className="flex flex-col items-center pt-10 px-4">
        <div className="max-w-2xl w-full text-center">
          <h1 className="text-4xl font-bold mb-4">Invalid Address</h1>
          <p className="opacity-70">The address provided is not a valid Ethereum address.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center pt-10 px-4">
      {/* ... JSX content continues - see full component for render logic */}
    </div>
  );
};

export default WalletPage;
```

---

## Key Dependencies

- `@impersonator/iframe` - For dApp impersonation
- `@scaffold-ui/components` - Address, AddressInput, Balance components
- `qrcode.react` - QR code generation
- `usehooks-ts` - useDebounceValue
- `viem` - Ethereum utilities
- `wagmi` - React hooks for Ethereum

## Related Files

- `~~/utils/passkey` - Passkey utilities (createPasskey, loginWithPasskey, signWithPasskey, etc.)
- `~~/contracts/SmartWalletAbi` - Smart wallet ABI
- `~~/types/pendingTransaction` - Pending transaction types
- `~~/components/scaffold-eth` - PendingTransactionQueue, WalletConnectSection

## API Endpoints Used

- `/api/transfer` - Get transfer calldata
- `/api/facilitate` - Submit signed transactions for relay
- `/api/swap/quote` - Get swap price quotes
- `/api/swap` - Get swap calldata
- `/api/agent` - AI agent for natural language transactions

