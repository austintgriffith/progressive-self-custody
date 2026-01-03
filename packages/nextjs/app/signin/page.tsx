"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { NextPage } from "next";
import { getAddress } from "viem";
import { usePublicClient } from "wagmi";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { BlockieAvatar } from "~~/components/scaffold-eth";
import { usePasskeyWallet } from "~~/contexts/PasskeyWalletContext";
import { ERC20_ABI } from "~~/contracts/externalContracts";
import { formatUsdc } from "~~/utils/scaffold-eth";

// Component to display account card with balance
const AccountCard = ({
  address,
  onLogin,
  onForget,
  isLoggingIn,
  usdcAddress,
}: {
  address: string;
  onLogin: () => void;
  onForget: () => void;
  isLoggingIn: boolean;
  usdcAddress: `0x${string}`;
}) => {
  const publicClient = usePublicClient();
  const [balance, setBalance] = useState<bigint | null>(null);

  useEffect(() => {
    const fetchBalance = async () => {
      if (!publicClient) return;
      try {
        const bal = await publicClient.readContract({
          address: usdcAddress,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address as `0x${string}`],
        });
        setBalance(bal as bigint);
      } catch (err) {
        console.error("Error fetching balance:", err);
      }
    };
    fetchBalance();
  }, [address, publicClient, usdcAddress]);

  const checksumAddress = getAddress(address as `0x${string}`);
  const displayAddress = `${checksumAddress.slice(0, 6)}...${checksumAddress.slice(-4)}`;

  return (
    <div className="bg-base-200 rounded-2xl p-4 hover:bg-base-300 transition-colors relative group cursor-pointer">
      {/* Forget button */}
      <button
        onClick={e => {
          e.stopPropagation();
          onForget();
        }}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity btn btn-ghost btn-xs btn-circle"
        title="Forget this account"
      >
        <XMarkIcon className="w-4 h-4" />
      </button>

      <button
        onClick={onLogin}
        disabled={isLoggingIn}
        className="w-full text-left flex items-center gap-4 cursor-pointer"
      >
        <BlockieAvatar address={checksumAddress} size={48} />
        <div className="flex-1 min-w-0">
          <div className="font-mono text-sm opacity-80">{displayAddress}</div>
          <div className="text-xl font-bold">
            {balance !== null ? `$${formatUsdc(balance)}` : <span className="loading loading-dots loading-xs"></span>}
          </div>
        </div>
        {isLoggingIn ? (
          <span className="loading loading-spinner loading-md"></span>
        ) : (
          <div className="text-accent text-sm font-medium">Sign in →</div>
        )}
      </button>
    </div>
  );
};

const SignInPage: NextPage = () => {
  const router = useRouter();
  const {
    walletAddress,
    isLoading,
    isCreating,
    error,
    createAccount,
    loginWithExistingPasskey,
    loginToAccount,
    clearError,
    forgetAccount,
    knownAccounts,
    usdcAddress,
  } = usePasskeyWallet();

  // Redirect to home if already logged in
  useEffect(() => {
    if (walletAddress && !isLoading) {
      router.push("/");
    }
  }, [walletAddress, isLoading, router]);

  // Handle login to a specific account (instant - no auth required)
  const handleLoginToAccount = (address: string) => {
    loginToAccount(address);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  // Already logged in - will redirect
  if (walletAddress) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  const hasKnownAccounts = knownAccounts.length > 0;

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="max-w-md w-full">
          <h1 className="text-3xl font-bold text-center mb-8">Sign In</h1>

          {/* Show account list if user has known accounts */}
          {hasKnownAccounts && (
            <div className="mb-8">
              <h2 className="text-lg font-semibold mb-4 opacity-70">Your Accounts</h2>
              <div className="flex flex-col gap-3 mb-6">
                {knownAccounts.map(address => (
                  <AccountCard
                    key={address}
                    address={address}
                    onLogin={() => handleLoginToAccount(address)}
                    onForget={() => forgetAccount(address)}
                    isLoggingIn={isCreating}
                    usdcAddress={usdcAddress}
                  />
                ))}
              </div>

              <div className="divider">or</div>
            </div>
          )}

          {/* Create / Connect buttons */}
          <div className="flex flex-col gap-4">
            {isCreating ? (
              <div className="flex flex-col items-center justify-center py-8 gap-3">
                <span className="loading loading-spinner loading-lg"></span>
                <span className="text-sm opacity-70">Setting up your wallet...</span>
              </div>
            ) : (
              <>
                <button className="btn btn-primary btn-lg text-lg w-full" onClick={createAccount}>
                  Create New Account
                </button>

                <button className="btn btn-outline btn-lg text-lg w-full" onClick={loginWithExistingPasskey}>
                  Use Existing Account
                </button>
              </>
            )}
          </div>

          {error && (
            <div className="alert alert-error mt-6">
              <span>{error}</span>
              <button className="btn btn-ghost btn-sm" onClick={clearError}>
                ✕
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SignInPage;
