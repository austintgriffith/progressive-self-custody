"use client";

import { useState } from "react";
import { Address } from "@scaffold-ui/components";
import { formatUnits } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { TrashIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { usePasskeyWallet } from "~~/contexts/PasskeyWalletContext";

const USDC_DECIMALS = 6;

type AdvancedModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export const AdvancedModal = ({ isOpen, onClose }: AdvancedModalProps) => {
  const {
    walletAddress,
    walletGuardian,
    withdrawAddress,
    usdcBalance,
    passkey,
    signAndSubmit,
    logout,
    usdcAddress,
    SMART_WALLET_ABI,
  } = usePasskeyWallet();
  const { address: connectedAddress, isConnected } = useAccount();
  const { writeContractAsync: guardianRecoverWrite, isPending: isGuardianRecovering } = useWriteContract();

  const [isSettingGuardian, setIsSettingGuardian] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleClose = () => {
    setError(null);
    setSuccess(null);
    onClose();
  };

  const handleSetGuardian = async () => {
    if (!connectedAddress) {
      setError("Please connect a wallet first");
      return;
    }

    setIsSettingGuardian(true);
    setError(null);
    setSuccess(null);

    try {
      await signAndSubmit("setGuardian", {
        address: connectedAddress,
      });
      setSuccess("Guardian updated successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set guardian");
    } finally {
      setIsSettingGuardian(false);
    }
  };

  const handleGuardianRecover = async () => {
    if (!SMART_WALLET_ABI || !walletAddress) return;

    setError(null);
    setSuccess(null);

    try {
      await guardianRecoverWrite({
        address: walletAddress as `0x${string}`,
        abi: SMART_WALLET_ABI,
        functionName: "guardianRecover",
        args: [usdcAddress],
      });
      setSuccess("Recovery successful! Funds sent to withdraw address.");
    } catch (err) {
      console.error("Guardian recover error:", err);
      setError(err instanceof Error ? err.message : "Failed to execute recovery");
    }
  };

  const handleLogout = () => {
    logout();
    handleClose();
  };

  if (!isOpen || !walletAddress) return null;

  const isGuardian =
    isConnected &&
    connectedAddress &&
    walletGuardian &&
    connectedAddress.toLowerCase() === walletGuardian.toLowerCase();

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-base-100 rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-bold text-xl">Advanced Settings</h3>
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

          {/* Wallet Info */}
          <div className="bg-base-200 rounded-xl p-3">
            <div className="flex justify-between items-center">
              <span className="text-sm opacity-60">Guardian</span>
              <span className="text-sm">
                {walletGuardian ? <Address address={walletGuardian as `0x${string}`} size="sm" /> : "Not set"}
              </span>
            </div>
          </div>

          {/* Set Guardian Section */}
          <div className="bg-base-200 rounded-xl p-4 space-y-3">
            <h4 className="font-bold text-sm">Set Guardian</h4>
            <p className="text-xs opacity-60">Connect a wallet to set it as guardian for recovery.</p>

            <RainbowKitCustomConnectButton />

            {isConnected && connectedAddress && (
              <div className="bg-base-300 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <Address address={connectedAddress} size="sm" />
                  <button
                    className={`btn btn-primary btn-xs ${isSettingGuardian ? "loading" : ""}`}
                    onClick={handleSetGuardian}
                    disabled={isSettingGuardian || !passkey || connectedAddress === walletGuardian}
                  >
                    {isSettingGuardian ? "..." : connectedAddress === walletGuardian ? "Current" : "Set"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Guardian Recovery - Only show when connected as guardian */}
          {isGuardian && (
            <div className="bg-warning/10 border border-warning rounded-xl p-4 space-y-3">
              <h4 className="font-bold text-sm text-warning">🛡️ Guardian Recovery</h4>
              <p className="text-xs opacity-80">As guardian, you can recover all USDC to the withdraw address.</p>

              {withdrawAddress ? (
                <>
                  <div className="bg-base-300 rounded-lg p-2">
                    <div className="text-xs opacity-60 mb-1">Funds will be sent to:</div>
                    <Address address={withdrawAddress as `0x${string}`} size="sm" />
                  </div>
                  <button
                    className={`btn btn-warning btn-sm w-full ${isGuardianRecovering ? "loading" : ""}`}
                    onClick={handleGuardianRecover}
                    disabled={isGuardianRecovering || usdcBalance === 0n}
                  >
                    {isGuardianRecovering
                      ? "Recovering..."
                      : usdcBalance === 0n
                        ? "No USDC"
                        : `Recover $${formatUnits(usdcBalance, USDC_DECIMALS)}`}
                  </button>
                </>
              ) : (
                <div className="text-xs text-warning">No withdraw address set.</div>
              )}
            </div>
          )}

          <div className="divider my-2"></div>

          {/* Clear Passkey Data */}
          <div className="space-y-3">
            <h4 className="font-bold text-sm flex items-center gap-2">
              <TrashIcon className="w-4 h-4" />
              Clear Wallet Data
            </h4>
            <p className="text-xs opacity-60">
              Remove this wallet from your browser. You can recover it later using your passkey.
            </p>
            <button className="btn btn-error btn-outline btn-sm w-full" onClick={handleLogout}>
              Clear & Logout
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
