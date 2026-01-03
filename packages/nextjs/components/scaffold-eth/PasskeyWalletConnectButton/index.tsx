"use client";

import Link from "next/link";
import { PasskeyWalletDropdown } from "./PasskeyWalletDropdown";
import { usePasskeyWallet } from "~~/contexts/PasskeyWalletContext";
import { formatUsdc } from "~~/utils/scaffold-eth";

/**
 * Passkey Wallet Connect Button - displays in header
 * Shows "Sign In" when no wallet, or balance + address dropdown when connected
 */
export const PasskeyWalletConnectButton = () => {
  const { walletAddress, usdcBalance, isLoading, isDeployed } = usePasskeyWallet();

  // Loading state
  if (isLoading) {
    return <span className="loading loading-spinner loading-sm"></span>;
  }

  // No wallet - show sign in button
  if (!walletAddress) {
    return (
      <Link href="/signin" className="btn btn-primary btn-sm">
        Sign In
      </Link>
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
