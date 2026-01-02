"use client";

import { useEffect, useState } from "react";
import type { NextPage } from "next";
import { getAddress } from "viem";
import { usePublicClient } from "wagmi";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { BlockieAvatar } from "~~/components/scaffold-eth";
import { DepositContent } from "~~/components/scaffold-eth/PasskeyWalletConnectButton/DepositContent";
import { usePasskeyWallet } from "~~/contexts/PasskeyWalletContext";
import deployedContracts from "~~/contracts/deployedContracts";
import { ERC20_ABI } from "~~/contracts/externalContracts";
import { formatUsdc } from "~~/utils/scaffold-eth";

const BET_AMOUNT = "0.05";

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
    loginToAccount,
    signAndSubmit,
    clearError,
    forgetAccount,
    knownAccounts,
    chainId,
    usdcAddress,
  } = usePasskeyWallet();

  // Dice roll state
  const [isRolling, setIsRolling] = useState(false);
  const [rollResult, setRollResult] = useState<"won" | "lost" | "refunded" | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [rollError, setRollError] = useState<string | null>(null);
  // Handle login to a specific account (instant - no auth required)
  const handleLoginToAccount = (address: string) => {
    loginToAccount(address);
  };

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

  // No wallet logged in - Show account selection or create/login UI
  if (!walletAddress) {
    const hasKnownAccounts = knownAccounts.length > 0;

    return (
      <div className="min-h-screen flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
          <div className="max-w-2xl w-full text-center">
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

                <div className="divider"></div>
              </div>
            )}

            {/* Create / Connect buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
              <button
                className={`btn btn-primary btn-lg text-lg flex-1 sm:flex-none ${isCreating ? "loading" : ""}`}
                onClick={createAccount}
                disabled={isCreating}
              >
                {isCreating ? "Creating..." : "Create Account"}
              </button>

              <button
                className={`btn btn-outline btn-lg text-lg flex-1 sm:flex-none ${isCreating ? "loading" : ""}`}
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
                <p className="opacity-60 mb-4">${formatUsdc(usdcBalance)} USDC detected. Deploying your wallet...</p>
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
