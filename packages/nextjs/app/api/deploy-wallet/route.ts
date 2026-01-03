import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, foundry } from "viem/chains";
import deployedContracts from "~~/contracts/deployedContracts";

// Get ABIs from auto-generated deployedContracts
function getContractAbis(chainId: number) {
  const contracts = deployedContracts[chainId as keyof typeof deployedContracts];
  return {
    factory: contracts?.Factory?.abi,
    smartWallet: contracts?.SmartWallet?.abi,
  };
}

interface DeployWalletRequest {
  chainId: number;
  qx: `0x${string}`;
  qy: `0x${string}`;
  credentialIdHash: `0x${string}`;
}

// Get chain config based on chainId
function getChainConfig(chainId: number) {
  const contracts = deployedContracts[chainId as keyof typeof deployedContracts];

  switch (chainId) {
    case 8453:
      return {
        chain: base,
        rpcUrl: `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
        factoryAddress: contracts?.Factory?.address as `0x${string}`,
      };
    case 31337:
      return {
        chain: foundry,
        rpcUrl: "http://127.0.0.1:8545",
        factoryAddress: contracts?.Factory?.address as `0x${string}`,
      };
    default:
      throw new Error(`Unsupported chain: ${chainId}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: DeployWalletRequest = await request.json();
    const { chainId, qx, qy, credentialIdHash } = body;

    console.log("[Deploy Wallet API] POST request received:", {
      chainId,
      qx: qx?.slice(0, 20) + "...",
      qy: qy?.slice(0, 20) + "...",
      credentialIdHash: credentialIdHash?.slice(0, 20) + "...",
    });

    // Validate required fields
    if (!chainId || !qx || !qy || !credentialIdHash) {
      console.log("[Deploy Wallet API] Missing fields:", {
        chainId: !!chainId,
        qx: !!qx,
        qy: !!qy,
        credentialIdHash: !!credentialIdHash,
      });
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    // Get facilitator private key from environment
    const facilitatorPrivateKey = process.env.FACILITATOR_PRIVATE_KEY;
    if (!facilitatorPrivateKey) {
      return NextResponse.json({ success: false, error: "Facilitator not configured" }, { status: 500 });
    }

    // Setup chain and clients
    const { chain, rpcUrl, factoryAddress } = getChainConfig(chainId);
    const { factory: FACTORY_ABI, smartWallet: SMART_WALLET_ABI } = getContractAbis(chainId);

    if (!factoryAddress || !FACTORY_ABI || !SMART_WALLET_ABI) {
      return NextResponse.json({ success: false, error: "Contract configuration missing" }, { status: 500 });
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
      console.error("[Deploy Wallet API] FACILITATOR LOW ON GAS!", {
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

    // Derive passkey address from passkey public key (same as on-chain)
    const combinedKey = `${qx}${qy.slice(2)}` as `0x${string}`;
    const passkeyAddress = ("0x" + keccak256(combinedKey).slice(2).slice(-40)) as `0x${string}`;

    // Salt = 0 for deterministic address
    const salt = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

    // Predict wallet address before deployment (new signature: qx, qy, salt)
    const predictedAddress = (await publicClient.readContract({
      address: factoryAddress,
      abi: FACTORY_ABI,
      functionName: "getWalletAddress",
      args: [qx, qy, salt],
    })) as `0x${string}`;

    // Check if wallet already deployed
    const code = await publicClient.getBytecode({ address: predictedAddress });
    if (code && code !== "0x") {
      // Wallet already exists - check if it has the same passkey
      const storedQx = (await publicClient.readContract({
        address: predictedAddress,
        abi: SMART_WALLET_ABI,
        functionName: "qx",
      })) as `0x${string}`;

      const storedQy = (await publicClient.readContract({
        address: predictedAddress,
        abi: SMART_WALLET_ABI,
        functionName: "qy",
      })) as `0x${string}`;

      if (storedQx === qx && storedQy === qy) {
        return NextResponse.json({
          success: true,
          walletAddress: predictedAddress,
          passkeyAddress,
          alreadyDeployed: true,
        });
      }

      // Different passkey - this shouldn't happen with deterministic addresses
      return NextResponse.json(
        {
          success: false,
          error: "Wallet exists with different passkey",
        },
        { status: 400 },
      );
    }

    // Deploy wallet via factory (new function name: createWallet)
    console.log("[Deploy Wallet API] Simulating createWallet with args:", {
      factoryAddress,
      salt,
      qx,
      qy,
      credentialIdHash,
    });

    const { request: deployRequest } = await publicClient.simulateContract({
      address: factoryAddress,
      abi: FACTORY_ABI,
      functionName: "createWallet",
      args: [salt, qx, qy, credentialIdHash],
      account,
    });

    console.log("[Deploy Wallet API] Simulation successful, writing contract...");
    const deployTxHash = await walletClient.writeContract(deployRequest);
    console.log("[Deploy Wallet API] Transaction sent:", deployTxHash);
    const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
    console.log("[Deploy Wallet API] Transaction confirmed in block:", deployReceipt.blockNumber);

    return NextResponse.json({
      success: true,
      walletAddress: predictedAddress,
      passkeyAddress,
      deployTxHash,
      blockNumber: deployReceipt.blockNumber.toString(),
      gasUsed: deployReceipt.gasUsed.toString(),
      message: "Wallet deployed with passkey. Ready to use!",
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
    const { factory: FACTORY_ABI } = getContractAbis(chainId);

    if (!factoryAddress || !FACTORY_ABI) {
      return NextResponse.json({ success: false, error: "Contract configuration missing" }, { status: 500 });
    }

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    // Derive passkey address
    const combinedKey = `${qx}${qy.slice(2)}` as `0x${string}`;
    const passkeyAddress = ("0x" + keccak256(combinedKey).slice(2).slice(-40)) as `0x${string}`;

    const salt = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

    // New signature: getWalletAddress(qx, qy, salt)
    const predictedAddress = (await publicClient.readContract({
      address: factoryAddress,
      abi: FACTORY_ABI,
      functionName: "getWalletAddress",
      args: [qx, qy, salt],
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
