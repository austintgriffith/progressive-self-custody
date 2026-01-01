import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, foundry } from "viem/chains";
import { SMART_WALLET_ABI } from "~~/contracts/SmartWalletAbi";

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
  isBatch: boolean;
  calls: Call[];
  qx: `0x${string}`;
  qy: `0x${string}`;
  deadline: string;
  auth: WebAuthnAuth;
}

// Get chain config based on chainId
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
    const body: FacilitateRequest = await request.json();
    const { smartWalletAddress, chainId, isBatch, calls, qx, qy, deadline, auth } = body;

    // Validate required fields
    if (!smartWalletAddress || !chainId || !calls || !qx || !qy || !deadline || !auth) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    // Get facilitator private key from environment
    const facilitatorPrivateKey = process.env.FACILITATOR_PRIVATE_KEY;
    if (!facilitatorPrivateKey) {
      return NextResponse.json({ success: false, error: "Facilitator not configured" }, { status: 500 });
    }

    // Setup chain and clients
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

    // Convert auth to contract format
    const authForContract = {
      authenticatorData: auth.authenticatorData,
      clientDataJSON: auth.clientDataJSON,
      challengeIndex: BigInt(auth.challengeIndex),
      typeIndex: BigInt(auth.typeIndex),
      r: auth.r,
      s: auth.s,
    };

    let txHash: `0x${string}`;

    if (isBatch && calls.length > 1) {
      // Batch execution
      const callsForContract = calls.map(c => ({
        target: c.target,
        value: BigInt(c.value),
        data: c.data,
      }));

      const { request: txRequest } = await publicClient.simulateContract({
        address: smartWalletAddress,
        abi: SMART_WALLET_ABI,
        functionName: "metaBatchExecPasskey",
        args: [callsForContract, qx, qy, BigInt(deadline), authForContract],
        account,
      });

      txHash = await walletClient.writeContract(txRequest);
    } else {
      // Single execution
      const call = calls[0];

      const { request: txRequest } = await publicClient.simulateContract({
        address: smartWalletAddress,
        abi: SMART_WALLET_ABI,
        functionName: "metaExecPasskey",
        args: [call.target, BigInt(call.value), call.data, qx, qy, BigInt(deadline), authForContract],
        account,
      });

      txHash = await walletClient.writeContract(txRequest);
    }

    // Wait for transaction receipt
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    return NextResponse.json({
      success: true,
      txHash,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
    });
  } catch (error) {
    console.error("[Facilitate API] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
