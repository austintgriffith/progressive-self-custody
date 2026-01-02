"use client";

import { DepositContent } from "./DepositContent";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { usePasskeyWallet } from "~~/contexts/PasskeyWalletContext";

type DepositModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export const DepositModal = ({ isOpen, onClose }: DepositModalProps) => {
  const { walletAddress } = usePasskeyWallet();

  if (!isOpen || !walletAddress) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-base-100 rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-bold text-xl">Deposit USDC</h3>
          <button className="btn btn-ghost btn-sm btn-circle" onClick={onClose}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <DepositContent walletAddress={walletAddress} />
      </div>
    </div>
  );
};
