"use client";

import { useCallback, useEffect, useState } from "react";
import { Address, AddressInput } from "@scaffold-ui/components";
import { isAddress } from "viem";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { usePasskeyWallet } from "~~/contexts/PasskeyWalletContext";
import { formatUsdc } from "~~/utils/scaffold-eth";

const USDC_DECIMALS = 6;

type WithdrawModalProps = {
  isOpen: boolean;
  onClose: () => void;
  autoStartPolling?: boolean;
};

type OfframpStep =
  | "initial" // Show options
  | "coinbase_open" // Coinbase tab opened, waiting for user to select amount
  | "polling" // Polling for transaction details
  | "set_withdraw_address" // Prompting for passkey to set withdraw address
  | "transfer" // Prompting for passkey to transfer funds
  | "success"; // All done!

type TransactionDetails = {
  toAddress: string;
  sellAmount: string;
  sellCurrency: string;
  status: string;
  transactionId?: string;
};

export const WithdrawModal = ({ isOpen, onClose, autoStartPolling = false }: WithdrawModalProps) => {
  const { walletAddress, usdcBalance, withdrawAddress, passkey, signAndSubmit } = usePasskeyWallet();

  // Manual withdraw state
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [newWithdrawAddress, setNewWithdrawAddress] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Coinbase offramp state
  const [offrampStep, setOfframpStep] = useState<OfframpStep>("initial");
  const [transactionDetails, setTransactionDetails] = useState<TransactionDetails | null>(null);
  const [pollInterval, setPollInterval] = useState<NodeJS.Timeout | null>(null);
  const [hasAutoStarted, setHasAutoStarted] = useState(false);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [pollInterval]);

  const handleClose = () => {
    setWithdrawAmount("");
    setNewWithdrawAddress("");
    setError(null);
    setSuccess(null);
    setOfframpStep("initial");
    setTransactionDetails(null);
    if (pollInterval) {
      clearInterval(pollInterval);
      setPollInterval(null);
    }
    onClose();
  };

  // ============ Manual Withdraw Functions ============

  const handleSetWithdrawAddress = async () => {
    if (!newWithdrawAddress || !isAddress(newWithdrawAddress)) {
      setError("Please enter a valid address");
      return;
    }

    setIsProcessing(true);
    setError(null);
    setSuccess(null);

    try {
      await signAndSubmit("setWithdrawAddress", {
        address: newWithdrawAddress,
      });
      setSuccess("Withdraw address set!");
      setNewWithdrawAddress("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set withdraw address");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    if (!withdrawAddress) {
      setError("Please set a withdraw address first");
      return;
    }

    setIsProcessing(true);
    setError(null);
    setSuccess(null);

    try {
      const amountInUnits = BigInt(Math.floor(parseFloat(withdrawAmount) * 10 ** USDC_DECIMALS));
      await signAndSubmit("withdraw", {
        amount: amountInUnits.toString(),
        asset: "USDC",
      });
      setSuccess(`Successfully withdrew $${withdrawAmount} USDC!`);
      setWithdrawAmount("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to withdraw");
    } finally {
      setIsProcessing(false);
    }
  };

  // ============ Coinbase Offramp Functions ============

  const openCoinbaseOfframp = async () => {
    if (!walletAddress || isProcessing) return;

    setIsProcessing(true);
    setError(null);

    try {
      // Add cache-busting timestamp to ensure fresh token every time
      const response = await fetch("/api/coinbase-offramp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
        body: JSON.stringify({ walletAddress, timestamp: Date.now() }),
        cache: "no-store",
      });

      const data = await response.json();

      if (data.success && data.offrampUrl) {
        // Open Coinbase immediately - token can only be used once!
        const opened = window.open(data.offrampUrl, "_blank");
        if (opened) {
          setOfframpStep("coinbase_open");
        } else {
          setError("Popup blocked. Please allow popups and try again.");
        }
      } else {
        console.error("Failed to get offramp URL:", data.error, data.details);
        setError(`Coinbase error: ${data.details || data.error}`);
      }
    } catch (err) {
      console.error("Error opening Coinbase offramp:", err);
      setError("Failed to open Coinbase. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const pollTransactionStatus = useCallback(async () => {
    if (!walletAddress) return null;

    try {
      const response = await fetch(`/api/coinbase-offramp?walletAddress=${walletAddress}`);
      const data = await response.json();

      if (data.success && data.hasPendingTransaction && data.transaction?.toAddress) {
        return data.transaction as TransactionDetails;
      }
      return null;
    } catch (err) {
      console.error("Error polling transaction status:", err);
      return null;
    }
  }, [walletAddress]);

  const startPolling = useCallback(() => {
    setOfframpStep("polling");
    setError(null);

    // Poll immediately
    pollTransactionStatus().then(tx => {
      if (tx) {
        setTransactionDetails(tx);
        setOfframpStep("set_withdraw_address");
      }
    });

    // Then poll every 3 seconds
    const interval = setInterval(async () => {
      const tx = await pollTransactionStatus();
      if (tx) {
        setTransactionDetails(tx);
        setOfframpStep("set_withdraw_address");
        clearInterval(interval);
        setPollInterval(null);
      }
    }, 3000);

    setPollInterval(interval);

    // Stop polling after 5 minutes
    setTimeout(
      () => {
        clearInterval(interval);
        setPollInterval(null);
      },
      5 * 60 * 1000,
    );
  }, [pollTransactionStatus]);

  // Auto-start polling when redirected back from Coinbase
  useEffect(() => {
    if (isOpen && autoStartPolling && !hasAutoStarted && walletAddress) {
      setHasAutoStarted(true);
      startPolling();
    }
  }, [isOpen, autoStartPolling, hasAutoStarted, walletAddress, startPolling]);

  // Reset hasAutoStarted when modal closes
  useEffect(() => {
    if (!isOpen) {
      setHasAutoStarted(false);
    }
  }, [isOpen]);

  const handleSetCoinbaseWithdrawAddress = async () => {
    if (!transactionDetails?.toAddress) return;

    setIsProcessing(true);
    setError(null);

    try {
      await signAndSubmit("setWithdrawAddress", {
        address: transactionDetails.toAddress,
      });
      setOfframpStep("transfer");
    } catch (err) {
      console.error("Error setting withdraw address:", err);
      setError(err instanceof Error ? err.message : "Failed to set withdraw address");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCoinbaseTransfer = async () => {
    if (!transactionDetails?.toAddress || !transactionDetails?.sellAmount) return;

    setIsProcessing(true);
    setError(null);

    try {
      const amountInUnits = Math.floor(parseFloat(transactionDetails.sellAmount) * 1e6).toString();

      await signAndSubmit("transfer", {
        to: transactionDetails.toAddress,
        amount: amountInUnits,
        asset: "USDC",
      });

      setOfframpStep("success");
    } catch (err) {
      console.error("Error transferring USDC:", err);
      setError(err instanceof Error ? err.message : "Failed to transfer USDC");
    } finally {
      setIsProcessing(false);
    }
  };

  // Check if we can skip setting withdraw address (already set to Coinbase address)
  useEffect(() => {
    if (
      offrampStep === "set_withdraw_address" &&
      transactionDetails?.toAddress &&
      withdrawAddress?.toLowerCase() === transactionDetails.toAddress.toLowerCase()
    ) {
      setOfframpStep("transfer");
    }
  }, [offrampStep, transactionDetails, withdrawAddress]);

  if (!isOpen || !walletAddress) return null;

  // ============ Render Coinbase Offramp Steps ============

  if (offrampStep === "coinbase_open") {
    return (
      <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
        <div className="bg-base-100 rounded-2xl p-6 max-w-lg w-full">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-bold text-xl">Cash Out with Coinbase</h3>
            <button className="btn btn-ghost btn-sm btn-circle" onClick={handleClose}>
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-4">
            <div className="text-center">
              <div className="text-4xl mb-4">🪟</div>
              <p className="text-sm opacity-70 mb-4">
                Select how much USDC you want to sell in the Coinbase window, then come back here.
              </p>
            </div>

            <div className="bg-info/10 border border-info rounded-xl p-4">
              <p className="text-sm font-medium mb-2">Steps in Coinbase:</p>
              <ol className="list-decimal list-inside text-sm space-y-1 opacity-80">
                <li>Enter the amount you want to sell</li>
                <li>Connect or sign in to your Coinbase account</li>
                <li>Review the transaction details</li>
                <li>Confirm the sell order</li>
              </ol>
            </div>

            <button onClick={startPolling} className="btn btn-primary w-full">
              I&apos;ve Selected My Amount
            </button>

            <button onClick={() => setOfframpStep("initial")} className="btn btn-ghost btn-sm w-full">
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (offrampStep === "polling") {
    return (
      <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
        <div className="bg-base-100 rounded-2xl p-6 max-w-lg w-full">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-bold text-xl">Waiting for Coinbase</h3>
            <button className="btn btn-ghost btn-sm btn-circle" onClick={handleClose}>
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-4 text-center">
            <span className="loading loading-spinner loading-md text-primary"></span>
            <p className="text-sm opacity-70">
              Complete your sell order in Coinbase. We&apos;ll detect it automatically.
            </p>
            <p className="text-xs opacity-50">Checking every 3 seconds...</p>

            <button
              onClick={() => {
                if (pollInterval) clearInterval(pollInterval);
                setPollInterval(null);
                setOfframpStep("coinbase_open");
              }}
              className="btn btn-ghost btn-sm"
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (offrampStep === "set_withdraw_address") {
    return (
      <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
        <div className="bg-base-100 rounded-2xl p-6 max-w-lg w-full">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-bold text-xl">Step 1: Set Withdraw Address</h3>
            <button className="btn btn-ghost btn-sm btn-circle" onClick={handleClose}>
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-4">
            <p className="text-sm opacity-70">
              Sign with your passkey to set the Coinbase address as your withdraw address.
            </p>

            {transactionDetails && (
              <div className="bg-base-200 rounded-xl p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="opacity-60">Amount:</span>
                  <span className="font-mono font-bold">
                    ${transactionDetails.sellAmount} {transactionDetails.sellCurrency}
                  </span>
                </div>
                <div className="flex justify-between text-sm items-center">
                  <span className="opacity-60">To:</span>
                  <Address address={transactionDetails.toAddress as `0x${string}`} size="sm" />
                </div>
              </div>
            )}

            <div className="bg-success/10 border border-success rounded-xl p-3">
              <p className="text-xs">
                <strong>Why set withdraw address?</strong> This address will also be used for guardian recovery if you
                ever lose your passkey.
              </p>
            </div>

            {error && (
              <div className="alert alert-error py-2">
                <span className="text-sm">{error}</span>
                <button className="btn btn-ghost btn-xs" onClick={() => setError(null)}>
                  ✕
                </button>
              </div>
            )}

            <button
              onClick={handleSetCoinbaseWithdrawAddress}
              disabled={isProcessing}
              className="btn btn-primary w-full"
            >
              {isProcessing ? "Signing..." : "Sign to Set Address"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (offrampStep === "transfer") {
    return (
      <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
        <div className="bg-base-100 rounded-2xl p-6 max-w-lg w-full">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-bold text-xl">Step 2: Send USDC</h3>
            <button className="btn btn-ghost btn-sm btn-circle" onClick={handleClose}>
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-4">
            <p className="text-sm opacity-70">Sign with your passkey to send your USDC to Coinbase.</p>

            {transactionDetails && (
              <div className="bg-base-200 rounded-xl p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="opacity-60">Sending:</span>
                  <span className="font-mono font-bold">
                    ${transactionDetails.sellAmount} {transactionDetails.sellCurrency}
                  </span>
                </div>
                <div className="flex justify-between text-sm items-center">
                  <span className="opacity-60">To Coinbase:</span>
                  <Address address={transactionDetails.toAddress as `0x${string}`} size="sm" />
                </div>
              </div>
            )}

            {error && (
              <div className="alert alert-error py-2">
                <span className="text-sm">{error}</span>
                <button className="btn btn-ghost btn-xs" onClick={() => setError(null)}>
                  ✕
                </button>
              </div>
            )}

            <button onClick={handleCoinbaseTransfer} disabled={isProcessing} className="btn btn-primary w-full">
              {isProcessing ? "Sending..." : "Sign to Send USDC"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (offrampStep === "success") {
    return (
      <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
        <div className="bg-base-100 rounded-2xl p-6 max-w-lg w-full">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-bold text-xl">USDC Sent!</h3>
            <button className="btn btn-ghost btn-sm btn-circle" onClick={handleClose}>
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-4 text-center">
            <div className="text-5xl">🎉</div>
            <p className="text-sm opacity-70">
              Your USDC has been sent to Coinbase. They&apos;ll process it and deposit cash to your bank.
            </p>

            {transactionDetails && (
              <div className="bg-success/10 border border-success rounded-xl p-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className="opacity-60">Amount:</span>
                  <span className="font-mono font-bold">
                    ${transactionDetails.sellAmount} {transactionDetails.sellCurrency}
                  </span>
                </div>
                <p className="text-xs opacity-70">
                  Coinbase will send you an email with tracking updates. Funds typically arrive in 1-3 business days.
                </p>
              </div>
            )}

            <button onClick={handleClose} className="btn btn-primary w-full">
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============ Initial View - Show Both Options ============

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-base-100 rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-bold text-xl">Withdraw USDC</h3>
          <button className="btn btn-ghost btn-sm btn-circle" onClick={handleClose}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Error/Success Messages */}
          {error && (
            <div className="alert alert-error py-2">
              <span className="text-sm">{error}</span>
              <button className="btn btn-ghost btn-xs" onClick={() => setError(null)}>
                ✕
              </button>
            </div>
          )}
          {success && (
            <div className="alert alert-success py-2">
              <span className="text-sm">{success}</span>
              <button className="btn btn-ghost btn-xs" onClick={() => setSuccess(null)}>
                ✕
              </button>
            </div>
          )}

          {/* Balance Display */}
          <div className="bg-base-200 rounded-xl p-3">
            <div className="flex justify-between items-center">
              <span className="text-sm opacity-60">Available Balance</span>
              <span className="font-bold">${formatUsdc(usdcBalance)}</span>
            </div>
          </div>

          {/* Coinbase Cash Out Option */}
          <div className="bg-primary/10 border border-primary rounded-xl p-4">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-2xl">💳</span>
              <div>
                <h4 className="font-bold">Cash Out to Bank</h4>
                <p className="text-xs opacity-70">Convert USDC to cash via Coinbase</p>
              </div>
            </div>
            <button
              onClick={openCoinbaseOfframp}
              disabled={isProcessing || usdcBalance === 0n || !passkey}
              className="btn btn-primary w-full"
            >
              {isProcessing ? "Opening Coinbase..." : "Cash Out with Coinbase"}
            </button>
          </div>

          <div className="divider text-xs opacity-60">Or withdraw to address</div>

          {withdrawAddress ? (
            <>
              {/* Withdraw Form */}
              <div className="space-y-3">
                <div className="text-sm opacity-60 flex items-center gap-1">
                  <span>Funds will be sent to:</span>
                </div>
                <div className="bg-base-200 rounded-lg p-2">
                  <Address address={withdrawAddress as `0x${string}`} size="sm" />
                </div>

                <div className="form-control">
                  <label className="label py-1">
                    <span className="label-text">Amount (USDC)</span>
                    <span className="label-text-alt">Max: ${formatUsdc(usdcBalance)}</span>
                  </label>
                  <input
                    type="number"
                    placeholder="0.00"
                    className="input input-bordered"
                    value={withdrawAmount}
                    onChange={e => setWithdrawAmount(e.target.value)}
                  />
                </div>

                <button className="btn btn-outline w-full" onClick={handleWithdraw} disabled={isProcessing || !passkey}>
                  {isProcessing ? "Processing..." : "Withdraw to Address"}
                </button>
              </div>

              {/* Change Address - Collapsed */}
              <details className="collapse collapse-arrow bg-base-200 rounded-xl">
                <summary className="collapse-title text-sm font-medium py-3 min-h-0">Change Withdraw Address</summary>
                <div className="collapse-content">
                  <div className="space-y-3 pt-2">
                    <AddressInput
                      placeholder="0x..."
                      value={newWithdrawAddress}
                      onChange={value => setNewWithdrawAddress(value)}
                    />
                    <button
                      className="btn btn-outline btn-sm w-full"
                      onClick={handleSetWithdrawAddress}
                      disabled={isProcessing || !passkey}
                    >
                      {isProcessing ? "Updating..." : "Update Address"}
                    </button>
                  </div>
                </div>
              </details>
            </>
          ) : (
            /* Initial Setup */
            <div className="space-y-3">
              <p className="text-sm opacity-60">
                Set an address where you can receive <strong>USDC on Base</strong>.
              </p>
              <AddressInput
                placeholder="0x..."
                value={newWithdrawAddress}
                onChange={value => setNewWithdrawAddress(value)}
              />
              <button
                className="btn btn-outline w-full"
                onClick={handleSetWithdrawAddress}
                disabled={isProcessing || !passkey}
              >
                {isProcessing ? "Setting..." : "Set Withdraw Address"}
              </button>
            </div>
          )}

          {/* Warning */}
          <div className="bg-warning/10 border border-warning rounded-xl p-3">
            <p className="text-xs font-semibold text-warning mb-1">⚠️ Base Network Only</p>
            <p className="text-xs opacity-80">Withdrawals send USDC on Base. Ensure your address supports it.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
