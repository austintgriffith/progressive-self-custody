"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Address, AddressInput } from "@scaffold-ui/components";
import { QRCodeSVG } from "qrcode.react";
import { formatUnits, isAddress } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  QrCodeIcon,
  TrashIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import deployedContracts from "~~/contracts/deployedContracts";
import externalContracts, { ERC20_ABI } from "~~/contracts/externalContracts";
import {
  StoredPasskey,
  getCredentialIdHash,
  getPasskeyFromStorage,
  isWebAuthnSupported,
  loginWithPasskey,
  savePasskeyToStorage,
  signWithPasskey,
} from "~~/utils/passkey";

const USDC_DECIMALS = 6;

// Get SmartWallet ABI from auto-generated deployedContracts
function getSmartWalletAbi(chainId: number) {
  const contracts = deployedContracts[chainId as keyof typeof deployedContracts];
  return contracts?.SmartWallet?.abi;
}

// Get USDC address from external contracts
function getUsdcAddress(chainId: number): `0x${string}` {
  const contracts = externalContracts[chainId as keyof typeof externalContracts];
  if (contracts?.USDC?.address) {
    return contracts.USDC.address as `0x${string}`;
  }
  // Fallback to Base USDC (works on Base fork)
  return "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
}

export default function WalletPage() {
  const params = useParams();
  const router = useRouter();
  const walletAddress = params.address as string;
  const publicClient = usePublicClient();
  const { address: connectedAddress, isConnected } = useAccount();

  // Wallet state
  const [usdcBalance, setUsdcBalance] = useState<bigint>(0n);
  const [ethBalance, setEthBalance] = useState<bigint>(0n);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDeployed, setIsDeployed] = useState<boolean | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);

  // Ref to track if deployment has been attempted (prevents multiple attempts)
  const deploymentAttemptedRef = useRef(false);

  // Passkey state
  const [currentPasskey, setCurrentPasskey] = useState<StoredPasskey | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Transaction state
  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw" | "advanced">("deposit");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Settings state
  const [withdrawAddress, setWithdrawAddressState] = useState<string | null>(null);
  const [newWithdrawAddress, setNewWithdrawAddress] = useState("");

  // QR Scanner state
  const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);
  const qrScannerRef = useRef<any>(null);
  const scannerContainerRef = useRef<HTMLDivElement>(null);

  // Advanced state
  const [walletGuardian, setWalletGuardian] = useState<string | null>(null);
  const [advancedSuccess, setAdvancedSuccess] = useState<string | null>(null);
  const [isSettingGuardian, setIsSettingGuardian] = useState(false);

  // Guardian recovery state
  const [guardianRecoverError, setGuardianRecoverError] = useState<string | null>(null);
  const [guardianRecoverSuccess, setGuardianRecoverSuccess] = useState<string | null>(null);

  // Deposit from connected wallet state
  const [depositAmount, setDepositAmount] = useState("");
  const [connectedUsdcBalance, setConnectedUsdcBalance] = useState<bigint>(0n);
  const [isDepositing, setIsDepositing] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [depositSuccess, setDepositSuccess] = useState<string | null>(null);

  const [storedPasskeys, setStoredPasskeys] = useState<
    Array<{
      key: string;
      walletAddress: string;
      data: {
        credentialId?: string;
        qx?: string;
        qy?: string;
        passkeyAddress?: string;
        credentialIdHash?: string;
      } | null;
    }>
  >([]);
  const [pendingWallet, setPendingWallet] = useState<string | null>(null);

  // Chain ID (default to local for now)
  const chainId = 31337;
  const usdcAddress = getUsdcAddress(chainId);
  const SMART_WALLET_ABI = getSmartWalletAbi(chainId);

  // Validate address
  const isValidAddress = walletAddress && isAddress(walletAddress);

  // Guardian recovery write hook
  const { writeContractAsync: guardianRecoverWrite, isPending: isGuardianRecovering } = useWriteContract();

  // Deposit from connected wallet write hook
  const { writeContractAsync: depositUsdcWrite } = useWriteContract();

  // Fetch connected wallet's USDC balance
  useEffect(() => {
    if (!isConnected || !connectedAddress || !publicClient) {
      setConnectedUsdcBalance(0n);
      return;
    }

    const fetchConnectedBalance = async () => {
      try {
        const balance = await publicClient.readContract({
          address: usdcAddress,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [connectedAddress],
        });
        setConnectedUsdcBalance(balance as bigint);
      } catch (err) {
        console.error("Error fetching connected wallet USDC balance:", err);
      }
    };

    fetchConnectedBalance();
    const interval = setInterval(fetchConnectedBalance, 10000);
    return () => clearInterval(interval);
  }, [isConnected, connectedAddress, publicClient, usdcAddress]);

  // Load passkey from storage on mount
  useEffect(() => {
    if (isValidAddress && typeof window !== "undefined") {
      console.log("[WalletPage] Loading passkey for:", walletAddress);
      const stored = getPasskeyFromStorage(walletAddress);
      console.log("[WalletPage] Stored passkey:", stored);
      if (stored) {
        setCurrentPasskey(stored);
      } else {
        console.log("[WalletPage] No passkey found in storage");
      }
    }
  }, [walletAddress, isValidAddress]);

  // Fetch wallet data
  useEffect(() => {
    if (!isValidAddress || !publicClient) return;

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Check if wallet contract is deployed
        const code = await publicClient.getBytecode({ address: walletAddress as `0x${string}` });
        const deployed = code !== undefined && code !== "0x";
        setIsDeployed(deployed);

        // Always fetch balances (works even if contract not deployed)
        const usdcBal = await publicClient.readContract({
          address: usdcAddress,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [walletAddress as `0x${string}`],
        });
        setUsdcBalance(usdcBal as bigint);

        const ethBal = await publicClient.getBalance({
          address: walletAddress as `0x${string}`,
        });
        setEthBalance(ethBal);

        // Only read contract state if deployed
        if (deployed) {
          // Fetch withdraw address
          const withdrawAddr = await publicClient.readContract({
            address: walletAddress as `0x${string}`,
            abi: SMART_WALLET_ABI,
            functionName: "withdrawAddress",
          });
          if (withdrawAddr && withdrawAddr !== "0x0000000000000000000000000000000000000000") {
            setWithdrawAddressState(withdrawAddr as string);
          }

          // Fetch guardian for advanced tab
          const guardian = await publicClient.readContract({
            address: walletAddress as `0x${string}`,
            abi: SMART_WALLET_ABI,
            functionName: "guardian",
          });
          setWalletGuardian(guardian as string);
        }
      } catch (err) {
        console.error("Error fetching wallet data:", err);
        setError("Failed to load wallet data");
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
    // Refresh every 5 seconds (faster polling for pending wallets)
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [walletAddress, isValidAddress, publicClient, usdcAddress, SMART_WALLET_ABI]);

  // Auto-deploy wallet when funded but not deployed
  useEffect(() => {
    console.log("[WalletPage] Auto-deploy check:", {
      isDeployed,
      usdcBalance: usdcBalance.toString(),
      hasPasskey: !!currentPasskey,
      isDeploying,
      deploymentAttempted: deploymentAttemptedRef.current,
    });

    // Use ref to prevent multiple deployment attempts (state changes can cause re-runs)
    if (isDeployed === false && usdcBalance > 0n && currentPasskey && !isDeploying && !deploymentAttemptedRef.current) {
      // Mark deployment as attempted immediately to prevent race conditions
      deploymentAttemptedRef.current = true;
      console.log("[WalletPage] Starting deployment...");

      const deployWallet = async () => {
        setIsDeploying(true);
        setError(null);

        try {
          // Get credentialIdHash from storage
          const storedData = localStorage.getItem(`psc-passkey-${walletAddress.toLowerCase()}`);
          const parsed = storedData ? JSON.parse(storedData) : null;
          const credentialIdHash = parsed?.credentialIdHash;

          console.log("[WalletPage] Deploy params:", {
            chainId,
            qx: currentPasskey.qx,
            qy: currentPasskey.qy,
            credentialIdHash,
          });

          if (!credentialIdHash) {
            throw new Error("Missing credential ID hash");
          }

          const response = await fetch("/api/deploy-wallet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chainId,
              qx: currentPasskey.qx,
              qy: currentPasskey.qy,
              credentialIdHash,
            }),
          });

          const data = await response.json();
          console.log("[WalletPage] Deploy response:", data);

          if (data.success) {
            // Wallet deployed! Optimistically set isDeployed to true
            // to prevent UI flashing while waiting for next poll
            console.log("[WalletPage] Wallet deployed:", data);
            setIsDeployed(true);
          } else {
            throw new Error(data.error || "Deployment failed");
          }
        } catch (err) {
          console.error("[WalletPage] Deployment error:", err);
          setError(err instanceof Error ? err.message : "Failed to deploy wallet");
          // Don't reset deploymentAttemptedRef - just show the error
        } finally {
          setIsDeploying(false);
        }
      };

      deployWallet();
    }
  }, [isDeployed, usdcBalance, currentPasskey, isDeploying, walletAddress, chainId]);

  // Login with passkey
  const handleLoginWithPasskey = async () => {
    if (!isWebAuthnSupported()) {
      setError("WebAuthn is not supported in this browser");
      return;
    }

    setIsLoggingIn(true);
    setError(null);

    try {
      const result = await loginWithPasskey();
      const stored: StoredPasskey = {
        credentialId: result.credentialId,
        qx: result.qx,
        qy: result.qy,
        passkeyAddress: result.passkeyAddress,
      };
      savePasskeyToStorage(walletAddress, stored);
      setCurrentPasskey(stored);

      // Also store the credentialIdHash for deployment/recovery purposes
      const passkeyData = {
        credentialId: result.credentialId,
        qx: result.qx,
        qy: result.qy,
        passkeyAddress: result.passkeyAddress,
        credentialIdHash: getCredentialIdHash(result.credentialId),
      };
      localStorage.setItem(`psc-passkey-${walletAddress.toLowerCase()}`, JSON.stringify(passkeyData));
    } catch (err) {
      console.error("Login error:", err);
      setError(err instanceof Error ? err.message : "Failed to login");
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Sign and submit transaction
  const signAndSubmit = async (action: string, params: Record<string, string>) => {
    if (!currentPasskey) {
      setError("Please login with your passkey first");
      return;
    }

    setIsProcessing(true);
    setTxStatus("Preparing transaction...");
    setTxHash(null);
    setError(null);

    try {
      // Get prepared transaction from API
      const prepareRes = await fetch("/api/prepare-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId,
          wallet: walletAddress,
          action,
          params,
        }),
      });

      const prepareData = await prepareRes.json();
      if (!prepareData.success) {
        throw new Error(prepareData.error || "Failed to prepare transaction");
      }

      setTxStatus("Please sign with your passkey...");

      // Build challenge bytes
      const challengeBytes = new Uint8Array(
        (prepareData.challengeHash.slice(2).match(/.{2}/g) || []).map((byte: string) => parseInt(byte, 16)),
      );

      // Sign with passkey
      const { auth } = await signWithPasskey(currentPasskey.credentialId, challengeBytes);

      setTxStatus("Submitting transaction...");

      // Submit to facilitator with new format
      const facilitateRes = await fetch("/api/facilitate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smartWalletAddress: walletAddress,
          chainId,
          functionName: prepareData.functionName,
          calls: prepareData.calls,
          params: prepareData.params,
          deadline: prepareData.deadline,
          auth: {
            authenticatorData: auth.authenticatorData,
            clientDataJSON: auth.clientDataJSON,
            challengeIndex: auth.challengeIndex.toString(),
            typeIndex: auth.typeIndex.toString(),
            r: auth.r,
            s: auth.s,
          },
        }),
      });

      const facilitateData = await facilitateRes.json();

      if (facilitateData.success && facilitateData.txHash) {
        setTxHash(facilitateData.txHash);
        setTxStatus("Transaction confirmed!");
        return facilitateData.txHash;
      } else {
        throw new Error(facilitateData.error || "Transaction failed");
      }
    } catch (err) {
      console.error("Transaction error:", err);
      setError(err instanceof Error ? err.message : "Transaction failed");
      setTxStatus(null);
      throw err;
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle withdraw
  const handleWithdraw = async () => {
    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    if (!withdrawAddress) {
      setError("Please set a withdraw address first");
      return;
    }

    try {
      const amountInUnits = BigInt(Math.floor(parseFloat(withdrawAmount) * 10 ** USDC_DECIMALS));
      await signAndSubmit("withdraw", {
        amount: amountInUnits.toString(),
        asset: "USDC",
      });
      setWithdrawAmount("");
    } catch {
      // Error already handled in signAndSubmit
    }
  };

  // Handle pay (to Example contract)
  const handlePay = async () => {
    if (!payAmount || parseFloat(payAmount) <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    // Get Example contract address from deployed contracts
    const chainContracts = deployedContracts[chainId as keyof typeof deployedContracts];
    if (!chainContracts?.Example?.address) {
      setError("Example contract not deployed on this chain");
      return;
    }
    const exampleContractAddress = chainContracts.Example.address;

    try {
      const amountInUnits = BigInt(Math.floor(parseFloat(payAmount) * 10 ** USDC_DECIMALS));
      await signAndSubmit("payUSDC", {
        amount: amountInUnits.toString(),
        exampleContract: exampleContractAddress,
      });
      setPayAmount("");
    } catch {
      // Error already handled
    }
  };

  // Handle set withdraw address
  const handleSetWithdrawAddress = async () => {
    if (!newWithdrawAddress || !isAddress(newWithdrawAddress)) {
      setError("Please enter a valid address");
      return;
    }

    try {
      await signAndSubmit("setWithdrawAddress", {
        address: newWithdrawAddress,
      });
      setWithdrawAddressState(newWithdrawAddress);
      setNewWithdrawAddress("");
    } catch {
      // Error already handled
    }
  };

  // QR Scanner functions
  const stopQrScanner = () => {
    if (qrScannerRef.current) {
      qrScannerRef.current
        .stop()
        .then(() => {
          qrScannerRef.current = null;
        })
        .catch(console.error);
    }
    setIsQrScannerOpen(false);
  };

  // Start scanner when modal opens
  useEffect(() => {
    if (!isQrScannerOpen) return;

    let html5Qrcode: any = null;
    let isMounted = true;

    const startScanner = async () => {
      if (!scannerContainerRef.current) return;

      try {
        // Dynamic import for browser-only library
        const { Html5Qrcode } = await import("html5-qrcode");

        if (!isMounted) return;

        html5Qrcode = new Html5Qrcode("qr-reader");
        qrScannerRef.current = html5Qrcode;

        await html5Qrcode.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
          },
          (decodedText: string) => {
            // Check if it's a valid Ethereum address
            const addressMatch = decodedText.match(/0x[a-fA-F0-9]{40}/);
            if (addressMatch) {
              setNewWithdrawAddress(addressMatch[0]);
              setIsQrScannerOpen(false);
              // Stop scanner after successful scan
              if (html5Qrcode) {
                html5Qrcode.stop().catch(console.error);
              }
            }
          },
          () => {
            // QR code scan error - ignore silently
          },
        );
      } catch (err) {
        console.error("Failed to start QR scanner:", err);
        if (isMounted) {
          setError("Failed to access camera. Please check permissions.");
          setIsQrScannerOpen(false);
        }
      }
    };

    // Small delay to ensure the container is rendered
    const timer = setTimeout(startScanner, 100);

    return () => {
      isMounted = false;
      clearTimeout(timer);
      if (html5Qrcode) {
        html5Qrcode.stop().catch(console.error);
      }
    };
  }, [isQrScannerOpen]);

  // Cleanup scanner on unmount
  useEffect(() => {
    return () => {
      if (qrScannerRef.current) {
        qrScannerRef.current.stop().catch(console.error);
      }
    };
  }, []);

  // Advanced: Load stored passkeys from localStorage
  const loadStoredPasskeys = () => {
    if (typeof window === "undefined") return;

    const passkeys: Array<{
      key: string;
      walletAddress: string;
      data: {
        credentialId?: string;
        qx?: string;
        qy?: string;
        passkeyAddress?: string;
        credentialIdHash?: string;
      } | null;
    }> = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("psc-passkey-")) {
        const walletAddr = key.replace("psc-passkey-", "");
        let data = null;
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            data = JSON.parse(raw);
          }
        } catch {
          // Invalid JSON
        }
        passkeys.push({ key, walletAddress: walletAddr, data });
      }
    }
    setStoredPasskeys(passkeys);
    setPendingWallet(localStorage.getItem("psc-pending-wallet"));
  };

  // Advanced: Load passkeys on mount
  useEffect(() => {
    loadStoredPasskeys();
  }, []);

  // Advanced: Clear all passkey data
  const clearAllPasskeyData = () => {
    if (typeof window === "undefined") return;

    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith("psc-passkey-") || key === "psc-pending-wallet")) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));

    setStoredPasskeys([]);
    setPendingWallet(null);
    setAdvancedSuccess("Passkey data cleared from localStorage!");
  };

  // Advanced: Clear specific passkey
  const clearSpecificPasskey = (key: string) => {
    if (typeof window === "undefined") return;
    localStorage.removeItem(key);
    loadStoredPasskeys();
    setAdvancedSuccess(`Removed ${key}`);
  };

  // Deposit USDC from connected wallet to smart wallet
  const handleDeposit = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0) {
      setDepositError("Please enter a valid amount");
      return;
    }

    setIsDepositing(true);
    setDepositError(null);
    setDepositSuccess(null);

    try {
      const amountInUnits = BigInt(Math.floor(parseFloat(depositAmount) * 10 ** USDC_DECIMALS));

      await depositUsdcWrite({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [walletAddress as `0x${string}`, amountInUnits],
      });

      setDepositSuccess(`Successfully deposited $${depositAmount} USDC!`);
      setDepositAmount("");

      // Scroll to top after successful deposit
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      console.error("Deposit error:", err);
      setDepositError(err instanceof Error ? err.message : "Failed to deposit");
    } finally {
      setIsDepositing(false);
    }
  };

  // Advanced: Guardian recovery - send all USDC to withdraw address
  const handleGuardianRecover = async () => {
    if (!SMART_WALLET_ABI) return;

    setGuardianRecoverError(null);
    setGuardianRecoverSuccess(null);

    try {
      await guardianRecoverWrite({
        address: walletAddress as `0x${string}`,
        abi: SMART_WALLET_ABI,
        functionName: "guardianRecover",
        args: [usdcAddress],
      });
      setGuardianRecoverSuccess("Recovery successful! Funds have been sent to the withdraw address.");
    } catch (err) {
      console.error("Guardian recover error:", err);
      setGuardianRecoverError(err instanceof Error ? err.message : "Failed to execute recovery");
    }
  };

  // Advanced: Set connected wallet as guardian
  const handleSetGuardian = async () => {
    if (!connectedAddress) {
      setError("Please connect a wallet first");
      return;
    }

    setIsSettingGuardian(true);
    setError(null);
    setAdvancedSuccess(null);

    try {
      await signAndSubmit("setGuardian", {
        address: connectedAddress,
      });
      setWalletGuardian(connectedAddress);
      setAdvancedSuccess("Guardian updated successfully!");
    } catch {
      // Error already handled in signAndSubmit
    } finally {
      setIsSettingGuardian(false);
    }
  };

  if (!isValidAddress) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Invalid Wallet Address</h1>
          <button className="btn btn-primary" onClick={() => router.push("/")}>
            Go Home
          </button>
        </div>
      </div>
    );
  }

  // Show pending/funding UI when wallet not deployed yet
  if (isDeployed === false) {
    return (
      <div className="min-h-screen bg-base-100">
        {/* Header */}
        <div className="border-b border-base-300 px-4 py-4">
          <div className="max-w-2xl mx-auto flex justify-between items-center">
            <button className="btn btn-ghost btn-sm" onClick={() => router.push("/")}>
              ← Back
            </button>
            <Address address={walletAddress as `0x${string}`} size="sm" onlyEnsOrAddress />
          </div>
        </div>

        <div className="max-w-2xl mx-auto px-4 py-8">
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
                <p className="text-lg font-semibold text-primary mb-2">Send USDC on Base</p>
                <p className="opacity-60 mb-6">Once funds arrive, your wallet will be automatically deployed.</p>

                {/* QR Code */}
                <div className="flex justify-center mb-4">
                  <div className="bg-white p-4 rounded-xl">
                    <QRCodeSVG value={walletAddress} size={180} />
                  </div>
                </div>

                {/* Address */}
                <div className="bg-base-300 rounded-lg p-3 mb-4 flex justify-center">
                  <Address address={walletAddress as `0x${string}`} format="long" />
                </div>

                {/* Copy Button */}
                <button
                  className="btn btn-outline btn-sm mb-4"
                  onClick={() => navigator.clipboard.writeText(walletAddress)}
                >
                  Copy Address
                </button>

                {/* Warning */}
                <div className="bg-warning/10 border border-warning rounded-xl p-4 text-left mb-6">
                  <p className="text-sm font-semibold text-warning mb-1">⚠️ Important: Base Network Only</p>
                  <p className="text-xs opacity-80">
                    Only send USDC on the <strong>Base</strong> network. Sending USDC on Ethereum mainnet or any other
                    network will result in lost funds.
                  </p>
                </div>

                <div className="divider">Waiting for deposit</div>

                <div className="flex items-center justify-center gap-2 text-sm opacity-60">
                  <span className="loading loading-ring loading-sm"></span>
                  Checking every 5 seconds...
                </div>
              </>
            )}
          </div>

          {/* Error Display */}
          {error && (
            <div className="alert alert-error mt-6">
              <span>{error}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>
                ✕
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Show loading while checking deployment status
  if (isDeployed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-100">
      {/* Header */}
      <div className="border-b border-base-300 px-4 py-4">
        <div className="max-w-2xl mx-auto flex justify-between items-center">
          <button className="btn btn-ghost btn-sm" onClick={() => router.push("/")}>
            ← Back
          </button>
          <Address address={walletAddress as `0x${string}`} size="sm" onlyEnsOrAddress />
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Passkey Login Prompt */}
        {!currentPasskey && (
          <div className="bg-warning/10 border border-warning rounded-2xl p-6 mb-6">
            <h3 className="font-bold mb-2">Login Required</h3>
            <p className="text-sm opacity-80 mb-4">Sign in with your passkey to access your wallet.</p>
            <button
              className={`btn btn-warning ${isLoggingIn ? "loading" : ""}`}
              onClick={handleLoginWithPasskey}
              disabled={isLoggingIn}
            >
              {isLoggingIn ? "Signing in..." : "Sign in with Passkey"}
            </button>
          </div>
        )}

        {/* Pay USDC - Always Visible */}
        <div className="bg-base-200 rounded-2xl p-6 mb-6">
          <h3 className="font-bold mb-4">Pay USDC</h3>
          <p className="text-sm opacity-60 mb-4">Pay USDC to the example application contract.</p>
          <div className="flex gap-3">
            <input
              type="number"
              placeholder="0.00"
              className="input input-bordered flex-1"
              value={payAmount}
              onChange={e => setPayAmount(e.target.value)}
            />
            <button
              className={`btn btn-primary ${isProcessing ? "loading" : ""}`}
              onClick={handlePay}
              disabled={isProcessing || !currentPasskey}
            >
              {isProcessing ? "..." : "Pay"}
            </button>
          </div>
        </div>

        {/* Balance Card */}
        <div className="bg-gradient-to-br from-primary/20 to-secondary/20 rounded-3xl p-8 mb-6">
          <div className="text-sm opacity-60 mb-2">USDC Balance</div>
          <div className="text-4xl font-bold mb-2">
            {isLoading ? "..." : `$${formatUnits(usdcBalance, USDC_DECIMALS)}`}
          </div>
          <div className="text-sm opacity-60">{formatUnits(ethBalance, 18)} ETH</div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="alert alert-error mb-6">
            <span>{error}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>
              ✕
            </button>
          </div>
        )}

        {/* Transaction Status */}
        {txStatus && (
          <div className="alert alert-info mb-6">
            <span>{txStatus}</span>
            {txHash && <span className="text-xs font-mono ml-2">{txHash.slice(0, 10)}...</span>}
          </div>
        )}

        {/* Tab Navigation */}
        <div className="tabs tabs-boxed mb-6 p-1">
          <button
            className={`tab flex-1 ${activeTab === "deposit" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("deposit")}
          >
            <ArrowDownTrayIcon className="w-4 h-4 mr-2" />
            Deposit
          </button>
          <button
            className={`tab flex-1 ${activeTab === "withdraw" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("withdraw")}
          >
            <ArrowUpTrayIcon className="w-4 h-4 mr-2" />
            Withdraw
          </button>
          <button
            className={`tab flex-1 ${activeTab === "advanced" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("advanced")}
          >
            <WrenchScrewdriverIcon className="w-4 h-4 mr-2" />
            Advanced
          </button>
        </div>

        {/* Tab Content */}
        <div className="bg-base-200 rounded-2xl p-6">
          {activeTab === "deposit" && (
            <div className="space-y-6">
              {/* Deposit Success Message */}
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
                <h3 className="font-bold mb-4">Deposit USDC on Base to this address:</h3>
                <div className="flex justify-center mb-4">
                  <div className="bg-white p-4 rounded-xl">
                    <QRCodeSVG value={walletAddress} size={140} />
                  </div>
                </div>
                <div className="bg-base-300 rounded-lg p-3 mb-4 flex justify-center">
                  <Address address={walletAddress as `0x${string}`} format="long" />
                </div>

                {/* Warning */}
                <div className="bg-warning/10 border border-warning rounded-xl p-4 text-left">
                  <p className="text-sm font-semibold text-warning mb-1">⚠️ Important: Base Network Only</p>
                  <p className="text-xs opacity-80">
                    Only send USDC on the <strong>Base</strong> network. Sending USDC on Ethereum mainnet or any other
                    network will result in lost funds.
                  </p>
                </div>
              </div>

              {/* Deposit from Connected Wallet */}
              <div>
                <div className="flex justify-center mb-4">
                  <RainbowKitCustomConnectButton />
                </div>

                {isConnected && connectedAddress && (
                  <div className="bg-base-300 rounded-xl p-4 space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm opacity-60">Your connected wallet&apos;s USDC Balance:</span>
                      <span className="font-bold">${formatUnits(connectedUsdcBalance, USDC_DECIMALS)}</span>
                    </div>

                    {depositError && (
                      <div className="alert alert-error py-2">
                        <span className="text-sm">{depositError}</span>
                        <button className="btn btn-ghost btn-xs" onClick={() => setDepositError(null)}>
                          ✕
                        </button>
                      </div>
                    )}

                    <div className="form-control">
                      <label className="label">
                        <span className="label-text">Amount (USDC) to Deposit</span>
                        <span className="label-text-alt">Max: ${formatUnits(connectedUsdcBalance, USDC_DECIMALS)}</span>
                      </label>
                      <input
                        type="number"
                        placeholder="0.00"
                        className="input input-bordered"
                        value={depositAmount}
                        onChange={e => setDepositAmount(e.target.value)}
                      />
                    </div>

                    <button
                      className={`btn btn-primary w-full ${isDepositing ? "loading" : ""}`}
                      onClick={handleDeposit}
                      disabled={isDepositing || connectedUsdcBalance === 0n || !depositAmount}
                    >
                      {isDepositing ? "Depositing..." : "Deposit USDC"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "withdraw" && (
            <div className="space-y-6">
              {/* Show withdraw form if address is set, otherwise show address setup */}
              {withdrawAddress ? (
                <>
                  {/* Withdraw Form - Primary UI */}
                  <div>
                    <h3 className="font-bold mb-4">Withdraw USDC</h3>
                    <div className="text-sm opacity-60 mb-4 flex items-center gap-1">
                      <span>Funds will be sent to:</span>
                      <Address address={withdrawAddress as `0x${string}`} size="sm" />
                    </div>
                    <div className="form-control mb-4">
                      <label className="label">
                        <span className="label-text">Amount (USDC)</span>
                        <span className="label-text-alt">Max: ${formatUnits(usdcBalance, USDC_DECIMALS)}</span>
                      </label>
                      <input
                        type="number"
                        placeholder="0.00"
                        className="input input-bordered"
                        value={withdrawAmount}
                        onChange={e => setWithdrawAmount(e.target.value)}
                      />
                    </div>
                    <button
                      className={`btn btn-primary w-full ${isProcessing ? "loading" : ""}`}
                      onClick={handleWithdraw}
                      disabled={isProcessing || !currentPasskey}
                    >
                      {isProcessing ? "Processing..." : "Withdraw"}
                    </button>
                  </div>

                  {/* Edit Withdraw Address - Collapsible */}
                  <div className="collapse collapse-arrow bg-base-300 rounded-xl">
                    <input type="checkbox" />
                    <div className="collapse-title font-medium">Change Withdraw Address</div>
                    <div className="collapse-content">
                      <p className="text-sm opacity-60 mb-4">
                        Enter a new address where you can receive <strong>USDC on Base</strong>.
                      </p>
                      <div className="form-control mb-4">
                        <div className="relative">
                          <AddressInput
                            placeholder="0x... or scan QR"
                            value={newWithdrawAddress}
                            onChange={value => setNewWithdrawAddress(value)}
                          />
                          <button
                            type="button"
                            className="absolute right-12 top-1/2 -translate-y-1/2 btn btn-ghost btn-sm btn-square"
                            onClick={() => setIsQrScannerOpen(true)}
                            title="Scan QR Code"
                          >
                            <QrCodeIcon className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                      <button
                        className={`btn btn-outline w-full ${isProcessing ? "loading" : ""}`}
                        onClick={handleSetWithdrawAddress}
                        disabled={isProcessing || !currentPasskey}
                      >
                        Update Withdraw Address
                      </button>

                      {/* Warning */}
                      <div className="bg-warning/10 border border-warning rounded-xl p-4 mt-4">
                        <p className="text-sm font-semibold text-warning mb-1">⚠️ Important: Base Network Only</p>
                        <p className="text-xs opacity-80">
                          Withdrawals will send <strong>USDC on the Base network</strong>. Make sure the address you
                          enter can receive USDC on Base.
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                /* Initial Setup - No withdraw address set yet */
                <div>
                  <h3 className="font-bold mb-4">Set Withdraw Address</h3>
                  <p className="text-sm opacity-60 mb-4">
                    Enter an address where you can receive <strong>USDC on Base</strong>. This is where your funds will
                    be sent when you withdraw.
                  </p>
                  <div className="form-control mb-4">
                    <div className="relative">
                      <AddressInput
                        placeholder="0x... or scan QR"
                        value={newWithdrawAddress}
                        onChange={value => setNewWithdrawAddress(value)}
                      />
                      <button
                        type="button"
                        className="absolute right-12 top-1/2 -translate-y-1/2 btn btn-ghost btn-sm btn-square"
                        onClick={() => setIsQrScannerOpen(true)}
                        title="Scan QR Code"
                      >
                        <QrCodeIcon className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                  <button
                    className={`btn btn-primary w-full ${isProcessing ? "loading" : ""}`}
                    onClick={handleSetWithdrawAddress}
                    disabled={isProcessing || !currentPasskey}
                  >
                    Set Withdraw Address
                  </button>

                  {/* Warning */}
                  <div className="bg-warning/10 border border-warning rounded-xl p-4 mt-4">
                    <p className="text-sm font-semibold text-warning mb-1">⚠️ Important: Base Network Only</p>
                    <p className="text-xs opacity-80">
                      Withdrawals will send <strong>USDC on the Base network</strong>. Make sure the address you enter
                      can receive USDC on Base. Using an address that cannot receive Base USDC may result in lost funds.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "advanced" && (
            <div className="space-y-6">
              {/* Success Message */}
              {advancedSuccess && (
                <div className="alert alert-success">
                  <span>{advancedSuccess}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setAdvancedSuccess(null)}>
                    ✕
                  </button>
                </div>
              )}

              {/* Wallet Info */}
              <div className="bg-base-300 rounded-xl p-4">
                <div className="flex justify-between items-center">
                  <span className="opacity-60">Guardian</span>
                  <span>
                    {walletGuardian ? <Address address={walletGuardian as `0x${string}`} size="sm" /> : "..."}
                  </span>
                </div>
              </div>

              {/* Set Guardian Section */}
              <div className="bg-base-300 rounded-xl p-4">
                <h4 className="font-bold mb-3">Set Guardian</h4>
                <p className="text-sm opacity-60 mb-4">
                  Connect your wallet to set it as the guardian for this smart wallet.
                </p>

                <div className="flex flex-col gap-3">
                  <RainbowKitCustomConnectButton />

                  {isConnected && connectedAddress && (
                    <div className="bg-base-200 rounded-lg p-3">
                      <div className="text-sm opacity-60 mb-2">Connected Address:</div>
                      <div className="flex items-center justify-between">
                        <Address address={connectedAddress} size="sm" />
                        <button
                          className={`btn btn-primary btn-sm ${isSettingGuardian ? "loading" : ""}`}
                          onClick={handleSetGuardian}
                          disabled={isSettingGuardian || !currentPasskey || connectedAddress === walletGuardian}
                        >
                          {isSettingGuardian
                            ? "Setting..."
                            : connectedAddress === walletGuardian
                              ? "Already Guardian"
                              : "Set as Guardian"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Guardian Recovery Section - Only show when connected as guardian */}
              {isConnected &&
                connectedAddress &&
                walletGuardian &&
                connectedAddress.toLowerCase() === walletGuardian.toLowerCase() && (
                  <div className="bg-warning/10 border border-warning rounded-xl p-4">
                    <h4 className="font-bold mb-3 text-warning">🛡️ Guardian Recovery</h4>
                    <p className="text-sm opacity-80 mb-4">
                      As the guardian, you can recover all USDC to the configured withdraw address.
                    </p>

                    {withdrawAddress ? (
                      <>
                        <div className="bg-base-300 rounded-lg p-3 mb-4">
                          <div className="text-sm opacity-60 mb-1">Funds will be sent to:</div>
                          <Address address={withdrawAddress as `0x${string}`} size="sm" />
                        </div>

                        {guardianRecoverError && (
                          <div className="alert alert-error mb-4">
                            <span className="text-sm">{guardianRecoverError}</span>
                            <button className="btn btn-ghost btn-xs" onClick={() => setGuardianRecoverError(null)}>
                              ✕
                            </button>
                          </div>
                        )}

                        {guardianRecoverSuccess && (
                          <div className="alert alert-success mb-4">
                            <span className="text-sm">{guardianRecoverSuccess}</span>
                            <button className="btn btn-ghost btn-xs" onClick={() => setGuardianRecoverSuccess(null)}>
                              ✕
                            </button>
                          </div>
                        )}

                        <button
                          className={`btn btn-warning w-full ${isGuardianRecovering ? "loading" : ""}`}
                          onClick={handleGuardianRecover}
                          disabled={isGuardianRecovering || usdcBalance === 0n}
                        >
                          {isGuardianRecovering
                            ? "Recovering..."
                            : usdcBalance === 0n
                              ? "No USDC to Recover"
                              : `Recover All USDC ($${formatUnits(usdcBalance, USDC_DECIMALS)})`}
                        </button>
                      </>
                    ) : (
                      <div className="alert alert-warning">
                        <span className="text-sm">
                          No withdraw address set. The wallet owner must set a withdraw address before recovery can be
                          triggered.
                        </span>
                      </div>
                    )}
                  </div>
                )}

              <div className="divider" />

              {/* Clear Passkey Data */}
              <div>
                <h3 className="font-bold mb-4 flex items-center gap-2">
                  <TrashIcon className="w-5 h-5" />
                  Clear Passkey Data
                </h3>
                <p className="text-sm opacity-60 mb-4">Clear passkey data stored in your browser.</p>

                {storedPasskeys.length > 0 || pendingWallet ? (
                  <div className="space-y-3">
                    {pendingWallet && (
                      <div className="bg-base-300 rounded-lg p-3 flex justify-between items-center">
                        <div className="text-sm flex items-center gap-1">
                          <span className="opacity-60">Pending:</span>
                          <Address address={pendingWallet as `0x${string}`} size="sm" />
                        </div>
                        <button
                          className="btn btn-ghost btn-xs text-error"
                          onClick={() => {
                            localStorage.removeItem("psc-pending-wallet");
                            loadStoredPasskeys();
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    )}

                    {storedPasskeys.map(({ key, walletAddress: walletAddr, data }) => (
                      <div key={key} className="bg-base-300 rounded-lg p-4">
                        <div className="flex justify-between items-start mb-3">
                          <div className="text-sm flex items-center gap-1">
                            <span className="opacity-60">Passkey for:</span>
                            <Address address={walletAddr as `0x${string}`} size="sm" />
                          </div>
                          <button className="btn btn-ghost btn-xs text-error" onClick={() => clearSpecificPasskey(key)}>
                            Remove
                          </button>
                        </div>

                        {data ? (
                          <div className="space-y-2 text-sm">
                            {data.qx && (
                              <div>
                                <span className="opacity-60 text-xs">Qx:</span>
                                <div className="font-mono text-xs break-all bg-base-100 p-2 rounded mt-1">
                                  {data.qx}
                                </div>
                              </div>
                            )}
                            {data.qy && (
                              <div>
                                <span className="opacity-60 text-xs">Qy:</span>
                                <div className="font-mono text-xs break-all bg-base-100 p-2 rounded mt-1">
                                  {data.qy}
                                </div>
                              </div>
                            )}
                            {data.credentialId && (
                              <div>
                                <span className="opacity-60 text-xs">Credential ID:</span>
                                <div className="font-mono text-xs break-all bg-base-100 p-2 rounded mt-1">
                                  {data.credentialId}
                                </div>
                              </div>
                            )}
                            {data.credentialIdHash && (
                              <div>
                                <span className="opacity-60 text-xs">Cred ID Hash:</span>
                                <div className="font-mono text-xs break-all bg-base-100 p-2 rounded mt-1">
                                  {data.credentialIdHash}
                                </div>
                              </div>
                            )}
                            {data.passkeyAddress && (
                              <div>
                                <span className="opacity-60 text-xs">Passkey Address:</span>
                                <div className="font-mono text-xs break-all bg-base-100 p-2 rounded mt-1">
                                  {data.passkeyAddress}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-sm text-warning">No passkey data stored (may be corrupted)</div>
                        )}
                      </div>
                    ))}

                    <button className="btn btn-error btn-outline w-full mt-4" onClick={clearAllPasskeyData}>
                      Clear All Passkey Data
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-4 opacity-60 text-sm">No passkey data stored.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* QR Scanner Modal */}
      {isQrScannerOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-base-100 rounded-2xl p-6 max-w-sm w-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg">Scan QR Code</h3>
              <button className="btn btn-ghost btn-sm btn-circle" onClick={stopQrScanner}>
                ✕
              </button>
            </div>
            <div
              id="qr-reader"
              ref={scannerContainerRef}
              className="w-full aspect-square bg-base-300 rounded-xl overflow-hidden"
            />
            <p className="text-sm opacity-60 text-center mt-4">Point your camera at a QR code containing an address</p>
          </div>
        </div>
      )}
    </div>
  );
}
