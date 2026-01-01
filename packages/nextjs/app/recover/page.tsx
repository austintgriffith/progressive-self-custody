"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isAddress } from "viem";
import { CheckCircleIcon, ClockIcon, ShieldExclamationIcon } from "@heroicons/react/24/outline";

export default function RecoverPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Form state
  const [walletAddress, setWalletAddress] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recovery status state
  const [recoveryStatus, setRecoveryStatus] = useState<{
    triggered: boolean;
    triggeredAt: number | null;
    executionTime: number | null;
    canExecute: boolean;
    timeRemaining: number | null;
    withdrawAddress: string | null;
  } | null>(null);

  // Success state
  const [recoveryComplete, setRecoveryComplete] = useState(false);
  const [recoveryTxHash, setRecoveryTxHash] = useState<string | null>(null);

  // Chain ID (default to local)
  const chainId = 31337;

  // Pre-fill wallet address from URL params
  useEffect(() => {
    const wallet = searchParams.get("wallet");
    if (wallet && isAddress(wallet)) {
      setWalletAddress(wallet);
      fetchRecoveryStatus(wallet);
    }
  }, [searchParams]);

  // Fetch recovery status
  const fetchRecoveryStatus = async (wallet: string) => {
    try {
      const response = await fetch(`/api/guardian/recovery-status?chainId=${chainId}&wallet=${wallet}`);
      const data = await response.json();
      if (data.success) {
        setRecoveryStatus({
          triggered: data.triggered,
          triggeredAt: data.triggeredAt,
          executionTime: data.executionTime,
          canExecute: data.canExecute,
          timeRemaining: data.timeRemaining,
          withdrawAddress: data.withdrawAddress,
        });
      }
    } catch (err) {
      console.error("Error fetching status:", err);
    }
  };

  // Update countdown timer
  useEffect(() => {
    if (!recoveryStatus?.triggered || recoveryStatus.timeRemaining === null || recoveryStatus.timeRemaining <= 0)
      return;

    const interval = setInterval(() => {
      setRecoveryStatus(prev => {
        if (!prev || !prev.timeRemaining) return prev;
        const newRemaining = Math.max(0, prev.timeRemaining - 1);
        return {
          ...prev,
          timeRemaining: newRemaining,
          canExecute: newRemaining === 0,
        };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [recoveryStatus?.triggered, recoveryStatus?.timeRemaining]);

  // Format time remaining
  const formatTimeRemaining = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Handle trigger recovery
  const handleTriggerRecovery = async () => {
    if (!walletAddress || !isAddress(walletAddress)) {
      setError("Please enter a valid wallet address");
      return;
    }
    if (!password) {
      setError("Please enter your recovery password");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/guardian/trigger-recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId,
          smartWalletAddress: walletAddress,
          password,
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Refresh status
        await fetchRecoveryStatus(walletAddress);
        setPassword(""); // Clear password for security
      } else {
        setError(data.error || "Failed to trigger recovery");
      }
    } catch (err) {
      console.error("Trigger error:", err);
      setError(err instanceof Error ? err.message : "Failed to trigger recovery");
    } finally {
      setIsLoading(false);
    }
  };

  // Handle execute recovery
  const handleExecuteRecovery = async () => {
    if (!walletAddress) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/guardian/execute-recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId,
          smartWalletAddress: walletAddress,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setRecoveryComplete(true);
        setRecoveryTxHash(data.txHash);
      } else {
        setError(data.error || "Failed to execute recovery");
      }
    } catch (err) {
      console.error("Execute error:", err);
      setError(err instanceof Error ? err.message : "Failed to execute recovery");
    } finally {
      setIsLoading(false);
    }
  };

  // Handle check status
  const handleCheckStatus = async () => {
    if (!walletAddress || !isAddress(walletAddress)) {
      setError("Please enter a valid wallet address");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await fetchRecoveryStatus(walletAddress);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch status");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-base-100">
      {/* Header */}
      <div className="border-b border-base-300 px-4 py-4">
        <div className="max-w-lg mx-auto flex justify-between items-center">
          <button className="btn btn-ghost btn-sm" onClick={() => router.push("/")}>
            ← Back
          </button>
          <span className="font-semibold">Account Recovery</span>
          <div className="w-16" />
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-8">
        {/* Recovery Complete */}
        {recoveryComplete ? (
          <div className="text-center">
            <div className="w-20 h-20 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-6">
              <CheckCircleIcon className="w-12 h-12 text-success" />
            </div>
            <h1 className="text-2xl font-bold mb-4">Recovery Complete!</h1>
            <p className="opacity-80 mb-6">Your funds have been sent to your withdraw address.</p>
            {recoveryTxHash && (
              <div className="bg-base-200 rounded-lg p-4 mb-6">
                <div className="text-sm opacity-60 mb-1">Transaction Hash</div>
                <div className="font-mono text-sm break-all">{recoveryTxHash}</div>
              </div>
            )}
            <button className="btn btn-primary" onClick={() => router.push("/")}>
              Go Home
            </button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="text-center mb-8">
              <div className="w-16 h-16 rounded-full bg-warning/20 flex items-center justify-center mx-auto mb-4">
                <ShieldExclamationIcon className="w-10 h-10 text-warning" />
              </div>
              <h1 className="text-2xl font-bold mb-2">Recover Your Wallet</h1>
              <p className="opacity-80">Lost your passkey? Use your recovery password to get your funds back.</p>
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

            {/* Recovery Status - Triggered */}
            {recoveryStatus?.triggered && !recoveryStatus.canExecute && (
              <div className="bg-info/10 border border-info rounded-2xl p-6 mb-6">
                <div className="flex items-center gap-3 mb-4">
                  <ClockIcon className="w-6 h-6 text-info" />
                  <h3 className="font-bold">Recovery In Progress</h3>
                </div>
                <p className="text-sm opacity-80 mb-4">
                  Recovery has been triggered. Funds can be recovered after the waiting period.
                </p>
                <div className="text-center py-4">
                  <div className="text-3xl font-mono font-bold text-info">
                    {formatTimeRemaining(recoveryStatus.timeRemaining || 0)}
                  </div>
                  <div className="text-sm opacity-60 mt-2">Time Remaining</div>
                </div>
                {recoveryStatus.withdrawAddress && (
                  <div className="text-sm opacity-60 mt-4">Funds will be sent to: {recoveryStatus.withdrawAddress}</div>
                )}
              </div>
            )}

            {/* Recovery Status - Ready to Execute */}
            {recoveryStatus?.triggered && recoveryStatus.canExecute && (
              <div className="bg-success/10 border border-success rounded-2xl p-6 mb-6">
                <div className="flex items-center gap-3 mb-4">
                  <CheckCircleIcon className="w-6 h-6 text-success" />
                  <h3 className="font-bold">Ready to Recover</h3>
                </div>
                <p className="text-sm opacity-80 mb-4">
                  The waiting period has passed. You can now recover your funds.
                </p>
                {recoveryStatus.withdrawAddress && (
                  <div className="text-sm opacity-60 mb-4">Funds will be sent to: {recoveryStatus.withdrawAddress}</div>
                )}
                <button
                  className={`btn btn-success w-full ${isLoading ? "loading" : ""}`}
                  onClick={handleExecuteRecovery}
                  disabled={isLoading}
                >
                  {isLoading ? "Processing..." : "Recover Funds"}
                </button>
              </div>
            )}

            {/* Main Form */}
            <div className="bg-base-200 rounded-2xl p-6">
              {/* Wallet Address */}
              <div className="form-control mb-4">
                <label className="label">
                  <span className="label-text">Wallet Address</span>
                </label>
                <input
                  type="text"
                  placeholder="0x..."
                  className="input input-bordered"
                  value={walletAddress}
                  onChange={e => setWalletAddress(e.target.value)}
                />
              </div>

              {/* Check Status Button */}
              {!recoveryStatus?.triggered && (
                <button
                  className={`btn btn-outline w-full mb-4 ${isLoading ? "loading" : ""}`}
                  onClick={handleCheckStatus}
                  disabled={isLoading || !walletAddress}
                >
                  Check Recovery Status
                </button>
              )}

              {/* Trigger Recovery Form - only show if not already triggered */}
              {!recoveryStatus?.triggered && (
                <>
                  <div className="divider">OR</div>

                  <div className="form-control mb-4">
                    <label className="label">
                      <span className="label-text">Recovery Password</span>
                    </label>
                    <input
                      type="password"
                      placeholder="Enter your recovery password"
                      className="input input-bordered"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                    />
                  </div>

                  <button
                    className={`btn btn-warning w-full ${isLoading ? "loading" : ""}`}
                    onClick={handleTriggerRecovery}
                    disabled={isLoading || !walletAddress || !password}
                  >
                    {isLoading ? "Processing..." : "Start Recovery"}
                  </button>

                  <p className="text-xs opacity-60 mt-4 text-center">
                    This will start a 24-hour waiting period. After the period ends, you can recover your funds to your
                    preset withdraw address.
                  </p>
                </>
              )}
            </div>

            {/* Help Text */}
            <div className="mt-8 text-center">
              <h3 className="font-bold mb-2">How Recovery Works</h3>
              <div className="text-sm opacity-70 space-y-2">
                <p>1. Enter your wallet address and recovery password</p>
                <p>2. A 24-hour waiting period begins</p>
                <p>3. After 24 hours, click &quot;Recover Funds&quot; to send all assets to your withdraw address</p>
                <p>4. If you find your passkey, you can cancel the recovery from your wallet</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
