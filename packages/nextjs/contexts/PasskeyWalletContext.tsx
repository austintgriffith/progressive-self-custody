"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import deployedContracts from "~~/contracts/deployedContracts";
import externalContracts, { ERC20_ABI } from "~~/contracts/externalContracts";
import { escapeToNativeBrowser, isPasskeyNotAllowedError } from "~~/utils/browserEscape";
import {
  StoredPasskey,
  createPasskey,
  getCredentialIdHash,
  getPasskeyFromStorage,
  isWebAuthnSupported,
  loginWithPasskey,
  signWithPasskey,
} from "~~/utils/passkey";

// localStorage keys
const ACCOUNTS_KEY = "psc-accounts";
const CURRENT_ACCOUNT_KEY = "psc-current-account";
const PENDING_WALLET_KEY = "psc-pending-wallet";
const LAST_LOGIN_KEY = "psc-last-login"; // { [address]: timestamp }

// Get SmartWallet ABI from auto-generated deployedContracts
function getSmartWalletAbi(chainId: number) {
  const contracts = deployedContracts[chainId as keyof typeof deployedContracts];
  return contracts?.SmartWallet?.abi;
}

// Get USDC address from external contracts
function getUsdcAddress(chainId: number): `0x${string}` {
  const contracts = externalContracts[chainId as keyof typeof externalContracts];
  if (contracts?.USDC?.address) {
    return contracts.USDC.address as `0x${string}`;
  }
  return "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
}

// Helper to get known accounts from localStorage
function getKnownAccountsFromStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem(ACCOUNTS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

// Helper to save known accounts to localStorage
function saveKnownAccountsToStorage(accounts: string[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

// Helper to add account to known accounts
function addAccountToStorage(address: string): void {
  const accounts = getKnownAccountsFromStorage();
  const normalizedAddress = address.toLowerCase();
  if (!accounts.includes(normalizedAddress)) {
    accounts.push(normalizedAddress);
    saveKnownAccountsToStorage(accounts);
  }
}

// Helper to remove account from known accounts
function removeAccountFromStorage(address: string): void {
  const accounts = getKnownAccountsFromStorage();
  const normalizedAddress = address.toLowerCase();
  const filtered = accounts.filter(a => a !== normalizedAddress);
  saveKnownAccountsToStorage(filtered);
}

// Helper to get last login timestamps
function getLastLoginTimes(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const data = localStorage.getItem(LAST_LOGIN_KEY);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}

// Helper to update last login time for an account
function updateLastLoginTime(address: string): void {
  if (typeof window === "undefined") return;
  const times = getLastLoginTimes();
  times[address.toLowerCase()] = Date.now();
  localStorage.setItem(LAST_LOGIN_KEY, JSON.stringify(times));
}

// Helper to remove last login time for an account
function removeLastLoginTime(address: string): void {
  if (typeof window === "undefined") return;
  const times = getLastLoginTimes();
  delete times[address.toLowerCase()];
  localStorage.setItem(LAST_LOGIN_KEY, JSON.stringify(times));
}

// Helper to get accounts sorted by last login (most recent first)
function getSortedKnownAccounts(): string[] {
  const accounts = getKnownAccountsFromStorage();
  const times = getLastLoginTimes();
  return accounts.sort((a, b) => {
    const timeA = times[a] || 0;
    const timeB = times[b] || 0;
    return timeB - timeA; // Most recent first
  });
}

export interface TransactionResult {
  txHash: string;
  diceRollResult?: {
    won: boolean;
    payout: string;
  };
}

export interface PasskeyWalletContextType {
  // State
  walletAddress: string | null;
  passkey: StoredPasskey | null;
  usdcBalance: bigint;
  ethBalance: bigint;
  isDeployed: boolean | null;
  isLoading: boolean;
  isCreating: boolean;
  isDeploying: boolean;
  error: string | null;
  withdrawAddress: string | null;
  walletGuardian: string | null;
  knownAccounts: string[];
  requiresBrowserEscape: boolean;

  // Methods
  createAccount: () => Promise<void>;
  loginWithExistingPasskey: () => Promise<void>;
  loginToAccount: (address: string) => void;
  signAndSubmit: (action: string, params: Record<string, string>) => Promise<TransactionResult>;
  refreshBalances: () => Promise<void>;
  logout: () => void;
  forgetAccount: (address: string) => void;
  setError: (error: string | null) => void;
  clearError: () => void;

  // Constants
  chainId: number;
  usdcAddress: `0x${string}`;
  SMART_WALLET_ABI: ReturnType<typeof getSmartWalletAbi>;
}

const PasskeyWalletContext = createContext<PasskeyWalletContextType | null>(null);

export function PasskeyWalletProvider({ children }: { children: React.ReactNode }) {
  const publicClient = usePublicClient();

  // Chain config - Base mainnet
  const chainId = 8453;
  const usdcAddress = getUsdcAddress(chainId);
  const SMART_WALLET_ABI = getSmartWalletAbi(chainId);

  // Wallet state
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [passkey, setPasskey] = useState<StoredPasskey | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<bigint>(0n);
  const [ethBalance, setEthBalance] = useState<bigint>(0n);
  const [isDeployed, setIsDeployed] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withdrawAddress, setWithdrawAddress] = useState<string | null>(null);
  const [walletGuardian, setWalletGuardian] = useState<string | null>(null);
  const [knownAccounts, setKnownAccounts] = useState<string[]>([]);
  const [requiresBrowserEscape, setRequiresBrowserEscape] = useState(false);

  // Ref to track if deployment has been attempted
  const deploymentAttemptedRef = useRef(false);

  // Load wallet from localStorage on mount
  useEffect(() => {
    const loadWallet = () => {
      // Load known accounts (sorted by last login)
      const accounts = getSortedKnownAccounts();
      setKnownAccounts(accounts);

      // Check for pending wallet first (mid-creation flow)
      const pendingWallet = localStorage.getItem(PENDING_WALLET_KEY);
      if (pendingWallet) {
        setWalletAddress(pendingWallet);
        const stored = getPasskeyFromStorage(pendingWallet);
        if (stored) {
          setPasskey(stored);
        }
        // Set as current account
        localStorage.setItem(CURRENT_ACCOUNT_KEY, pendingWallet.toLowerCase());
        setIsLoading(false);
        return;
      }

      // Check for current account (logged in)
      const currentAccount = localStorage.getItem(CURRENT_ACCOUNT_KEY);
      if (currentAccount) {
        setWalletAddress(currentAccount);
        const stored = getPasskeyFromStorage(currentAccount);
        if (stored) {
          setPasskey(stored);
        }
        setIsLoading(false);
        return;
      }

      // No current session
      setIsLoading(false);
    };

    loadWallet();
  }, []);

  // Fetch wallet data when address is set
  useEffect(() => {
    if (!walletAddress || !publicClient) return;

    const fetchData = async () => {
      try {
        // Check if wallet contract is deployed
        const code = await publicClient.getBytecode({ address: walletAddress as `0x${string}` });
        const deployed = code !== undefined && code !== "0x";
        setIsDeployed(deployed);

        // Fetch balances
        const usdcBal = await publicClient.readContract({
          address: usdcAddress,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [walletAddress as `0x${string}`],
        });
        setUsdcBalance(usdcBal as bigint);

        const ethBal = await publicClient.getBalance({
          address: walletAddress as `0x${string}`,
        });
        setEthBalance(ethBal);

        // Only read contract state if deployed
        if (deployed && SMART_WALLET_ABI) {
          const withdrawAddr = await publicClient.readContract({
            address: walletAddress as `0x${string}`,
            abi: SMART_WALLET_ABI,
            functionName: "withdrawAddress",
          });
          if (withdrawAddr && withdrawAddr !== "0x0000000000000000000000000000000000000000") {
            setWithdrawAddress(withdrawAddr as string);
          }

          const guardian = await publicClient.readContract({
            address: walletAddress as `0x${string}`,
            abi: SMART_WALLET_ABI,
            functionName: "guardian",
          });
          setWalletGuardian(guardian as string);
        }
      } catch (err) {
        console.error("Error fetching wallet data:", err);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [walletAddress, publicClient, usdcAddress, SMART_WALLET_ABI]);

  // Auto-deploy wallet when funded but not deployed
  useEffect(() => {
    if (isDeployed === false && usdcBalance > 0n && passkey && !isDeploying && !deploymentAttemptedRef.current) {
      deploymentAttemptedRef.current = true;

      const deployWallet = async () => {
        setIsDeploying(true);
        setError(null);

        try {
          const storedData = localStorage.getItem(`psc-passkey-${walletAddress?.toLowerCase()}`);
          const parsed = storedData ? JSON.parse(storedData) : null;
          const credentialIdHash = parsed?.credentialIdHash;

          if (!credentialIdHash) {
            throw new Error("Missing credential ID hash");
          }

          const response = await fetch("/api/deploy-wallet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chainId,
              qx: passkey.qx,
              qy: passkey.qy,
              credentialIdHash,
            }),
          });

          const data = await response.json();

          if (data.success) {
            setIsDeployed(true);
            // Clear pending wallet flag
            localStorage.removeItem(PENDING_WALLET_KEY);
          } else {
            throw new Error(data.error || "Deployment failed");
          }
        } catch (err) {
          console.error("Deployment error:", err);
          setError(err instanceof Error ? err.message : "Failed to deploy wallet");
        } finally {
          setIsDeploying(false);
        }
      };

      deployWallet();
    }
  }, [isDeployed, usdcBalance, passkey, isDeploying, walletAddress, chainId]);

  // Create new account
  const createAccount = useCallback(async () => {
    if (!isWebAuthnSupported()) {
      setError("WebAuthn is not supported in this browser");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const { credentialId, qx, qy, passkeyAddress } = await createPasskey();

      // Predict wallet address
      const response = await fetch(`/api/deploy-wallet?chainId=${chainId}&qx=${qx}&qy=${qy}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to predict wallet address");
      }

      const walletAddr = data.walletAddress.toLowerCase();

      // Store passkey info
      const passkeyData = {
        credentialId,
        qx,
        qy,
        passkeyAddress,
        credentialIdHash: getCredentialIdHash(credentialId),
      };
      localStorage.setItem(`psc-passkey-${walletAddr}`, JSON.stringify(passkeyData));
      localStorage.setItem(PENDING_WALLET_KEY, data.walletAddress);

      // Add to known accounts and update last login time
      addAccountToStorage(walletAddr);
      updateLastLoginTime(walletAddr);
      setKnownAccounts(getSortedKnownAccounts());

      // Set as current account
      localStorage.setItem(CURRENT_ACCOUNT_KEY, walletAddr);

      // Update state
      setWalletAddress(data.walletAddress);
      setPasskey({ credentialId, qx, qy, passkeyAddress });
      setIsDeployed(false);
      deploymentAttemptedRef.current = false;
    } catch (err) {
      console.error("Create account error:", err);
      // Check if this is an in-app browser that doesn't support passkeys
      if (isPasskeyNotAllowedError(err)) {
        // Try to escape to native browser immediately
        escapeToNativeBrowser();
        // If we're still here after a moment, show the fallback UI
        setTimeout(() => {
          setRequiresBrowserEscape(true);
          setError("This browser doesn't support passkeys. Please open in your device's browser.");
        }, 500);
      } else {
        setError(err instanceof Error ? err.message : "Failed to create account");
      }
    } finally {
      setIsCreating(false);
    }
  }, [chainId]);

  // Login with existing passkey (discovers a new passkey not in known accounts)
  const loginWithExistingPasskey = useCallback(async () => {
    if (!isWebAuthnSupported()) {
      setError("WebAuthn is not supported in this browser");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const { credentialId, qx, qy, passkeyAddress } = await loginWithPasskey();

      // Predict wallet address
      const response = await fetch(`/api/deploy-wallet?chainId=${chainId}&qx=${qx}&qy=${qy}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to find wallet");
      }

      const walletAddr = data.walletAddress.toLowerCase();

      // Store passkey info
      const passkeyData = {
        credentialId,
        qx,
        qy,
        passkeyAddress,
        credentialIdHash: getCredentialIdHash(credentialId),
      };
      localStorage.setItem(`psc-passkey-${walletAddr}`, JSON.stringify(passkeyData));

      // Add to known accounts and update last login time
      addAccountToStorage(walletAddr);
      updateLastLoginTime(walletAddr);
      setKnownAccounts(getSortedKnownAccounts());

      // Set as current account
      localStorage.setItem(CURRENT_ACCOUNT_KEY, walletAddr);

      // Update state
      setWalletAddress(data.walletAddress);
      setPasskey({ credentialId, qx, qy, passkeyAddress });
      deploymentAttemptedRef.current = false;
    } catch (err) {
      console.error("Login error:", err);
      // Check if this is an in-app browser that doesn't support passkeys
      if (isPasskeyNotAllowedError(err)) {
        // Try to escape to native browser immediately
        escapeToNativeBrowser();
        // If we're still here after a moment, show the fallback UI
        setTimeout(() => {
          setRequiresBrowserEscape(true);
          setError("This browser doesn't support passkeys. Please open in your device's browser.");
        }, 500);
      } else {
        setError(err instanceof Error ? err.message : "Failed to login");
      }
    } finally {
      setIsCreating(false);
    }
  }, [chainId]);

  // Login to a known account (no passkey auth needed - just switches session)
  // Passkey auth happens at transaction time via signAndSubmit
  const loginToAccount = useCallback((address: string) => {
    // Get stored passkey data for this address
    const stored = getPasskeyFromStorage(address);
    if (!stored) {
      setError("No passkey found for this account");
      return;
    }

    // Set session and update last login time
    const targetWallet = address.toLowerCase();
    localStorage.setItem(CURRENT_ACCOUNT_KEY, targetWallet);
    updateLastLoginTime(targetWallet);
    setKnownAccounts(getSortedKnownAccounts());

    // Update state
    setWalletAddress(address);
    setPasskey(stored);
    setUsdcBalance(0n);
    setEthBalance(0n);
    setIsDeployed(null);
    setWithdrawAddress(null);
    setWalletGuardian(null);
    deploymentAttemptedRef.current = false;
  }, []);

  // Sign and submit transaction
  const signAndSubmit = useCallback(
    async (action: string, params: Record<string, string>): Promise<TransactionResult> => {
      if (!passkey) {
        throw new Error("Please login with your passkey first");
      }
      if (!walletAddress) {
        throw new Error("No wallet address");
      }

      // Get prepared transaction from API
      const prepareRes = await fetch("/api/prepare-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId,
          wallet: walletAddress,
          action,
          params,
        }),
      });

      const prepareData = await prepareRes.json();
      if (!prepareData.success) {
        throw new Error(prepareData.error || "Failed to prepare transaction");
      }

      // Build challenge bytes
      const challengeBytes = new Uint8Array(
        (prepareData.challengeHash.slice(2).match(/.{2}/g) || []).map((byte: string) => parseInt(byte, 16)),
      );

      // Sign with passkey
      const { auth } = await signWithPasskey(passkey.credentialId, challengeBytes);

      // Submit to facilitator
      const facilitateRes = await fetch("/api/facilitate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smartWalletAddress: walletAddress,
          chainId,
          functionName: prepareData.functionName,
          calls: prepareData.calls,
          params: prepareData.params,
          deadline: prepareData.deadline,
          auth: {
            authenticatorData: auth.authenticatorData,
            clientDataJSON: auth.clientDataJSON,
            challengeIndex: auth.challengeIndex.toString(),
            typeIndex: auth.typeIndex.toString(),
            r: auth.r,
            s: auth.s,
          },
        }),
      });

      const facilitateData = await facilitateRes.json();

      if (facilitateData.success && facilitateData.txHash) {
        return {
          txHash: facilitateData.txHash,
          diceRollResult: facilitateData.diceRollResult,
        };
      } else {
        throw new Error(facilitateData.error || "Transaction failed");
      }
    },
    [passkey, walletAddress, chainId],
  );

  // Refresh balances manually
  const refreshBalances = useCallback(async () => {
    if (!walletAddress || !publicClient) return;

    try {
      const usdcBal = await publicClient.readContract({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [walletAddress as `0x${string}`],
      });
      setUsdcBalance(usdcBal as bigint);

      const ethBal = await publicClient.getBalance({
        address: walletAddress as `0x${string}`,
      });
      setEthBalance(ethBal);
    } catch (err) {
      console.error("Error refreshing balances:", err);
    }
  }, [walletAddress, publicClient, usdcAddress]);

  // Logout - only clears session, keeps passkey data
  const logout = useCallback(() => {
    localStorage.removeItem(CURRENT_ACCOUNT_KEY);
    localStorage.removeItem(PENDING_WALLET_KEY);
    setWalletAddress(null);
    setPasskey(null);
    setUsdcBalance(0n);
    setEthBalance(0n);
    setIsDeployed(null);
    setWithdrawAddress(null);
    setWalletGuardian(null);
    deploymentAttemptedRef.current = false;
  }, []);

  // Forget account - removes from known accounts AND deletes passkey data
  const forgetAccount = useCallback(
    (address: string) => {
      const normalizedAddress = address.toLowerCase();

      // Remove from known accounts and last login time
      removeAccountFromStorage(normalizedAddress);
      removeLastLoginTime(normalizedAddress);
      setKnownAccounts(getSortedKnownAccounts());

      // Remove passkey data
      localStorage.removeItem(`psc-passkey-${normalizedAddress}`);

      // If this was the current account, logout
      if (walletAddress?.toLowerCase() === normalizedAddress) {
        logout();
      }
    },
    [walletAddress, logout],
  );

  const clearError = useCallback(() => setError(null), []);

  const value: PasskeyWalletContextType = {
    walletAddress,
    passkey,
    usdcBalance,
    ethBalance,
    isDeployed,
    isLoading,
    isCreating,
    isDeploying,
    error,
    withdrawAddress,
    walletGuardian,
    knownAccounts,
    requiresBrowserEscape,
    createAccount,
    loginWithExistingPasskey,
    loginToAccount,
    signAndSubmit,
    refreshBalances,
    logout,
    forgetAccount,
    setError,
    clearError,
    chainId,
    usdcAddress,
    SMART_WALLET_ABI,
  };

  return <PasskeyWalletContext.Provider value={value}>{children}</PasskeyWalletContext.Provider>;
}

export function usePasskeyWallet() {
  const context = useContext(PasskeyWalletContext);
  if (!context) {
    throw new Error("usePasskeyWallet must be used within a PasskeyWalletProvider");
  }
  return context;
}
