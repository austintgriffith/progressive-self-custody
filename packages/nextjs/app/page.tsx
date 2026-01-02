"use client";

import { useState } from "react";
import Link from "next/link";
import type { NextPage } from "next";
import { formatUnits } from "viem";
import { DepositContent } from "~~/components/scaffold-eth/PasskeyWalletConnectButton/DepositContent";
import { usePasskeyWallet } from "~~/contexts/PasskeyWalletContext";
import deployedContracts from "~~/contracts/deployedContracts";

const USDC_DECIMALS = 6;
const BET_AMOUNT = "0.05";

const Home: NextPage = () => {
  const {
    walletAddress,
    passkey,
    usdcBalance,
    isLoading,
    isCreating,
    isDeploying,
    isDeployed,
    error,
    createAccount,
    loginWithExistingPasskey,
    signAndSubmit,
    clearError,
    chainId,
  } = usePasskeyWallet();

  // Dice roll state
  const [isRolling, setIsRolling] = useState(false);
  const [rollResult, setRollResult] = useState<"won" | "lost" | "refunded" | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [rollError, setRollError] = useState<string | null>(null);

  // Handle dice roll
  const handleDiceRoll = async () => {
    const chainContracts = deployedContracts[chainId as keyof typeof deployedContracts];
    if (!chainContracts?.Example?.address) {
      setRollError("Example contract not deployed on this chain");
      return;
    }
    const exampleContractAddress = chainContracts.Example.address;

    // Check if user has enough USDC (0.05 + gas fee)
    const minRequired = BigInt(55000); // 0.05 bet + 0.005 gas
    if (usdcBalance < minRequired) {
      setRollError(`Need at least $0.055 USDC (bet + gas). You have $${formatUnits(usdcBalance, USDC_DECIMALS)}`);
      return;
    }

    setIsRolling(true);
    setRollError(null);
    setRollResult(null);
    setTxHash(null);

    try {
      const hash = await signAndSubmit("dumbDiceRoll", {
        exampleContract: exampleContractAddress,
      });

      setTxHash(hash);

      // For now, we can't easily determine the result from the tx hash
      // In a real app, you'd parse the event logs from the receipt
      // For this simple demo, we just show the tx was successful
      setRollResult("won"); // Placeholder - would need event parsing for real result
    } catch (err) {
      console.error("Dice roll error:", err);
      setRollError(err instanceof Error ? err.message : "Roll failed");
    } finally {
      setIsRolling(false);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  // No wallet - Show Create/Login UI
  if (!walletAddress) {
    return (
      <div className="min-h-screen flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
          <div className="max-w-2xl w-full text-center">
            <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
              Progressive Self-Custody
            </h1>
            <p className="text-xl opacity-80 mb-8">
              DeFi-enabled passkey wallets. No seed phrases, no gas tokens, just your face or fingerprint.
            </p>

            <div className="flex flex-col gap-4 mb-8">
              <button
                className={`btn btn-primary btn-lg text-lg ${isCreating ? "loading" : ""}`}
                onClick={createAccount}
                disabled={isCreating}
              >
                {isCreating ? "Creating..." : "Create Account"}
              </button>

              <button
                className={`btn btn-outline btn-lg text-lg ${isCreating ? "loading" : ""}`}
                onClick={loginWithExistingPasskey}
                disabled={isCreating}
              >
                {isCreating ? "Signing in..." : "Existing Account"}
              </button>
            </div>

            {error && (
              <div className="alert alert-error mb-8">
                <span>{error}</span>
                <button className="btn btn-ghost btn-sm" onClick={clearError}>
                  ✕
                </button>
              </div>
            )}

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
                <p className="text-sm opacity-70">
                  Idle USDC earns DeFi yield automatically. Your money works for you.
                </p>
              </div>
            </div>
          </div>
        </div>

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
  }

  // Wallet exists but not deployed - Show Funding UI
  if (isDeployed === false) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8">
        <div className="max-w-xl w-full">
          <div className="bg-base-200 rounded-3xl p-8 text-center">
            {isDeploying ? (
              <>
                <div className="mb-6">
                  <span className="loading loading-spinner loading-lg text-primary"></span>
                </div>
                <h2 className="text-2xl font-bold mb-4">Deploying Your Wallet...</h2>
                <p className="opacity-60">Your wallet contract is being deployed. This only takes a few seconds.</p>
              </>
            ) : usdcBalance > 0n ? (
              <>
                <div className="text-5xl mb-6">🎉</div>
                <h2 className="text-2xl font-bold mb-4 text-success">Funds Received!</h2>
                <p className="opacity-60 mb-4">
                  ${formatUnits(usdcBalance, USDC_DECIMALS)} USDC detected. Deploying your wallet...
                </p>
                <span className="loading loading-dots loading-md"></span>
              </>
            ) : (
              <>
                <div className="text-5xl mb-6">👋</div>
                <h2 className="text-2xl font-bold mb-2">Step 1: Fund Your Wallet</h2>
                <p className="opacity-60 mb-6">Once funds arrive, your wallet will be automatically deployed.</p>

                <DepositContent walletAddress={walletAddress} />

                <div className="divider mt-6">Waiting for deposit</div>

                <div className="flex items-center justify-center gap-2 text-sm opacity-60">
                  <span className="loading loading-ring loading-sm"></span>
                  Checking every 5 seconds...
                </div>
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
    );
  }

  // Wallet deployed - Show Dice Roll UI
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8">
      <div className="max-w-md w-full">
        {/* Dice Roll Card */}
        <div className="bg-base-200 rounded-2xl p-8 text-center">
          <h2 className="text-3xl font-bold mb-2">🎲 Dumb Dice Roll</h2>
          <p className="text-sm opacity-60 mb-6">Bet ${BET_AMOUNT} USDC for a 50/50 chance to double your money!</p>

          {/* Error Display */}
          {(rollError || error) && (
            <div className="alert alert-error mb-4">
              <span>{rollError || error}</span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setRollError(null);
                  clearError();
                }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Result Display */}
          {rollResult && (
            <div
              className={`alert mb-4 ${
                rollResult === "won" ? "alert-success" : rollResult === "lost" ? "alert-error" : "alert-warning"
              }`}
            >
              <span className="text-lg">
                {rollResult === "won" && "🎉 Transaction sent! Check your balance."}
                {rollResult === "lost" && "😢 You lost $0.05 USDC!"}
                {rollResult === "refunded" && "🤷 Won but contract broke - refunded!"}
              </span>
              {txHash && <span className="text-xs font-mono block mt-1">tx: {txHash.slice(0, 10)}...</span>}
            </div>
          )}

          {/* Dice Roll Button */}
          <button
            className="btn btn-primary btn-lg w-full text-xl gap-3"
            onClick={handleDiceRoll}
            disabled={isRolling || !passkey}
          >
            {isRolling ? (
              <>
                <span className="loading loading-spinner loading-md"></span>
                Rolling...
              </>
            ) : (
              <>
                <span className="text-2xl">🎲</span>
                Roll for ${BET_AMOUNT}
              </>
            )}
          </button>
        </div>

        {/* Passkey Login Prompt if not authenticated */}
        {!passkey && (
          <div className="bg-warning/10 border border-warning rounded-2xl p-4 mt-4 text-center">
            <p className="text-sm opacity-80 mb-2">Sign in with your passkey to roll the dice.</p>
            <button className="btn btn-warning btn-sm" onClick={loginWithExistingPasskey}>
              Sign in with Passkey
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Home;
