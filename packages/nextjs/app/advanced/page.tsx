"use client";

import { useState } from "react";
import Link from "next/link";
import { isAddress } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { KeyIcon, ShieldCheckIcon, UserGroupIcon, WrenchScrewdriverIcon } from "@heroicons/react/24/outline";
import { SMART_WALLET_ABI } from "~~/contracts/SmartWalletAbi";
import { createPasskey, getCredentialIdHash } from "~~/utils/passkey";

export default function AdvancedPage() {
  const { address: connectedAddress, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();

  // State
  const [targetWallet, setTargetWallet] = useState("");
  const [walletInfo, setWalletInfo] = useState<{
    owner: string;
    guardian: string;
    passkeyCreated: boolean;
    withdrawAddress: string;
    hasRecoveryPassword: boolean;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // New passkey fields
  const [newPasskeyQx, setNewPasskeyQx] = useState("");
  const [newPasskeyQy, setNewPasskeyQy] = useState("");
  const [newPasskeyCredentialId, setNewPasskeyCredentialId] = useState("");

  // New guardian field
  const [newGuardian, setNewGuardian] = useState("");

  // Fetch wallet info
  const fetchWalletInfo = async () => {
    if (!targetWallet || !isAddress(targetWallet) || !publicClient) {
      setError("Please enter a valid wallet address");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [owner, guardian, passkeyCreated, withdrawAddress, recoveryHash] = await Promise.all([
        publicClient.readContract({
          address: targetWallet as `0x${string}`,
          abi: SMART_WALLET_ABI,
          functionName: "owner",
        }),
        publicClient.readContract({
          address: targetWallet as `0x${string}`,
          abi: SMART_WALLET_ABI,
          functionName: "guardian",
        }),
        publicClient.readContract({
          address: targetWallet as `0x${string}`,
          abi: SMART_WALLET_ABI,
          functionName: "passkeyCreated",
        }),
        publicClient.readContract({
          address: targetWallet as `0x${string}`,
          abi: SMART_WALLET_ABI,
          functionName: "withdrawAddress",
        }),
        publicClient.readContract({
          address: targetWallet as `0x${string}`,
          abi: SMART_WALLET_ABI,
          functionName: "recoveryPasswordHash",
        }),
      ]);

      setWalletInfo({
        owner: owner as string,
        guardian: guardian as string,
        passkeyCreated: passkeyCreated as boolean,
        withdrawAddress: withdrawAddress as string,
        hasRecoveryPassword:
          (recoveryHash as string) !== "0x0000000000000000000000000000000000000000000000000000000000000000",
      });
    } catch (err) {
      console.error("Error fetching wallet info:", err);
      setError("Failed to fetch wallet info. Is this a valid SmartWallet?");
    } finally {
      setIsLoading(false);
    }
  };

  // Check if connected wallet is owner
  const isOwner = walletInfo && connectedAddress && walletInfo.owner.toLowerCase() === connectedAddress.toLowerCase();

  // Check if connected wallet is guardian
  const isGuardian =
    walletInfo && connectedAddress && walletInfo.guardian.toLowerCase() === connectedAddress.toLowerCase();

  // Add passkey (owner only)
  const handleAddPasskey = async () => {
    if (!isOwner) {
      setError("Only the owner can add passkeys");
      return;
    }

    if (!newPasskeyQx || !newPasskeyQy || !newPasskeyCredentialId) {
      setError("Please fill in all passkey fields");
      return;
    }

    if (!newPasskeyQx.startsWith("0x") || newPasskeyQx.length !== 66) {
      setError("Qx must be a 32-byte hex string (0x + 64 chars)");
      return;
    }
    if (!newPasskeyQy.startsWith("0x") || newPasskeyQy.length !== 66) {
      setError("Qy must be a 32-byte hex string (0x + 64 chars)");
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const credentialIdHash = getCredentialIdHash(newPasskeyCredentialId);

      await writeContractAsync({
        address: targetWallet as `0x${string}`,
        abi: SMART_WALLET_ABI,
        functionName: "addPasskey",
        args: [newPasskeyQx as `0x${string}`, newPasskeyQy as `0x${string}`, credentialIdHash],
      });

      setSuccess("Passkey added successfully!");
      setNewPasskeyQx("");
      setNewPasskeyQy("");
      setNewPasskeyCredentialId("");
      await fetchWalletInfo();
    } catch (err) {
      console.error("Add passkey error:", err);
      setError(err instanceof Error ? err.message : "Failed to add passkey");
    } finally {
      setIsLoading(false);
    }
  };

  // Generate passkey for this wallet (for adding to another device)
  const handleGeneratePasskey = async () => {
    try {
      const { credentialId, qx, qy, passkeyAddress } = await createPasskey();
      setNewPasskeyQx(qx);
      setNewPasskeyQy(qy);
      setNewPasskeyCredentialId(credentialId);
      setSuccess(`Passkey generated! Address: ${passkeyAddress}`);
    } catch (err) {
      console.error("Generate passkey error:", err);
      setError(err instanceof Error ? err.message : "Failed to generate passkey");
    }
  };

  // Change guardian (owner only)
  const handleChangeGuardian = async () => {
    if (!isOwner) {
      setError("Only the owner can change the guardian");
      return;
    }

    if (!newGuardian || !isAddress(newGuardian)) {
      setError("Please enter a valid address");
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await writeContractAsync({
        address: targetWallet as `0x${string}`,
        abi: SMART_WALLET_ABI,
        functionName: "setGuardian",
        args: [newGuardian as `0x${string}`],
      });

      setSuccess("Guardian updated successfully!");
      setNewGuardian("");
      await fetchWalletInfo();
    } catch (err) {
      console.error("Change guardian error:", err);
      setError(err instanceof Error ? err.message : "Failed to change guardian");
    } finally {
      setIsLoading(false);
    }
  };

  // Become guardian (if current guardian is facilitator)
  const handleBecomeGuardian = async () => {
    if (!connectedAddress) return;
    setNewGuardian(connectedAddress);
  };

  return (
    <div className="min-h-screen bg-base-100">
      {/* Header */}
      <div className="border-b border-base-300 px-4 py-4">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <Link href="/" className="btn btn-ghost btn-sm">
            ← Back
          </Link>
          <span className="font-semibold">Advanced Settings</span>
          <div className="w-16" />
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
            <WrenchScrewdriverIcon className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Advanced Wallet Management</h1>
          <p className="opacity-80">For power users who want full control over their smart wallet.</p>
        </div>

        {/* Connect Wallet Prompt */}
        {!isConnected && (
          <div className="bg-warning/10 border border-warning rounded-2xl p-6 mb-8 text-center">
            <h3 className="font-bold mb-2">Connect Your Wallet</h3>
            <p className="text-sm opacity-80 mb-4">
              Connect with RainbowKit to access advanced features. You&apos;ll need to be the owner or guardian of a
              smart wallet.
            </p>
          </div>
        )}

        {/* Wallet Selection */}
        <div className="bg-base-200 rounded-2xl p-6 mb-6">
          <h3 className="font-bold mb-4 flex items-center gap-2">
            <KeyIcon className="w-5 h-5" />
            Select Smart Wallet
          </h3>
          <div className="form-control mb-4">
            <label className="label">
              <span className="label-text">Smart Wallet Address</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="0x..."
                className="input input-bordered flex-1"
                value={targetWallet}
                onChange={e => setTargetWallet(e.target.value)}
              />
              <button
                className={`btn btn-primary ${isLoading ? "loading" : ""}`}
                onClick={fetchWalletInfo}
                disabled={isLoading}
              >
                Load
              </button>
            </div>
          </div>

          {/* Wallet Info Display */}
          {walletInfo && (
            <div className="bg-base-300 rounded-xl p-4 space-y-2">
              <div className="flex justify-between">
                <span className="opacity-60">Owner</span>
                <span className="font-mono text-sm">
                  {walletInfo.owner.slice(0, 6)}...{walletInfo.owner.slice(-4)}
                  {isOwner && <span className="badge badge-success badge-sm ml-2">You</span>}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-60">Guardian</span>
                <span className="font-mono text-sm">
                  {walletInfo.guardian.slice(0, 6)}...{walletInfo.guardian.slice(-4)}
                  {isGuardian && <span className="badge badge-info badge-sm ml-2">You</span>}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-60">Passkey</span>
                <span>{walletInfo.passkeyCreated ? "✅ Created" : "❌ Not Created"}</span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-60">Withdraw Address</span>
                <span className="font-mono text-sm">
                  {walletInfo.withdrawAddress !== "0x0000000000000000000000000000000000000000"
                    ? `${walletInfo.withdrawAddress.slice(0, 6)}...${walletInfo.withdrawAddress.slice(-4)}`
                    : "Not Set"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-60">Recovery Password</span>
                <span>{walletInfo.hasRecoveryPassword ? "✅ Set" : "❌ Not Set"}</span>
              </div>
            </div>
          )}
        </div>

        {/* Error/Success Display */}
        {error && (
          <div className="alert alert-error mb-6">
            <span>{error}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>
              ✕
            </button>
          </div>
        )}
        {success && (
          <div className="alert alert-success mb-6">
            <span>{success}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setSuccess(null)}>
              ✕
            </button>
          </div>
        )}

        {/* Advanced Features - Only show when wallet is loaded */}
        {walletInfo && (
          <div className="grid gap-6 md:grid-cols-2">
            {/* Passkey Management */}
            <div className="bg-base-200 rounded-2xl p-6">
              <h3 className="font-bold mb-4 flex items-center gap-2">
                <ShieldCheckIcon className="w-5 h-5" />
                Passkey Management
              </h3>
              <p className="text-sm opacity-60 mb-4">
                Add a new passkey from another device. {!isOwner && "(Owner only)"}
              </p>

              <button className="btn btn-outline btn-sm mb-4" onClick={handleGeneratePasskey}>
                Generate New Passkey
              </button>

              <div className="form-control mb-2">
                <label className="label">
                  <span className="label-text">Qx (Public Key X)</span>
                </label>
                <input
                  type="text"
                  placeholder="0x..."
                  className="input input-bordered input-sm"
                  value={newPasskeyQx}
                  onChange={e => setNewPasskeyQx(e.target.value)}
                  disabled={!isOwner}
                />
              </div>
              <div className="form-control mb-2">
                <label className="label">
                  <span className="label-text">Qy (Public Key Y)</span>
                </label>
                <input
                  type="text"
                  placeholder="0x..."
                  className="input input-bordered input-sm"
                  value={newPasskeyQy}
                  onChange={e => setNewPasskeyQy(e.target.value)}
                  disabled={!isOwner}
                />
              </div>
              <div className="form-control mb-4">
                <label className="label">
                  <span className="label-text">Credential ID</span>
                </label>
                <input
                  type="text"
                  placeholder="Base64url encoded"
                  className="input input-bordered input-sm"
                  value={newPasskeyCredentialId}
                  onChange={e => setNewPasskeyCredentialId(e.target.value)}
                  disabled={!isOwner}
                />
              </div>
              <button
                className={`btn btn-primary w-full ${isPending ? "loading" : ""}`}
                onClick={handleAddPasskey}
                disabled={!isOwner || isPending}
              >
                Add Passkey
              </button>
            </div>

            {/* Guardian Management */}
            <div className="bg-base-200 rounded-2xl p-6">
              <h3 className="font-bold mb-4 flex items-center gap-2">
                <UserGroupIcon className="w-5 h-5" />
                Guardian Management
              </h3>
              <p className="text-sm opacity-60 mb-4">
                Change the guardian address. The guardian can trigger recovery. {!isOwner && "(Owner only)"}
              </p>

              {isConnected && !isGuardian && (
                <button className="btn btn-outline btn-sm mb-4" onClick={handleBecomeGuardian}>
                  Use My Address
                </button>
              )}

              <div className="form-control mb-4">
                <label className="label">
                  <span className="label-text">New Guardian Address</span>
                </label>
                <input
                  type="text"
                  placeholder="0x..."
                  className="input input-bordered"
                  value={newGuardian}
                  onChange={e => setNewGuardian(e.target.value)}
                  disabled={!isOwner}
                />
              </div>
              <button
                className={`btn btn-primary w-full ${isPending ? "loading" : ""}`}
                onClick={handleChangeGuardian}
                disabled={!isOwner || isPending}
              >
                Update Guardian
              </button>
            </div>
          </div>
        )}

        {/* Info Section */}
        <div className="mt-8 bg-base-200 rounded-2xl p-6">
          <h3 className="font-bold mb-4">What can you do here?</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h4 className="font-semibold mb-1">As Owner</h4>
              <ul className="text-sm opacity-70 list-disc list-inside space-y-1">
                <li>Add or remove passkeys</li>
                <li>Change the guardian address</li>
                <li>Execute any transaction</li>
                <li>Cancel recovery attempts</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-1">As Guardian</h4>
              <ul className="text-sm opacity-70 list-disc list-inside space-y-1">
                <li>Trigger deadman recovery</li>
                <li>Execute recovery after delay</li>
                <li>Help users recover lost wallets</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
