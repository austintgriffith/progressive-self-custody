"use client";

import { useRef, useState } from "react";
import { AdvancedModal } from "./AdvancedModal";
import { DepositModal } from "./DepositModal";
import { WithdrawModal } from "./WithdrawModal";
import { getAddress } from "viem";
import {
  ArrowDownTrayIcon,
  ArrowLeftOnRectangleIcon,
  ArrowUpTrayIcon,
  ChevronDownIcon,
  WalletIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { BlockieAvatar } from "~~/components/scaffold-eth";
import { usePasskeyWallet } from "~~/contexts/PasskeyWalletContext";
import { useOutsideClick } from "~~/hooks/scaffold-eth";

export const PasskeyWalletDropdown = () => {
  const { walletAddress, logout } = usePasskeyWallet();
  const checkSumAddress = walletAddress ? getAddress(walletAddress as `0x${string}`) : null;

  const dropdownRef = useRef<HTMLDetailsElement>(null);

  // Modal states
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  const closeDropdown = () => {
    dropdownRef.current?.removeAttribute("open");
  };

  useOutsideClick(dropdownRef, closeDropdown);

  if (!checkSumAddress) return null;

  const displayAddress = `${checkSumAddress.slice(0, 6)}...${checkSumAddress.slice(-4)}`;

  const handleLogout = () => {
    closeDropdown();
    logout();
  };

  return (
    <>
      <details ref={dropdownRef} className="dropdown dropdown-end leading-3">
        <summary className="btn btn-secondary btn-sm pl-0 pr-2 shadow-md dropdown-toggle gap-0 h-auto!">
          <BlockieAvatar address={checkSumAddress} size={30} />
          <span className="ml-2 mr-1">{displayAddress}</span>
          <WalletIcon className="h-4 w-4 ml-1" />
          <ChevronDownIcon className="h-4 w-4" />
        </summary>
        <ul className="dropdown-content menu z-50 p-2 mt-2 shadow-center shadow-accent bg-base-200 rounded-box gap-1 w-44">
          {/* Deposit */}
          <li>
            <button
              className="h-8 btn-sm rounded-xl! flex gap-3 py-3"
              onClick={() => {
                closeDropdown();
                setIsDepositOpen(true);
              }}
            >
              <ArrowDownTrayIcon className="h-5 w-5" />
              <span className="whitespace-nowrap">Deposit</span>
            </button>
          </li>

          {/* Withdraw */}
          <li>
            <button
              className="h-8 btn-sm rounded-xl! flex gap-3 py-3"
              onClick={() => {
                closeDropdown();
                setIsWithdrawOpen(true);
              }}
            >
              <ArrowUpTrayIcon className="h-5 w-5" />
              <span className="whitespace-nowrap">Withdraw</span>
            </button>
          </li>

          {/* Advanced */}
          <li>
            <button
              className="h-8 btn-sm rounded-xl! flex gap-3 py-3"
              onClick={() => {
                closeDropdown();
                setIsAdvancedOpen(true);
              }}
            >
              <WrenchScrewdriverIcon className="h-5 w-5" />
              <span className="whitespace-nowrap">Advanced</span>
            </button>
          </li>

          {/* Divider */}
          <li className="my-1">
            <div className="h-px bg-base-300 mx-2"></div>
          </li>

          {/* Logout */}
          <li>
            <button
              className="h-8 btn-sm rounded-xl! flex gap-3 py-3 text-error hover:bg-error/10"
              onClick={handleLogout}
            >
              <ArrowLeftOnRectangleIcon className="h-5 w-5" />
              <span className="whitespace-nowrap">Logout</span>
            </button>
          </li>
        </ul>
      </details>

      {/* Modals */}
      <DepositModal isOpen={isDepositOpen} onClose={() => setIsDepositOpen(false)} />
      <WithdrawModal isOpen={isWithdrawOpen} onClose={() => setIsWithdrawOpen(false)} />
      <AdvancedModal isOpen={isAdvancedOpen} onClose={() => setIsAdvancedOpen(false)} />
    </>
  );
};
