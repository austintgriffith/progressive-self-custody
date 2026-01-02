"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { NextPage } from "next";
import { createPasskey, getCredentialIdHash, isWebAuthnSupported, loginWithPasskey } from "~~/utils/passkey";

const Home: NextPage = () => {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCheckingStorage, setIsCheckingStorage] = useState(true);

  // Check localStorage for existing wallet on mount
  useEffect(() => {
    const checkExistingWallet = () => {
      // First check for pending wallet (just created, not yet visited)
      const pendingWallet = localStorage.getItem("psc-pending-wallet");
      if (pendingWallet) {
        router.push(`/wallet/${pendingWallet}`);
        return;
      }

      // Check for any saved passkey wallets
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("psc-passkey-")) {
          // Extract wallet address from key (psc-passkey-0x...)
          const walletAddress = key.replace("psc-passkey-", "");
          if (walletAddress.startsWith("0x")) {
            router.push(`/wallet/${walletAddress}`);
            return;
          }
        }
      }

      setIsCheckingStorage(false);
    };

    checkExistingWallet();
  }, [router]);

  // Create new account (generate passkey)
  const handleCreateAccount = async () => {
    if (!isWebAuthnSupported()) {
      setError("WebAuthn is not supported in this browser. Please use a modern browser with passkey support.");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      // Generate passkey
      const { credentialId, qx, qy, passkeyAddress } = await createPasskey();

      // Predict wallet address
      const response = await fetch(`/api/deploy-wallet?chainId=31337&qx=${qx}&qy=${qy}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to predict wallet address");
      }

      // Store passkey info in localStorage for later
      const passkeyData = {
        credentialId,
        qx,
        qy,
        passkeyAddress,
        credentialIdHash: getCredentialIdHash(credentialId),
      };
      localStorage.setItem(`psc-passkey-${data.walletAddress.toLowerCase()}`, JSON.stringify(passkeyData));
      localStorage.setItem("psc-pending-wallet", data.walletAddress);

      // Navigate directly to wallet page
      router.push(`/wallet/${data.walletAddress}`);
    } catch (err) {
      console.error("Create account error:", err);
      setError(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setIsCreating(false);
    }
  };

  // Login with existing passkey
  const handleExistingAccount = async () => {
    if (!isWebAuthnSupported()) {
      setError("WebAuthn is not supported in this browser. Please use a modern browser with passkey support.");
      return;
    }

    setIsLoggingIn(true);
    setError(null);

    try {
      // Login with passkey (recovers public key)
      const { credentialId, qx, qy, passkeyAddress } = await loginWithPasskey();

      // Predict wallet address
      const response = await fetch(`/api/deploy-wallet?chainId=31337&qx=${qx}&qy=${qy}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to find wallet");
      }

      // Store passkey info
      const passkeyData = {
        credentialId,
        qx,
        qy,
        passkeyAddress,
        credentialIdHash: getCredentialIdHash(credentialId),
      };
      localStorage.setItem(`psc-passkey-${data.walletAddress.toLowerCase()}`, JSON.stringify(passkeyData));
      localStorage.setItem("psc-pending-wallet", data.walletAddress);

      // Navigate to wallet page
      router.push(`/wallet/${data.walletAddress}`);
    } catch (err) {
      console.error("Login error:", err);
      setError(err instanceof Error ? err.message : "Failed to login");
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Show loading while checking localStorage
  if (isCheckingStorage) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero Section */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="max-w-2xl w-full text-center">
          {/* Logo/Title */}
          <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
            Progressive Self-Custody
          </h1>
          <p className="text-xl opacity-80 mb-8">
            DeFi-enabled passkey wallets. No seed phrases, no gas tokens, just your face or fingerprint.
          </p>

          {/* Main CTAs */}
          <div className="flex flex-col gap-4 mb-8">
            <button
              className={`btn btn-primary btn-lg text-lg ${isCreating ? "loading" : ""}`}
              onClick={handleCreateAccount}
              disabled={isCreating || isLoggingIn}
            >
              {isCreating ? "Creating..." : "Create Account"}
            </button>

            <button
              className={`btn btn-outline btn-lg text-lg ${isLoggingIn ? "loading" : ""}`}
              onClick={handleExistingAccount}
              disabled={isCreating || isLoggingIn}
            >
              {isLoggingIn ? "Signing in..." : "Existing Account"}
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="alert alert-error mb-8">
              <span>{error}</span>
            </div>
          )}

          {/* Features */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left mb-12">
            <div className="bg-base-200 rounded-2xl p-6">
              <div className="text-3xl mb-3">🔐</div>
              <h3 className="font-bold mb-2">No Seed Phrases</h3>
              <p className="text-sm opacity-70">
                Your passkey is secured by your device. No 12 words to write down or lose.
              </p>
            </div>
            <div className="bg-base-200 rounded-2xl p-6">
              <div className="text-3xl mb-3">⛽</div>
              <h3 className="font-bold mb-2">No Gas Tokens</h3>
              <p className="text-sm opacity-70">Pay fees in USDC automatically. No need to buy or manage ETH.</p>
            </div>
            <div className="bg-base-200 rounded-2xl p-6">
              <div className="text-3xl mb-3">📈</div>
              <h3 className="font-bold mb-2">Auto Yield</h3>
              <p className="text-sm opacity-70">Idle USDC earns DeFi yield automatically. Your money works for you.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer with Advanced Link */}
      <div className="border-t border-base-300 py-4">
        <div className="flex justify-center gap-8 text-sm">
          <Link href="/recover" className="opacity-60 hover:opacity-100 transition-opacity">
            Lost your passkey?
          </Link>
          <Link href="/advanced" className="opacity-60 hover:opacity-100 transition-opacity">
            Advanced
          </Link>
          <Link href="/debug" className="opacity-60 hover:opacity-100 transition-opacity">
            Debug Contracts
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Home;
