"use client";

import { useEffect, useRef, useState } from "react";
import { Address } from "@scaffold-ui/components";
import { QRCodeSVG } from "qrcode.react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { usePasskeyWallet } from "~~/contexts/PasskeyWalletContext";
import { ERC20_ABI } from "~~/contracts/externalContracts";
import { formatUsdc } from "~~/utils/scaffold-eth";

const USDC_DECIMALS = 6;

// Animated balance component with pulse effect on change
const AnimatedBalance = ({ balance }: { balance: bigint }) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const prevBalanceRef = useRef<bigint>(balance);

  useEffect(() => {
    // Trigger animation when balance changes (and isn't the initial render)
    if (prevBalanceRef.current !== balance && prevBalanceRef.current !== 0n) {
      setIsAnimating(true);
      const timer = setTimeout(() => setIsAnimating(false), 1000);
      return () => clearTimeout(timer);
    }
    prevBalanceRef.current = balance;
  }, [balance]);

  return (
    <div
      className={`
        inline-block transition-all duration-300 ease-out
        ${isAnimating ? "scale-125 text-success animate-pulse" : "scale-100"}
      `}
    >
      <span className="text-3xl font-bold tabular-nums">${formatUsdc(balance)}</span>
      {isAnimating && <span className="ml-2 text-success text-lg animate-bounce inline-block">✨</span>}
    </div>
  );
};

type DepositContentProps = {
  walletAddress: string;
};

export const DepositContent = ({ walletAddress }: DepositContentProps) => {
  const { usdcAddress, usdcBalance } = usePasskeyWallet();
  const { address: connectedAddress, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();

  // Fetch connected wallet's USDC balance
  const { data: connectedWalletBalance } = useReadContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    query: {
      enabled: !!connectedAddress,
    },
  });

  const [depositAmount, setDepositAmount] = useState("");
  const [isDepositing, setIsDepositing] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [depositSuccess, setDepositSuccess] = useState<string | null>(null);

  const handleDeposit = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0 || !walletAddress) {
      setDepositError("Please enter a valid amount");
      return;
    }

    setIsDepositing(true);
    setDepositError(null);
    setDepositSuccess(null);

    try {
      const amountInUnits = BigInt(Math.floor(parseFloat(depositAmount) * 10 ** USDC_DECIMALS));

      await writeContractAsync({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [walletAddress as `0x${string}`, amountInUnits],
      });

      setDepositSuccess(`Successfully deposited $${depositAmount} USDC!`);
      setDepositAmount("");
    } catch (err) {
      console.error("Deposit error:", err);
      setDepositError(err instanceof Error ? err.message : "Failed to deposit");
    } finally {
      setIsDepositing(false);
    }
  };

  // Coinbase Onramp - uses session token from our API
  const openCoinbaseOnramp = async () => {
    setIsDepositing(true);
    setDepositError(null);

    try {
      const response = await fetch("/api/coinbase-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress }),
      });

      const data = await response.json();

      if (data.success && data.sessionToken) {
        // Build Coinbase Onramp URL with session token
        const params = new URLSearchParams({
          sessionToken: data.sessionToken,
          defaultAsset: "USDC",
          defaultNetwork: "base",
          presetFiatAmount: "5",
          fiatCurrency: "USD",
        });
        window.open(`https://pay.coinbase.com/buy/select-asset?${params.toString()}`, "_blank");
      } else {
        console.error("Failed to get Coinbase session:", data.error, data.details);
        setDepositError(`Coinbase error: ${data.details || data.error}`);
      }
    } catch (error) {
      console.error("Error opening Coinbase:", error);
      setDepositError("Failed to open Coinbase. Please try again.");
    } finally {
      setIsDepositing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Current Balance Display */}
      <div className="text-center py-4 bg-base-300/50 rounded-xl">
        <p className="text-xs uppercase tracking-wider opacity-60 mb-1">Current Balance</p>
        <AnimatedBalance balance={usdcBalance} />
      </div>

      {/* Success Message */}
      {depositSuccess && (
        <div className="alert alert-success">
          <span>{depositSuccess}</span>
          <button className="btn btn-ghost btn-xs" onClick={() => setDepositSuccess(null)}>
            ✕
          </button>
        </div>
      )}

      {/* Coinbase Onramp */}
      <div className="text-center">
        <button onClick={openCoinbaseOnramp} disabled={isDepositing} className="btn btn-primary btn-lg w-full gap-2">
          {isDepositing ? (
            <>
              <span className="loading loading-spinner loading-sm"></span>
              Opening Coinbase...
            </>
          ) : (
            <>
              <span className="text-xl">💳</span>
              Buy $5 USDC with Coinbase
            </>
          )}
        </button>
      </div>

      <div className="divider text-xs opacity-60">Or send manually</div>

      {/* QR/Address for deposits */}
      <div className="text-center">
        <p className="text-sm opacity-60 mb-4">Send USDC on Base to this address:</p>

        <div className="flex justify-center mb-4">
          <div className="bg-white p-4 rounded-xl">
            <QRCodeSVG value={walletAddress} size={140} />
          </div>
        </div>

        <div className="bg-base-300 rounded-xl px-6 py-4 mb-4 flex justify-center">
          <Address address={walletAddress as `0x${string}`} />
        </div>

        <div className="bg-warning/10 border border-warning rounded-xl p-3 text-left">
          <p className="text-xs font-semibold text-warning mb-1">⚠️ Base Network Only</p>
          <p className="text-xs opacity-80">
            Only send USDC on <strong>Base</strong>. Other networks will result in lost funds.
          </p>
        </div>
      </div>

      <div className="divider text-xs opacity-60">Or deposit from connected wallet</div>

      {/* Deposit from Connected Wallet */}
      <div className="flex justify-center">
        <RainbowKitCustomConnectButton />
      </div>

      {isConnected && connectedAddress && (
        <div className="bg-base-200 rounded-xl p-4 space-y-3">
          {depositError && (
            <div className="alert alert-error py-2">
              <span className="text-sm">{depositError}</span>
              <button className="btn btn-ghost btn-xs" onClick={() => setDepositError(null)}>
                ✕
              </button>
            </div>
          )}

          {/* Available Balance Display */}
          <div className="text-center pb-2">
            <p className="text-xs opacity-60">Available Balance</p>
            <p className="text-lg font-bold">
              ${connectedWalletBalance !== undefined ? formatUsdc(connectedWalletBalance) : "0.00"}
            </p>
          </div>

          <div className="form-control">
            <label className="label py-1">
              <span className="label-text text-sm">Amount (USDC)</span>
            </label>
            <input
              type="number"
              placeholder="0.00"
              className="input input-bordered input-sm"
              value={depositAmount}
              onChange={e => setDepositAmount(e.target.value)}
            />
          </div>

          <button
            className={`btn btn-primary btn-sm w-full ${isDepositing ? "loading" : ""}`}
            onClick={handleDeposit}
            disabled={isDepositing || !depositAmount}
          >
            {isDepositing ? "Depositing..." : "Deposit USDC"}
          </button>
        </div>
      )}
    </div>
  );
};
