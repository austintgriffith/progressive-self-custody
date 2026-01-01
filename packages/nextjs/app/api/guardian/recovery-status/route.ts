import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base, foundry } from "viem/chains";
import { SMART_WALLET_ABI } from "~~/contracts/SmartWalletAbi";

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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const chainId = parseInt(searchParams.get("chainId") || "31337");
    const wallet = searchParams.get("wallet") as `0x${string}`;

    if (!wallet) {
      return NextResponse.json({ success: false, error: "Missing wallet address" }, { status: 400 });
    }

    const { chain, rpcUrl } = getChainConfig(chainId);

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    // Get recovery status
    const [deadmanTriggeredAt, deadmanDelay, withdrawAddress, lastActivityTimestamp] = await Promise.all([
      publicClient.readContract({
        address: wallet,
        abi: SMART_WALLET_ABI,
        functionName: "deadmanTriggeredAt",
      }) as Promise<bigint>,
      publicClient.readContract({
        address: wallet,
        abi: SMART_WALLET_ABI,
        functionName: "deadmanDelay",
      }) as Promise<bigint>,
      publicClient.readContract({
        address: wallet,
        abi: SMART_WALLET_ABI,
        functionName: "withdrawAddress",
      }) as Promise<`0x${string}`>,
      publicClient.readContract({
        address: wallet,
        abi: SMART_WALLET_ABI,
        functionName: "lastActivityTimestamp",
      }) as Promise<bigint>,
    ]);

    const isTriggered = deadmanTriggeredAt > 0n;
    const executionTime = isTriggered ? Number(deadmanTriggeredAt) + Number(deadmanDelay) : null;
    const canExecute = isTriggered && executionTime && Math.floor(Date.now() / 1000) >= executionTime;
    const timeRemaining = executionTime ? Math.max(0, executionTime - Math.floor(Date.now() / 1000)) : null;

    // Mask withdraw address for privacy (show first 6 and last 4 chars)
    const maskedWithdrawAddress =
      withdrawAddress && withdrawAddress !== "0x0000000000000000000000000000000000000000"
        ? `${withdrawAddress.slice(0, 6)}...${withdrawAddress.slice(-4)}`
        : null;

    return NextResponse.json({
      success: true,
      triggered: isTriggered,
      triggeredAt: isTriggered ? Number(deadmanTriggeredAt) : null,
      executionTime,
      canExecute,
      timeRemaining,
      delaySeconds: Number(deadmanDelay),
      withdrawAddress: maskedWithdrawAddress,
      lastActivityTimestamp: Number(lastActivityTimestamp),
    });
  } catch (error) {
    console.error("[Recovery Status API] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
