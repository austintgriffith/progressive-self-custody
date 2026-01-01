import { NextRequest, NextResponse } from "next/server";
import { concat, createPublicClient, createWalletClient, http, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, foundry } from "viem/chains";
import { SMART_WALLET_ABI } from "~~/contracts/SmartWalletAbi";

interface TriggerRecoveryRequest {
  chainId: number;
  smartWalletAddress: `0x${string}`;
  password: string;
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
    const body: TriggerRecoveryRequest = await request.json();
    const { chainId, smartWalletAddress, password } = body;

    // Validate required fields
    if (!chainId || !smartWalletAddress || !password) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    // Get facilitator private key (facilitator acts as guardian)
    const facilitatorPrivateKey = process.env.FACILITATOR_PRIVATE_KEY;
    if (!facilitatorPrivateKey) {
      return NextResponse.json({ success: false, error: "Guardian not configured" }, { status: 500 });
    }

    const { chain, rpcUrl } = getChainConfig(chainId);
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

    // Verify the caller is the guardian
    const guardian = (await publicClient.readContract({
      address: smartWalletAddress,
      abi: SMART_WALLET_ABI,
      functionName: "guardian",
    })) as `0x${string}`;

    if (guardian.toLowerCase() !== account.address.toLowerCase()) {
      return NextResponse.json({ success: false, error: "Not authorized as guardian" }, { status: 403 });
    }

    // Verify password hash matches on-chain
    const onChainHash = (await publicClient.readContract({
      address: smartWalletAddress,
      abi: SMART_WALLET_ABI,
      functionName: "recoveryPasswordHash",
    })) as `0x${string}`;

    // Compute expected hash: keccak256(abi.encodePacked(walletAddress, password))
    const computedHash = keccak256(concat([smartWalletAddress, toHex(password)]));

    if (onChainHash !== computedHash) {
      return NextResponse.json({ success: false, error: "Invalid password" }, { status: 401 });
    }

    // Check if withdraw address is set
    const withdrawAddress = (await publicClient.readContract({
      address: smartWalletAddress,
      abi: SMART_WALLET_ABI,
      functionName: "withdrawAddress",
    })) as `0x${string}`;

    if (!withdrawAddress || withdrawAddress === "0x0000000000000000000000000000000000000000") {
      return NextResponse.json({ success: false, error: "No withdraw address set" }, { status: 400 });
    }

    // Check if deadman already triggered
    const deadmanTriggeredAt = (await publicClient.readContract({
      address: smartWalletAddress,
      abi: SMART_WALLET_ABI,
      functionName: "deadmanTriggeredAt",
    })) as bigint;

    if (deadmanTriggeredAt > 0n) {
      return NextResponse.json({ success: false, error: "Recovery already triggered" }, { status: 400 });
    }

    // Trigger the deadman switch
    const { request: txRequest } = await publicClient.simulateContract({
      address: smartWalletAddress,
      abi: SMART_WALLET_ABI,
      functionName: "triggerDeadmanWithPassword",
      args: [password],
      account,
    });

    const txHash = await walletClient.writeContract(txRequest);
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    // Get the delay
    const deadmanDelay = (await publicClient.readContract({
      address: smartWalletAddress,
      abi: SMART_WALLET_ABI,
      functionName: "deadmanDelay",
    })) as bigint;

    const executionTime = Math.floor(Date.now() / 1000) + Number(deadmanDelay);

    return NextResponse.json({
      success: true,
      txHash,
      executionTime,
      delaySeconds: Number(deadmanDelay),
      withdrawAddress,
      message: `Recovery triggered. Funds can be recovered after ${new Date(executionTime * 1000).toISOString()}`,
    });
  } catch (error) {
    console.error("[Trigger Recovery API] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
