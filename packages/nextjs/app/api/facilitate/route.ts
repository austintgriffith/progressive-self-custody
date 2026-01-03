import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import deployedContracts from "~~/contracts/deployedContracts";

// WebAuthn auth structure
interface WebAuthnAuth {
  authenticatorData: `0x${string}`;
  clientDataJSON: string;
  challengeIndex: string;
  typeIndex: string;
  r: `0x${string}`;
  s: `0x${string}`;
}

interface Call {
  target: `0x${string}`;
  value: string;
  data: `0x${string}`;
}

interface FacilitateRequest {
  smartWalletAddress: `0x${string}`;
  chainId: number;
  functionName: string;
  // For metaBatchExec
  calls?: Call[];
  // For meta settings functions
  params?: {
    withdrawAddress?: `0x${string}`;
    newGuardian?: `0x${string}`;
  };
  deadline: string;
  auth: WebAuthnAuth;
}

// Get chain config based on chainId
function getChainConfig(chainId: number) {
  switch (chainId) {
    case 8453:
      return {
        chain: base,
        rpcUrl: `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`,
      };
    default:
      throw new Error(`Unsupported chain: ${chainId}. Only Base (8453) is supported in production.`);
  }
}

// Get ABI from auto-generated deployedContracts
function getSmartWalletAbi(chainId: number) {
  const contracts = deployedContracts[chainId as keyof typeof deployedContracts];
  return contracts?.SmartWallet?.abi;
}

// Get Example contract ABI for parsing DiceRoll events
function getExampleAbi(chainId: number) {
  const contracts = deployedContracts[chainId as keyof typeof deployedContracts];
  return contracts?.Example?.abi;
}

// Get Example contract address
function getExampleAddress(chainId: number) {
  const contracts = deployedContracts[chainId as keyof typeof deployedContracts];
  return contracts?.Example?.address;
}

export async function POST(request: NextRequest) {
  try {
    const body: FacilitateRequest = await request.json();
    const { smartWalletAddress, chainId, functionName, calls, params, deadline, auth } = body;

    console.log("[Facilitate API]", functionName, "for", smartWalletAddress.slice(0, 10) + "...");

    // Validate required fields
    if (!smartWalletAddress || !chainId || !functionName || !deadline || !auth) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    // Get facilitator private key from environment
    const facilitatorPrivateKey = process.env.FACILITATOR_PRIVATE_KEY;
    if (!facilitatorPrivateKey) {
      return NextResponse.json({ success: false, error: "Facilitator not configured" }, { status: 500 });
    }

    // Setup chain and clients
    const { chain, rpcUrl } = getChainConfig(chainId);
    const SMART_WALLET_ABI = getSmartWalletAbi(chainId);
    if (!SMART_WALLET_ABI) {
      return NextResponse.json({ success: false, error: "SmartWallet ABI not found for chain" }, { status: 500 });
    }
    const account = privateKeyToAccount(facilitatorPrivateKey as `0x${string}`);

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });

    // Check facilitator ETH balance FIRST - this is critical!
    const facilitatorBalance = await publicClient.getBalance({ address: account.address });
    const MIN_FACILITATOR_BALANCE = 10000000000000000n; // 0.01 ETH

    if (facilitatorBalance < MIN_FACILITATOR_BALANCE) {
      console.error("[Facilitate API] FACILITATOR LOW ON GAS!", {
        address: account.address,
        balance: facilitatorBalance.toString(),
        balanceEth: Number(facilitatorBalance) / 1e18,
      });
      return NextResponse.json(
        {
          success: false,
          error: `Facilitator is low on gas (${(Number(facilitatorBalance) / 1e18).toFixed(4)} ETH). Please fund ${account.address} with ETH.`,
          facilitatorAddress: account.address,
          facilitatorBalance: facilitatorBalance.toString(),
        },
        { status: 503 },
      );
    }

    // Convert auth to contract format (order matches WebAuthn.WebAuthnAuth struct)
    const authForContract = {
      authenticatorData: auth.authenticatorData,
      clientDataJSON: auth.clientDataJSON,
      challengeIndex: BigInt(auth.challengeIndex),
      typeIndex: BigInt(auth.typeIndex),
      r: auth.r,
      s: auth.s,
    };

    let txHash: `0x${string}`;

    switch (functionName) {
      case "metaBatchExec": {
        if (!calls || calls.length === 0) {
          return NextResponse.json({ success: false, error: "Missing calls for metaBatchExec" }, { status: 400 });
        }

        const callsForContract = calls.map(c => ({
          target: c.target,
          value: BigInt(c.value),
          data: c.data,
        }));

        const { request: txRequest } = await publicClient.simulateContract({
          address: smartWalletAddress,
          abi: SMART_WALLET_ABI,
          functionName: "metaBatchExec",
          args: [callsForContract, BigInt(deadline), authForContract],
          account,
        });

        txHash = await walletClient.writeContract(txRequest);
        break;
      }

      case "metaSetWithdrawAddress": {
        if (!params?.withdrawAddress) {
          return NextResponse.json(
            { success: false, error: "Missing withdrawAddress for metaSetWithdrawAddress" },
            { status: 400 },
          );
        }

        const { request: txRequest } = await publicClient.simulateContract({
          address: smartWalletAddress,
          abi: SMART_WALLET_ABI,
          functionName: "metaSetWithdrawAddress",
          args: [params.withdrawAddress, BigInt(deadline), authForContract],
          account,
        });

        txHash = await walletClient.writeContract(txRequest);
        break;
      }

      case "metaSetGuardian": {
        if (!params?.newGuardian) {
          return NextResponse.json(
            { success: false, error: "Missing newGuardian for metaSetGuardian" },
            { status: 400 },
          );
        }

        const { request: txRequest } = await publicClient.simulateContract({
          address: smartWalletAddress,
          abi: SMART_WALLET_ABI,
          functionName: "metaSetGuardian",
          args: [params.newGuardian, BigInt(deadline), authForContract],
          account,
        });

        txHash = await walletClient.writeContract(txRequest);
        break;
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown function: ${functionName}` }, { status: 400 });
    }

    // Wait for transaction receipt
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    // Read dice roll result directly from the contract state (bulletproof!)
    let diceRollResult: { won: boolean; payout: string } | undefined;
    const exampleAbi = getExampleAbi(chainId);
    const exampleAddress = getExampleAddress(chainId);

    if (exampleAbi && exampleAddress) {
      try {
        const result = await publicClient.readContract({
          address: exampleAddress as `0x${string}`,
          abi: exampleAbi,
          functionName: "lastRollResult",
          args: [smartWalletAddress],
        });
        // Result is [won: boolean, payout: bigint, timestamp: bigint]
        const [won, payout] = result as [boolean, bigint, bigint];
        diceRollResult = {
          won,
          payout: payout.toString(),
        };
      } catch (e) {
        console.error("[Facilitate API] Failed to read lastRollResult:", e);
      }
    }

    return NextResponse.json({
      success: true,
      txHash,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      diceRollResult,
    });
  } catch (error) {
    console.error("[Facilitate API] Error:", error);

    // Try to extract a more meaningful error message
    let errorMessage = "Unknown error";
    if (error instanceof Error) {
      errorMessage = error.message;

      // Check for common revert reasons and provide helpful messages
      if (errorMessage.includes("Insufficient funds for gas")) {
        errorMessage = "Facilitator is out of gas! Please fund the facilitator address with ETH.";
      } else if (errorMessage.includes("InvalidSignature")) {
        errorMessage = "InvalidSignature: Passkey signature verification failed. Try refreshing the page.";
      } else if (errorMessage.includes("ExpiredSignature")) {
        errorMessage = "ExpiredSignature: The signature deadline has passed. Please try again.";
      } else if (errorMessage.includes("ExecutionFailed")) {
        errorMessage = "ExecutionFailed: One of the batched calls failed. Check your USDC balance.";
      } else if (errorMessage.includes("reverted")) {
        errorMessage = `Transaction reverted: ${errorMessage.slice(0, 200)}`;
      }
    }

    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
