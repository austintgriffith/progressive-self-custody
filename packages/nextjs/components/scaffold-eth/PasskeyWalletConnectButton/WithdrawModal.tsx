"use client";

import { useState } from "react";
import { Address, AddressInput } from "@scaffold-ui/components";
import { isAddress } from "viem";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { usePasskeyWallet } from "~~/contexts/PasskeyWalletContext";
import { formatUsdc } from "~~/utils/scaffold-eth";

const USDC_DECIMALS = 6;

type WithdrawModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export const WithdrawModal = ({ isOpen, onClose }: WithdrawModalProps) => {
  const { walletAddress, usdcBalance, withdrawAddress, passkey, signAndSubmit } = usePasskeyWallet();

  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [newWithdrawAddress, setNewWithdrawAddress] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleClose = () => {
    setWithdrawAmount("");
    setNewWithdrawAddress("");
    setError(null);
    setSuccess(null);
    onClose();
  };

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
      // Force a refresh by closing and reopening would update context
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

  if (!isOpen || !walletAddress) return null;

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

                <button
                  className={`btn btn-primary w-full ${isProcessing ? "loading" : ""}`}
                  onClick={handleWithdraw}
                  disabled={isProcessing || !passkey}
                >
                  {isProcessing ? "Processing..." : "Withdraw"}
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
                      className={`btn btn-outline btn-sm w-full ${isProcessing ? "loading" : ""}`}
                      onClick={handleSetWithdrawAddress}
                      disabled={isProcessing || !passkey}
                    >
                      Update Address
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
                className={`btn btn-primary w-full ${isProcessing ? "loading" : ""}`}
                onClick={handleSetWithdrawAddress}
                disabled={isProcessing || !passkey}
              >
                Set Withdraw Address
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
