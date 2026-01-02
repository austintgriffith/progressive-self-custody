"use client";

import { PasskeyWalletDropdown } from "./PasskeyWalletDropdown";
import { usePasskeyWallet } from "~~/contexts/PasskeyWalletContext";
import { formatUsdc } from "~~/utils/scaffold-eth";

/**
 * Passkey Wallet Connect Button - displays in header
 * Shows "Create Account" when no wallet, or balance + address dropdown when connected
 */
export const PasskeyWalletConnectButton = () => {
  const { walletAddress, usdcBalance, isLoading, isCreating, createAccount, loginWithExistingPasskey, isDeployed } =
    usePasskeyWallet();

  // Loading state
  if (isLoading) {
    return <span className="loading loading-spinner loading-sm"></span>;
  }

  // No wallet - show create/login buttons
  if (!walletAddress) {
    return (
      <div className="flex gap-2">
        <button className="btn btn-primary btn-sm" onClick={createAccount} disabled={isCreating}>
          {isCreating ? <span className="loading loading-spinner loading-xs"></span> : "Create Account"}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={loginWithExistingPasskey} disabled={isCreating}>
          Existing Account
        </button>
      </div>
    );
  }

  // Wallet exists - show balance + dropdown
  return (
    <div className="flex items-center gap-2">
      {/* USDC Balance */}
      <div className="tooltip tooltip-bottom" data-tip={isDeployed === false ? "Pending deployment" : "USDC"}>
        <span className="text-xl font-bold mr-2 cursor-default">${formatUsdc(usdcBalance)}</span>
      </div>

      {/* Address Dropdown */}
      <PasskeyWalletDropdown />
    </div>
  );
};
