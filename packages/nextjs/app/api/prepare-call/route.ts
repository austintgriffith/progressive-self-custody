import { NextRequest, NextResponse } from "next/server";
import { concat, createPublicClient, encodeFunctionData, http, keccak256, pad, toHex } from "viem";
import { base, foundry } from "viem/chains";
import { ERC20_ABI, SMART_WALLET_ABI } from "~~/contracts/SmartWalletAbi";

// USDC addresses per chain
const USDC_ADDRESSES: Record<number, `0x${string}`> = {
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base mainnet
  31337: "0x5FbDB2315678afecb367f032d93F642f64180aa3", // Local (will be mock)
};

// Facilitator address (receives gas fees)
const FACILITATOR_ADDRESS = process.env.FACILITATOR_ADDRESS as `0x${string}`;

// Gas fee in USDC (6 decimals) - starts at $0.05, can be adjusted
const DEFAULT_GAS_FEE_USDC = BigInt(50000); // 0.05 USDC

interface Call {
  target: `0x${string}`;
  value: bigint;
  data: `0x${string}`;
}

type ActionType = "payUSDC" | "withdraw" | "setWithdrawAddress" | "setRecoveryPassword" | "transfer";

interface PrepareCallRequest {
  chainId: number;
  wallet: `0x${string}`;
  qx: `0x${string}`;
  qy: `0x${string}`;
  action: ActionType;
  params: {
    amount?: string;
    to?: `0x${string}`;
    address?: `0x${string}`;
    passwordHash?: `0x${string}`;
    asset?: "ETH" | "USDC";
    exampleContract?: `0x${string}`;
  };
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

// Build challenge hash for single transaction
function buildChallengeHash(
  chainId: bigint,
  wallet: `0x${string}`,
  target: `0x${string}`,
  value: bigint,
  data: `0x${string}`,
  nonce: bigint,
  deadline: bigint,
): `0x${string}` {
  const encoded = concat([
    pad(toHex(chainId), { size: 32 }),
    wallet,
    target,
    pad(toHex(value), { size: 32 }),
    data,
    pad(toHex(nonce), { size: 32 }),
    pad(toHex(deadline), { size: 32 }),
  ]);
  return keccak256(encoded);
}

// Build challenge hash for batch transaction
function buildBatchChallengeHash(
  chainId: bigint,
  wallet: `0x${string}`,
  calls: Call[],
  nonce: bigint,
  deadline: bigint,
): `0x${string}` {
  // Encode calls array the same way Solidity does
  const callsHash = keccak256(
    concat(calls.map(c => concat([c.target, pad(toHex(c.value), { size: 32 }), keccak256(c.data)]))),
  );

  const encoded = concat([
    pad(toHex(chainId), { size: 32 }),
    wallet,
    callsHash,
    pad(toHex(nonce), { size: 32 }),
    pad(toHex(deadline), { size: 32 }),
  ]);
  return keccak256(encoded);
}

export async function POST(request: NextRequest) {
  try {
    const body: PrepareCallRequest = await request.json();
    const { chainId, wallet, qx, qy, action, params } = body;

    // Validate required fields
    if (!chainId || !wallet || !qx || !qy || !action) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    const { chain, rpcUrl } = getChainConfig(chainId);
    const usdcAddress = USDC_ADDRESSES[chainId];

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    // Derive passkey address
    const combinedKey = `${qx}${qy.slice(2)}` as `0x${string}`;
    const passkeyAddress = ("0x" + keccak256(combinedKey).slice(2).slice(-40)) as `0x${string}`;

    // Get current nonce
    const nonce = (await publicClient.readContract({
      address: wallet,
      abi: SMART_WALLET_ABI,
      functionName: "nonces",
      args: [passkeyAddress],
    })) as bigint;

    // Set deadline to 1 hour from now
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Build calls based on action
    const calls: Call[] = [];
    const gasFee = DEFAULT_GAS_FEE_USDC;

    switch (action) {
      case "payUSDC": {
        const amount = BigInt(params.amount || "0");
        const exampleContract = params.exampleContract;

        if (!exampleContract) {
          return NextResponse.json({ success: false, error: "Missing exampleContract address" }, { status: 400 });
        }

        // 1. Approve Example contract to spend USDC
        calls.push({
          target: usdcAddress,
          value: 0n,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [exampleContract, amount],
          }),
        });

        // 2. Call payUSDC on Example contract
        calls.push({
          target: exampleContract,
          value: 0n,
          data: encodeFunctionData({
            abi: [
              {
                inputs: [{ name: "amount", type: "uint256" }],
                name: "payUSDC",
                outputs: [],
                stateMutability: "nonpayable",
                type: "function",
              },
            ],
            functionName: "payUSDC",
            args: [amount],
          }),
        });

        // 3. Gas fee to facilitator
        if (FACILITATOR_ADDRESS) {
          calls.push({
            target: usdcAddress,
            value: 0n,
            data: encodeFunctionData({
              abi: ERC20_ABI,
              functionName: "transfer",
              args: [FACILITATOR_ADDRESS, gasFee],
            }),
          });
        }
        break;
      }

      case "withdraw": {
        const amount = BigInt(params.amount || "0");
        const asset = params.asset || "USDC";

        // Get withdraw address from wallet
        const withdrawAddress = (await publicClient.readContract({
          address: wallet,
          abi: SMART_WALLET_ABI,
          functionName: "withdrawAddress",
        })) as `0x${string}`;

        if (!withdrawAddress || withdrawAddress === "0x0000000000000000000000000000000000000000") {
          return NextResponse.json({ success: false, error: "No withdraw address set" }, { status: 400 });
        }

        if (asset === "USDC") {
          // Transfer USDC to withdraw address
          calls.push({
            target: usdcAddress,
            value: 0n,
            data: encodeFunctionData({
              abi: ERC20_ABI,
              functionName: "transfer",
              args: [withdrawAddress, amount],
            }),
          });
        } else {
          // Transfer ETH
          calls.push({
            target: withdrawAddress,
            value: amount,
            data: "0x",
          });
        }

        // Gas fee to facilitator
        if (FACILITATOR_ADDRESS) {
          calls.push({
            target: usdcAddress,
            value: 0n,
            data: encodeFunctionData({
              abi: ERC20_ABI,
              functionName: "transfer",
              args: [FACILITATOR_ADDRESS, gasFee],
            }),
          });
        }
        break;
      }

      case "transfer": {
        const amount = BigInt(params.amount || "0");
        const to = params.to;
        const asset = params.asset || "USDC";

        if (!to) {
          return NextResponse.json({ success: false, error: "Missing 'to' address" }, { status: 400 });
        }

        if (asset === "USDC") {
          calls.push({
            target: usdcAddress,
            value: 0n,
            data: encodeFunctionData({
              abi: ERC20_ABI,
              functionName: "transfer",
              args: [to, amount],
            }),
          });
        } else {
          calls.push({
            target: to,
            value: amount,
            data: "0x",
          });
        }

        // Gas fee to facilitator
        if (FACILITATOR_ADDRESS) {
          calls.push({
            target: usdcAddress,
            value: 0n,
            data: encodeFunctionData({
              abi: ERC20_ABI,
              functionName: "transfer",
              args: [FACILITATOR_ADDRESS, gasFee],
            }),
          });
        }
        break;
      }

      case "setWithdrawAddress": {
        const address = params.address;
        if (!address) {
          return NextResponse.json({ success: false, error: "Missing address" }, { status: 400 });
        }

        calls.push({
          target: wallet,
          value: 0n,
          data: encodeFunctionData({
            abi: SMART_WALLET_ABI,
            functionName: "setWithdrawAddress",
            args: [address],
          }),
        });

        // Gas fee
        if (FACILITATOR_ADDRESS) {
          calls.push({
            target: usdcAddress,
            value: 0n,
            data: encodeFunctionData({
              abi: ERC20_ABI,
              functionName: "transfer",
              args: [FACILITATOR_ADDRESS, gasFee],
            }),
          });
        }
        break;
      }

      case "setRecoveryPassword": {
        const passwordHash = params.passwordHash;
        if (!passwordHash) {
          return NextResponse.json({ success: false, error: "Missing passwordHash" }, { status: 400 });
        }

        calls.push({
          target: wallet,
          value: 0n,
          data: encodeFunctionData({
            abi: SMART_WALLET_ABI,
            functionName: "setRecoveryPasswordHash",
            args: [passwordHash],
          }),
        });

        // Gas fee
        if (FACILITATOR_ADDRESS) {
          calls.push({
            target: usdcAddress,
            value: 0n,
            data: encodeFunctionData({
              abi: ERC20_ABI,
              functionName: "transfer",
              args: [FACILITATOR_ADDRESS, gasFee],
            }),
          });
        }
        break;
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }

    // Build challenge hash
    let challengeHash: `0x${string}`;
    const isBatch = calls.length > 1;

    if (isBatch) {
      challengeHash = buildBatchChallengeHash(BigInt(chainId), wallet, calls, nonce, deadline);
    } else {
      const call = calls[0];
      challengeHash = buildChallengeHash(BigInt(chainId), wallet, call.target, call.value, call.data, nonce, deadline);
    }

    return NextResponse.json({
      success: true,
      isBatch,
      calls: calls.map(c => ({
        target: c.target,
        value: c.value.toString(),
        data: c.data,
      })),
      nonce: nonce.toString(),
      deadline: deadline.toString(),
      challengeHash,
      estimatedGasFee: gasFee.toString(),
    });
  } catch (error) {
    console.error("[Prepare Call API] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
