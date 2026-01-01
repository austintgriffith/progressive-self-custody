import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, foundry } from "viem/chains";
import { FACTORY_ABI, SMART_WALLET_ABI } from "~~/contracts/SmartWalletAbi";

interface DeployWalletRequest {
  chainId: number;
  qx: `0x${string}`;
  qy: `0x${string}`;
  credentialIdHash: `0x${string}`;
}

// Get chain config based on chainId
function getChainConfig(chainId: number) {
  switch (chainId) {
    case 8453:
      return {
        chain: base,
        rpcUrl: `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
        factoryAddress: process.env.NEXT_PUBLIC_FACTORY_ADDRESS_BASE as `0x${string}`,
      };
    case 31337:
      return {
        chain: foundry,
        rpcUrl: "http://127.0.0.1:8545",
        factoryAddress: process.env.NEXT_PUBLIC_FACTORY_ADDRESS_LOCAL as `0x${string}`,
      };
    default:
      throw new Error(`Unsupported chain: ${chainId}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: DeployWalletRequest = await request.json();
    const { chainId, qx, qy, credentialIdHash } = body;

    // Validate required fields
    if (!chainId || !qx || !qy || !credentialIdHash) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    // Get facilitator private key from environment
    const facilitatorPrivateKey = process.env.FACILITATOR_PRIVATE_KEY;
    if (!facilitatorPrivateKey) {
      return NextResponse.json({ success: false, error: "Facilitator not configured" }, { status: 500 });
    }

    // Setup chain and clients
    const { chain, rpcUrl, factoryAddress } = getChainConfig(chainId);

    if (!factoryAddress) {
      return NextResponse.json({ success: false, error: "Factory address not configured" }, { status: 500 });
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

    // Derive owner address from passkey public key (same as on-chain)
    const combinedKey = `${qx}${qy.slice(2)}` as `0x${string}`;
    const passkeyAddress = ("0x" + keccak256(combinedKey).slice(2).slice(-40)) as `0x${string}`;

    // Use passkey address as owner and salt = 0 for deterministic address
    const salt = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

    // Predict wallet address before deployment
    const predictedAddress = (await publicClient.readContract({
      address: factoryAddress,
      abi: FACTORY_ABI,
      functionName: "getWalletAddress",
      args: [passkeyAddress, salt],
    })) as `0x${string}`;

    // Check if wallet already deployed
    const code = await publicClient.getBytecode({ address: predictedAddress });
    if (code && code !== "0x") {
      // Wallet already exists, just add the passkey if not already added
      const isPasskey = await publicClient.readContract({
        address: predictedAddress,
        abi: SMART_WALLET_ABI,
        functionName: "isPasskey",
        args: [passkeyAddress],
      });

      if (isPasskey) {
        return NextResponse.json({
          success: true,
          walletAddress: predictedAddress,
          alreadyDeployed: true,
          passkeyAlreadyAdded: true,
        });
      }

      // Passkey not added yet - this shouldn't happen in normal flow
      // but could happen if deployment succeeded but passkey addition failed
      return NextResponse.json({
        success: true,
        walletAddress: predictedAddress,
        alreadyDeployed: true,
        passkeyAlreadyAdded: false,
        message: "Wallet exists but passkey not registered. Owner needs to add passkey.",
      });
    }

    // Deploy wallet via factory
    const { request: deployRequest } = await publicClient.simulateContract({
      address: factoryAddress,
      abi: FACTORY_ABI,
      functionName: "createWallet",
      args: [passkeyAddress, salt],
      account,
    });

    const deployTxHash = await walletClient.writeContract(deployRequest);
    const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployTxHash });

    // Add passkey to the wallet (facilitator is the owner via factory default guardian setup)
    // Note: The owner of the wallet is passkeyAddress, so we need the owner to add the passkey
    // For the initial setup, the Factory sets the guardian (facilitator) but owner is passkeyAddress
    // This means we can't add the passkey directly - the owner (passkey holder) needs to do it

    // For now, return success with wallet address - the frontend will handle passkey addition
    return NextResponse.json({
      success: true,
      walletAddress: predictedAddress,
      deployTxHash,
      blockNumber: deployReceipt.blockNumber.toString(),
      gasUsed: deployReceipt.gasUsed.toString(),
      message: "Wallet deployed. Owner needs to add passkey via signed transaction.",
    });
  } catch (error) {
    console.error("[Deploy Wallet API] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}

// GET endpoint to predict wallet address without deploying
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const chainId = parseInt(searchParams.get("chainId") || "31337");
    const qx = searchParams.get("qx") as `0x${string}`;
    const qy = searchParams.get("qy") as `0x${string}`;

    if (!qx || !qy) {
      return NextResponse.json({ success: false, error: "Missing qx or qy" }, { status: 400 });
    }

    const { chain, rpcUrl, factoryAddress } = getChainConfig(chainId);

    if (!factoryAddress) {
      return NextResponse.json({ success: false, error: "Factory address not configured" }, { status: 500 });
    }

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    // Derive passkey address
    const combinedKey = `${qx}${qy.slice(2)}` as `0x${string}`;
    const passkeyAddress = ("0x" + keccak256(combinedKey).slice(2).slice(-40)) as `0x${string}`;

    const salt = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

    const predictedAddress = (await publicClient.readContract({
      address: factoryAddress,
      abi: FACTORY_ABI,
      functionName: "getWalletAddress",
      args: [passkeyAddress, salt],
    })) as `0x${string}`;

    // Check if already deployed
    const code = await publicClient.getBytecode({ address: predictedAddress });
    const isDeployed = code && code !== "0x";

    return NextResponse.json({
      success: true,
      walletAddress: predictedAddress,
      passkeyAddress,
      isDeployed,
    });
  } catch (error) {
    console.error("[Predict Wallet API] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
