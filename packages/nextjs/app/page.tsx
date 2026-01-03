"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { NextPage } from "next";
import { DepositContent } from "~~/components/scaffold-eth/PasskeyWalletConnectButton/DepositContent";
import { usePasskeyWallet } from "~~/contexts/PasskeyWalletContext";
import deployedContracts from "~~/contracts/deployedContracts";
import { formatUsdc } from "~~/utils/scaffold-eth";

const BET_AMOUNT = "0.05";

const Home: NextPage = () => {
  const {
    walletAddress,
    passkey,
    usdcBalance,
    isLoading,
    isDeploying,
    isDeployed,
    error,
    loginWithExistingPasskey,
    signAndSubmit,
    clearError,
    chainId,
  } = usePasskeyWallet();

  // Dice roll state
  const [isRolling, setIsRolling] = useState(false);
  const [rollResult, setRollResult] = useState<{ won: boolean; payout: string } | null>(null);
  const [rollError, setRollError] = useState<string | null>(null);

  // Auto-dismiss roll result after 3 seconds
  useEffect(() => {
    if (rollResult) {
      const timer = setTimeout(() => {
        setRollResult(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [rollResult]);

  // Handle dice roll
  const handleDiceRoll = async () => {
    const chainContracts = deployedContracts[chainId as keyof typeof deployedContracts];
    if (!chainContracts?.Example?.address) {
      setRollError("Example contract not deployed on this chain");
      return;
    }
    const exampleContractAddress = chainContracts.Example.address;

    // Check if user has enough USDC for the bet (gas fee may be 0 or configured via FACILITATOR_FEE_USDC)
    const minRequired = BigInt(50000); // 0.05 bet
    if (usdcBalance < minRequired) {
      setRollError(`Need at least $0.05 USDC for the bet. You have $${formatUsdc(usdcBalance)}`);
      return;
    }

    setIsRolling(true);
    setRollError(null);
    setRollResult(null);

    try {
      // Use the API response directly - it reads lastRollResult from the contract
      const result = await signAndSubmit("dumbDiceRoll", {
        exampleContract: exampleContractAddress,
      });

      // Set result from API response (bulletproof - reads contract state after tx)
      if (result.diceRollResult) {
        setRollResult(result.diceRollResult);
      } else {
        // Fallback if no result returned
        setRollResult({ won: false, payout: "-1" });
      }
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

  // Not logged in - Show dice roll with "Sign In To Roll" button
  if (!walletAddress) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8">
        <div className="max-w-md w-full">
          {/* Dice Roll Card */}
          <div className="bg-base-200 rounded-2xl p-8 text-center">
            <h2 className="text-3xl font-bold mb-2">🎲 Dumb Dice Roll (example app)</h2>
            <p className="text-sm opacity-60 mb-8">
              Bet ${BET_AMOUNT} USDC for a 50/50 chance to double your money! (this is using previous blockhash, it is
              an example and should NOT hold real money)
            </p>

            {/* Sign In Button */}
            <Link href="/signin" className="btn btn-primary btn-lg w-full text-xl gap-3">
              <span className="text-2xl">🎲</span>
              Sign In To Roll
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Wallet exists but not deployed - Show Funding UI or Deploying UI
  if (isDeployed === false) {
    // Show deploying screen if deployment is in progress OR if we have funds (deployment will start momentarily)
    const showDeploying = isDeploying || usdcBalance > 0n;

    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8">
        <div className="max-w-xl w-full">
          <div className="bg-base-200 rounded-3xl p-8 text-center">
            {showDeploying ? (
              <>
                <div className="mb-6">
                  <span className="loading loading-spinner loading-lg text-primary"></span>
                </div>
                <h2 className="text-2xl font-bold mb-4">Deploying Your Wallet...</h2>
                <p className="opacity-60">Your wallet contract is being deployed. This only takes a few seconds.</p>
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
          <h2 className="text-3xl font-bold mb-2">🎲 Dumb Dice Roll (example app)</h2>
          <p className="text-sm opacity-60 mb-6">
            Bet ${BET_AMOUNT} USDC for a 50/50 chance to double your money! (this is using previous blockhash, it is an
            example and should NOT hold real money)
          </p>

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
                rollResult.payout === "-1"
                  ? "alert-info"
                  : rollResult.won
                    ? rollResult.payout === "100000"
                      ? "alert-success"
                      : "alert-warning"
                    : "alert-error"
              }`}
            >
              <span className="text-lg">
                {rollResult.payout === "-1" && "⚠️ Couldn't read result"}
                {rollResult.won && rollResult.payout === "100000" && "🎉 You won $0.10!"}
                {rollResult.won && rollResult.payout === "50000" && "🤷 Won but house is broke - refunded!"}
                {!rollResult.won && rollResult.payout !== "-1" && "😢 You lost $0.05"}
              </span>
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
