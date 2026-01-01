"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { concat, formatUnits, isAddress, keccak256, toHex } from "viem";
import { usePublicClient } from "wagmi";
import { ArrowDownTrayIcon, ArrowUpTrayIcon, Cog6ToothIcon, CreditCardIcon } from "@heroicons/react/24/outline";
import { ERC20_ABI, SMART_WALLET_ABI } from "~~/contracts/SmartWalletAbi";
import {
  StoredPasskey,
  getPasskeyFromStorage,
  isWebAuthnSupported,
  loginWithPasskey,
  savePasskeyToStorage,
  signWithPasskey,
} from "~~/utils/passkey";

// USDC addresses per chain
const USDC_ADDRESSES: Record<number, `0x${string}`> = {
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  31337: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
};

const USDC_DECIMALS = 6;

export default function WalletPage() {
  const params = useParams();
  const router = useRouter();
  const walletAddress = params.address as string;
  const publicClient = usePublicClient();

  // Wallet state
  const [usdcBalance, setUsdcBalance] = useState<bigint>(0n);
  const [ethBalance, setEthBalance] = useState<bigint>(0n);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Passkey state
  const [currentPasskey, setCurrentPasskey] = useState<StoredPasskey | null>(null);
  const [, setIsPasskeyRegistered] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Transaction state
  const [activeTab, setActiveTab] = useState<"balance" | "deposit" | "withdraw" | "pay" | "settings">("balance");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Settings state
  const [withdrawAddress, setWithdrawAddressState] = useState<string | null>(null);
  const [newWithdrawAddress, setNewWithdrawAddress] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [hasRecoveryPassword, setHasRecoveryPassword] = useState(false);

  // Chain ID (default to local for now)
  const chainId = 31337;
  const usdcAddress = USDC_ADDRESSES[chainId];

  // Validate address
  const isValidAddress = walletAddress && isAddress(walletAddress);

  // Load passkey from storage on mount
  useEffect(() => {
    if (isValidAddress && typeof window !== "undefined") {
      const stored = getPasskeyFromStorage(walletAddress);
      if (stored) {
        setCurrentPasskey(stored);
      }
    }
  }, [walletAddress, isValidAddress]);

  // Fetch wallet data
  useEffect(() => {
    if (!isValidAddress || !publicClient) return;

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Fetch USDC balance
        const usdcBal = await publicClient.readContract({
          address: usdcAddress,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [walletAddress as `0x${string}`],
        });
        setUsdcBalance(usdcBal as bigint);

        // Fetch ETH balance
        const ethBal = await publicClient.getBalance({
          address: walletAddress as `0x${string}`,
        });
        setEthBalance(ethBal);

        // Check if passkey is registered
        if (currentPasskey) {
          const isRegistered = await publicClient.readContract({
            address: walletAddress as `0x${string}`,
            abi: SMART_WALLET_ABI,
            functionName: "isPasskey",
            args: [currentPasskey.passkeyAddress],
          });
          setIsPasskeyRegistered(isRegistered as boolean);
        }

        // Fetch withdraw address
        const withdrawAddr = await publicClient.readContract({
          address: walletAddress as `0x${string}`,
          abi: SMART_WALLET_ABI,
          functionName: "withdrawAddress",
        });
        if (withdrawAddr && withdrawAddr !== "0x0000000000000000000000000000000000000000") {
          setWithdrawAddressState(withdrawAddr as string);
        }

        // Check if recovery password is set
        const recoveryHash = await publicClient.readContract({
          address: walletAddress as `0x${string}`,
          abi: SMART_WALLET_ABI,
          functionName: "recoveryPasswordHash",
        });
        setHasRecoveryPassword(recoveryHash !== "0x0000000000000000000000000000000000000000000000000000000000000000");
      } catch (err) {
        console.error("Error fetching wallet data:", err);
        setError("Failed to load wallet data");
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
    // Refresh every 10 seconds
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [walletAddress, isValidAddress, publicClient, currentPasskey, usdcAddress]);

  // Login with passkey
  const handleLoginWithPasskey = async () => {
    if (!isWebAuthnSupported()) {
      setError("WebAuthn is not supported in this browser");
      return;
    }

    setIsLoggingIn(true);
    setError(null);

    try {
      const result = await loginWithPasskey();
      const stored: StoredPasskey = {
        credentialId: result.credentialId,
        qx: result.qx,
        qy: result.qy,
        passkeyAddress: result.passkeyAddress,
      };
      savePasskeyToStorage(walletAddress, stored);
      setCurrentPasskey(stored);
    } catch (err) {
      console.error("Login error:", err);
      setError(err instanceof Error ? err.message : "Failed to login");
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Sign and submit transaction
  const signAndSubmit = async (action: string, params: Record<string, string>) => {
    if (!currentPasskey) {
      setError("Please login with your passkey first");
      return;
    }

    setIsProcessing(true);
    setTxStatus("Preparing transaction...");
    setTxHash(null);
    setError(null);

    try {
      // Get prepared transaction from API
      const prepareRes = await fetch("/api/prepare-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId,
          wallet: walletAddress,
          qx: currentPasskey.qx,
          qy: currentPasskey.qy,
          action,
          params,
        }),
      });

      const prepareData = await prepareRes.json();
      if (!prepareData.success) {
        throw new Error(prepareData.error || "Failed to prepare transaction");
      }

      setTxStatus("Please sign with your passkey...");

      // Build challenge bytes
      const challengeBytes = new Uint8Array(
        (prepareData.challengeHash.slice(2).match(/.{2}/g) || []).map((byte: string) => parseInt(byte, 16)),
      );

      // Sign with passkey
      const { auth } = await signWithPasskey(currentPasskey.credentialId, challengeBytes);

      setTxStatus("Submitting transaction...");

      // Submit to facilitator
      const facilitateRes = await fetch("/api/facilitate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smartWalletAddress: walletAddress,
          chainId,
          isBatch: prepareData.isBatch,
          calls: prepareData.calls,
          qx: currentPasskey.qx,
          qy: currentPasskey.qy,
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
        setTxHash(facilitateData.txHash);
        setTxStatus("Transaction confirmed!");
        return facilitateData.txHash;
      } else {
        throw new Error(facilitateData.error || "Transaction failed");
      }
    } catch (err) {
      console.error("Transaction error:", err);
      setError(err instanceof Error ? err.message : "Transaction failed");
      setTxStatus(null);
      throw err;
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle withdraw
  const handleWithdraw = async () => {
    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    if (!withdrawAddress) {
      setError("Please set a withdraw address first");
      return;
    }

    try {
      const amountInUnits = BigInt(Math.floor(parseFloat(withdrawAmount) * 10 ** USDC_DECIMALS));
      await signAndSubmit("withdraw", {
        amount: amountInUnits.toString(),
        asset: "USDC",
      });
      setWithdrawAmount("");
    } catch {
      // Error already handled in signAndSubmit
    }
  };

  // Handle pay (to Example contract)
  const handlePay = async () => {
    if (!payAmount || parseFloat(payAmount) <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    try {
      const amountInUnits = BigInt(Math.floor(parseFloat(payAmount) * 10 ** USDC_DECIMALS));
      // Note: Example contract address should be configured
      const exampleContract = process.env.NEXT_PUBLIC_EXAMPLE_ADDRESS || "0x0000000000000000000000000000000000000000";
      await signAndSubmit("payUSDC", {
        amount: amountInUnits.toString(),
        exampleContract,
      });
      setPayAmount("");
    } catch {
      // Error already handled
    }
  };

  // Handle set withdraw address
  const handleSetWithdrawAddress = async () => {
    if (!newWithdrawAddress || !isAddress(newWithdrawAddress)) {
      setError("Please enter a valid address");
      return;
    }

    try {
      await signAndSubmit("setWithdrawAddress", {
        address: newWithdrawAddress,
      });
      setWithdrawAddressState(newWithdrawAddress);
      setNewWithdrawAddress("");
    } catch {
      // Error already handled
    }
  };

  // Handle set recovery password
  const handleSetRecoveryPassword = async () => {
    if (!recoveryPassword || recoveryPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    try {
      // Compute password hash: keccak256(walletAddress + password)
      const passwordHash = keccak256(concat([walletAddress as `0x${string}`, toHex(recoveryPassword)]));
      await signAndSubmit("setRecoveryPassword", {
        passwordHash,
      });
      setHasRecoveryPassword(true);
      setRecoveryPassword("");
    } catch {
      // Error already handled
    }
  };

  if (!isValidAddress) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Invalid Wallet Address</h1>
          <button className="btn btn-primary" onClick={() => router.push("/")}>
            Go Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-100">
      {/* Header */}
      <div className="border-b border-base-300 px-4 py-4">
        <div className="max-w-2xl mx-auto flex justify-between items-center">
          <button className="btn btn-ghost btn-sm" onClick={() => router.push("/")}>
            ← Back
          </button>
          <div className="font-mono text-sm opacity-60">
            {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Passkey Login Prompt */}
        {!currentPasskey && (
          <div className="bg-warning/10 border border-warning rounded-2xl p-6 mb-6">
            <h3 className="font-bold mb-2">Login Required</h3>
            <p className="text-sm opacity-80 mb-4">Sign in with your passkey to access your wallet.</p>
            <button
              className={`btn btn-warning ${isLoggingIn ? "loading" : ""}`}
              onClick={handleLoginWithPasskey}
              disabled={isLoggingIn}
            >
              {isLoggingIn ? "Signing in..." : "Sign in with Passkey"}
            </button>
          </div>
        )}

        {/* Balance Card */}
        <div className="bg-gradient-to-br from-primary/20 to-secondary/20 rounded-3xl p-8 mb-6">
          <div className="text-sm opacity-60 mb-2">USDC Balance</div>
          <div className="text-4xl font-bold mb-2">
            {isLoading ? "..." : `$${formatUnits(usdcBalance, USDC_DECIMALS)}`}
          </div>
          <div className="text-sm opacity-60">{formatUnits(ethBalance, 18)} ETH</div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="alert alert-error mb-6">
            <span>{error}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>
              ✕
            </button>
          </div>
        )}

        {/* Transaction Status */}
        {txStatus && (
          <div className="alert alert-info mb-6">
            <span>{txStatus}</span>
            {txHash && <span className="text-xs font-mono ml-2">{txHash.slice(0, 10)}...</span>}
          </div>
        )}

        {/* Tab Navigation */}
        <div className="tabs tabs-boxed mb-6 p-1">
          <button
            className={`tab flex-1 ${activeTab === "balance" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("balance")}
          >
            <CreditCardIcon className="w-4 h-4 mr-2" />
            Balance
          </button>
          <button
            className={`tab flex-1 ${activeTab === "deposit" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("deposit")}
          >
            <ArrowDownTrayIcon className="w-4 h-4 mr-2" />
            Deposit
          </button>
          <button
            className={`tab flex-1 ${activeTab === "withdraw" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("withdraw")}
          >
            <ArrowUpTrayIcon className="w-4 h-4 mr-2" />
            Withdraw
          </button>
          <button
            className={`tab flex-1 ${activeTab === "pay" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("pay")}
          >
            Pay
          </button>
          <button
            className={`tab flex-1 ${activeTab === "settings" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            <Cog6ToothIcon className="w-4 h-4 mr-2" />
          </button>
        </div>

        {/* Tab Content */}
        <div className="bg-base-200 rounded-2xl p-6">
          {activeTab === "balance" && (
            <div>
              <h3 className="font-bold mb-4">Account Overview</h3>
              <div className="space-y-3">
                <div className="flex justify-between py-2 border-b border-base-300">
                  <span className="opacity-60">USDC</span>
                  <span className="font-mono">${formatUnits(usdcBalance, USDC_DECIMALS)}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-base-300">
                  <span className="opacity-60">ETH</span>
                  <span className="font-mono">{formatUnits(ethBalance, 18)}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-base-300">
                  <span className="opacity-60">Passkey</span>
                  <span className={currentPasskey ? "text-success" : "text-warning"}>
                    {currentPasskey ? "Connected" : "Not Connected"}
                  </span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="opacity-60">Withdraw Address</span>
                  <span className="font-mono text-sm">
                    {withdrawAddress ? `${withdrawAddress.slice(0, 6)}...${withdrawAddress.slice(-4)}` : "Not Set"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {activeTab === "deposit" && (
            <div className="text-center">
              <h3 className="font-bold mb-4">Deposit USDC</h3>
              <p className="text-sm opacity-60 mb-4">Send USDC to your wallet address:</p>
              <div className="flex justify-center mb-4">
                <div className="bg-white p-4 rounded-xl">
                  <QRCodeSVG value={walletAddress} size={160} />
                </div>
              </div>
              <div className="bg-base-300 rounded-lg p-3 font-mono text-sm break-all mb-4">{walletAddress}</div>
              <button className="btn btn-outline btn-sm" onClick={() => navigator.clipboard.writeText(walletAddress)}>
                Copy Address
              </button>
            </div>
          )}

          {activeTab === "withdraw" && (
            <div>
              <h3 className="font-bold mb-4">Withdraw USDC</h3>
              {!withdrawAddress ? (
                <div className="text-center py-4">
                  <p className="opacity-60 mb-4">Set a withdraw address first in Settings.</p>
                  <button className="btn btn-outline" onClick={() => setActiveTab("settings")}>
                    Go to Settings
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-sm opacity-60 mb-4">
                    Funds will be sent to: {withdrawAddress.slice(0, 6)}...{withdrawAddress.slice(-4)}
                  </p>
                  <div className="form-control mb-4">
                    <label className="label">
                      <span className="label-text">Amount (USDC)</span>
                      <span className="label-text-alt">Max: ${formatUnits(usdcBalance, USDC_DECIMALS)}</span>
                    </label>
                    <input
                      type="number"
                      placeholder="0.00"
                      className="input input-bordered"
                      value={withdrawAmount}
                      onChange={e => setWithdrawAmount(e.target.value)}
                    />
                  </div>
                  <button
                    className={`btn btn-primary w-full ${isProcessing ? "loading" : ""}`}
                    onClick={handleWithdraw}
                    disabled={isProcessing || !currentPasskey}
                  >
                    {isProcessing ? "Processing..." : "Withdraw"}
                  </button>
                </>
              )}
            </div>
          )}

          {activeTab === "pay" && (
            <div>
              <h3 className="font-bold mb-4">Pay USDC</h3>
              <p className="text-sm opacity-60 mb-4">Pay USDC to the example application contract.</p>
              <div className="form-control mb-4">
                <label className="label">
                  <span className="label-text">Amount (USDC)</span>
                </label>
                <input
                  type="number"
                  placeholder="0.00"
                  className="input input-bordered"
                  value={payAmount}
                  onChange={e => setPayAmount(e.target.value)}
                />
              </div>
              <button
                className={`btn btn-primary w-full ${isProcessing ? "loading" : ""}`}
                onClick={handlePay}
                disabled={isProcessing || !currentPasskey}
              >
                {isProcessing ? "Processing..." : "Pay USDC"}
              </button>
            </div>
          )}

          {activeTab === "settings" && (
            <div className="space-y-6">
              <div>
                <h3 className="font-bold mb-4">Withdraw Address</h3>
                <p className="text-sm opacity-60 mb-4">
                  Set the address where funds will be sent when you withdraw or during recovery.
                </p>
                {withdrawAddress && (
                  <div className="bg-base-300 rounded-lg p-3 font-mono text-sm mb-4">Current: {withdrawAddress}</div>
                )}
                <div className="form-control mb-4">
                  <input
                    type="text"
                    placeholder="0x..."
                    className="input input-bordered"
                    value={newWithdrawAddress}
                    onChange={e => setNewWithdrawAddress(e.target.value)}
                  />
                </div>
                <button
                  className={`btn btn-outline w-full ${isProcessing ? "loading" : ""}`}
                  onClick={handleSetWithdrawAddress}
                  disabled={isProcessing || !currentPasskey}
                >
                  {withdrawAddress ? "Update" : "Set"} Withdraw Address
                </button>
              </div>

              <div className="divider" />

              <div>
                <h3 className="font-bold mb-4">Recovery Password</h3>
                <p className="text-sm opacity-60 mb-4">
                  Set a recovery password to recover your funds if you lose your passkey.
                  {hasRecoveryPassword && <span className="text-success ml-2">✓ Set</span>}
                </p>
                <div className="form-control mb-4">
                  <input
                    type="password"
                    placeholder="Enter recovery password"
                    className="input input-bordered"
                    value={recoveryPassword}
                    onChange={e => setRecoveryPassword(e.target.value)}
                  />
                </div>
                <button
                  className={`btn btn-outline w-full ${isProcessing ? "loading" : ""}`}
                  onClick={handleSetRecoveryPassword}
                  disabled={isProcessing || !currentPasskey}
                >
                  {hasRecoveryPassword ? "Update" : "Set"} Recovery Password
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
