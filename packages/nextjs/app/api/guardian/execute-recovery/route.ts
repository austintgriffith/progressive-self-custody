import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, foundry } from "viem/chains";
import { ERC20_ABI, SMART_WALLET_ABI } from "~~/contracts/SmartWalletAbi";

// USDC addresses per chain
const USDC_ADDRESSES: Record<number, `0x${string}`> = {
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base mainnet
  31337: "0x5FbDB2315678afecb367f032d93F642f64180aa3", // Local (mock)
};

interface ExecuteRecoveryRequest {
  chainId: number;
  smartWalletAddress: `0x${string}`;
  token?: `0x${string}`; // Optional - defaults to USDC, use 0x0 for ETH
}

// Get chain config
function getChainConfig(chainId: number) {
  switch (chainId) {
    case 8453:
      return {
        chain: base,
        rpcUrl: `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      };
    case 31337:
      return {
        chain: foundry,
        rpcUrl: "http://127.0.0.1:8545",
      };
    default:
      throw new Error(`Unsupported chain: ${chainId}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: ExecuteRecoveryRequest = await request.json();
    const { chainId, smartWalletAddress, token } = body;

    // Validate required fields
    if (!chainId || !smartWalletAddress) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    // Get facilitator private key (facilitator acts as guardian)
    const facilitatorPrivateKey = process.env.FACILITATOR_PRIVATE_KEY;
    if (!facilitatorPrivateKey) {
      return NextResponse.json({ success: false, error: "Guardian not configured" }, { status: 500 });
    }

    const { chain, rpcUrl } = getChainConfig(chainId);
    const account = privateKeyToAccount(facilitatorPrivateKey as `0x${string}`);
    const usdcAddress = USDC_ADDRESSES[chainId];

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });

    // Verify the caller is the guardian
    const guardian = (await publicClient.readContract({
      address: smartWalletAddress,
      abi: SMART_WALLET_ABI,
      functionName: "guardian",
    })) as `0x${string}`;

    if (guardian.toLowerCase() !== account.address.toLowerCase()) {
      return NextResponse.json({ success: false, error: "Not authorized as guardian" }, { status: 403 });
    }

    // Check if deadman is triggered and delay has passed
    const [deadmanTriggeredAt, deadmanDelay, withdrawAddress] = await Promise.all([
      publicClient.readContract({
        address: smartWalletAddress,
        abi: SMART_WALLET_ABI,
        functionName: "deadmanTriggeredAt",
      }) as Promise<bigint>,
      publicClient.readContract({
        address: smartWalletAddress,
        abi: SMART_WALLET_ABI,
        functionName: "deadmanDelay",
      }) as Promise<bigint>,
      publicClient.readContract({
        address: smartWalletAddress,
        abi: SMART_WALLET_ABI,
        functionName: "withdrawAddress",
      }) as Promise<`0x${string}`>,
    ]);

    if (deadmanTriggeredAt === 0n) {
      return NextResponse.json({ success: false, error: "Recovery not triggered" }, { status: 400 });
    }

    const executionTime = Number(deadmanTriggeredAt) + Number(deadmanDelay);
    const currentTime = Math.floor(Date.now() / 1000);

    if (currentTime < executionTime) {
      const remaining = executionTime - currentTime;
      return NextResponse.json(
        {
          success: false,
          error: `Delay not passed. ${remaining} seconds remaining.`,
          timeRemaining: remaining,
        },
        { status: 400 },
      );
    }

    if (!withdrawAddress || withdrawAddress === "0x0000000000000000000000000000000000000000") {
      return NextResponse.json({ success: false, error: "No withdraw address set" }, { status: 400 });
    }

    // Determine which token to recover (default to USDC)
    const tokenToRecover = token || usdcAddress;

    // Get balance before recovery
    let balanceBefore: bigint;
    if (tokenToRecover === "0x0000000000000000000000000000000000000000") {
      balanceBefore = await publicClient.getBalance({ address: smartWalletAddress });
    } else {
      balanceBefore = (await publicClient.readContract({
        address: tokenToRecover,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [smartWalletAddress],
      })) as bigint;
    }

    // Execute deadman recovery
    const { request: txRequest } = await publicClient.simulateContract({
      address: smartWalletAddress,
      abi: SMART_WALLET_ABI,
      functionName: "executeDeadman",
      args: [tokenToRecover],
      account,
    });

    const txHash = await walletClient.writeContract(txRequest);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    return NextResponse.json({
      success: true,
      txHash,
      withdrawAddress,
      token: tokenToRecover,
      amountRecovered: balanceBefore.toString(),
      blockNumber: receipt.blockNumber.toString(),
      message: "Funds successfully recovered to withdraw address",
    });
  } catch (error) {
    console.error("[Execute Recovery API] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
