"use client";

import { useState } from "react";
import { Address } from "@scaffold-ui/components";
import { QRCodeSVG } from "qrcode.react";
import { useAccount, useWriteContract } from "wagmi";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { usePasskeyWallet } from "~~/contexts/PasskeyWalletContext";
import { ERC20_ABI } from "~~/contracts/externalContracts";

const USDC_DECIMALS = 6;

type DepositContentProps = {
  walletAddress: string;
};

export const DepositContent = ({ walletAddress }: DepositContentProps) => {
  const { usdcAddress } = usePasskeyWallet();
  const { address: connectedAddress, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();

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

  return (
    <div className="space-y-6">
      {/* Success Message */}
      {depositSuccess && (
        <div className="alert alert-success">
          <span>{depositSuccess}</span>
          <button className="btn btn-ghost btn-xs" onClick={() => setDepositSuccess(null)}>
            ✕
          </button>
        </div>
      )}

      {/* QR/Address for deposits */}
      <div className="text-center">
        <p className="text-sm opacity-60 mb-4">Send USDC on Base to this address:</p>

        <div className="flex justify-center mb-4">
          <div className="bg-white p-4 rounded-xl">
            <QRCodeSVG value={walletAddress} size={140} />
          </div>
        </div>

        <div className="bg-base-300 rounded-xl px-6 py-4 mb-4 flex justify-center">
          <Address address={walletAddress as `0x${string}`} format="long" />
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
