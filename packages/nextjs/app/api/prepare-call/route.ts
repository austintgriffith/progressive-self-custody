import { NextRequest, NextResponse } from "next/server";
import {
  concat,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  keccak256,
  pad,
  toBytes,
  toHex,
} from "viem";
import { base, foundry } from "viem/chains";
import deployedContracts from "~~/contracts/deployedContracts";
import externalContracts, { ERC20_ABI } from "~~/contracts/externalContracts";

// Get USDC address from externalContracts (single source of truth)
function getUsdcAddress(chainId: number): `0x${string}` | undefined {
  const contracts = externalContracts[chainId as keyof typeof externalContracts];
  return contracts?.USDC?.address as `0x${string}` | undefined;
}

// Facilitator address (receives gas fees)
const FACILITATOR_ADDRESS = process.env.FACILITATOR_ADDRESS as `0x${string}`;

// Gas fee in USDC (6 decimals) - $0.005 provides ~5x margin over typical Base L2 costs
const DEFAULT_GAS_FEE_USDC = BigInt(5000); // 0.005 USDC

interface Call {
  target: `0x${string}`;
  value: bigint;
  data: `0x${string}`;
}

type ActionType = "dumbDiceRoll" | "withdraw" | "setWithdrawAddress" | "setGuardian" | "transfer";

interface PrepareCallRequest {
  chainId: number;
  wallet: `0x${string}`;
  action: ActionType;
  params: {
    amount?: string;
    to?: `0x${string}`;
    address?: `0x${string}`;
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

// Get ABI from auto-generated deployedContracts
function getSmartWalletAbi(chainId: number) {
  const contracts = deployedContracts[chainId as keyof typeof deployedContracts];
  return contracts?.SmartWallet?.abi;
}

// Build challenge hash for batch transaction (metaBatchExec)
function buildBatchChallengeHash(
  chainId: bigint,
  wallet: `0x${string}`,
  calls: Call[],
  nonce: bigint,
  deadline: bigint,
): `0x${string}` {
  // Encode calls array using abi.encode to match Solidity's keccak256(abi.encode(calls))
  const callsEncoded = encodeAbiParameters(
    [
      {
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    [calls.map(c => ({ target: c.target, value: c.value, data: c.data }))],
  );
  const callsHash = keccak256(callsEncoded);

  const encoded = concat([
    pad(toHex(chainId), { size: 32 }),
    wallet,
    callsHash,
    pad(toHex(nonce), { size: 32 }),
    pad(toHex(deadline), { size: 32 }),
  ]);
  return keccak256(encoded);
}

// Build challenge hash for meta settings functions
// paramType: 'address' (20 bytes), 'bytes32' (32 bytes), 'uint256' (32 bytes)
function buildMetaSettingsChallengeHash(
  chainId: bigint,
  wallet: `0x${string}`,
  functionSignature: string,
  paramValue: `0x${string}` | bigint,
  paramType: "address" | "bytes32" | "uint256",
  nonce: bigint,
  deadline: bigint,
): `0x${string}` {
  // Get function selector: first 4 bytes of keccak256(signature)
  const selector = keccak256(toBytes(functionSignature)).slice(0, 10) as `0x${string}`;

  // Encode based on param type - abi.encodePacked uses native sizes!
  let encodedParam: `0x${string}`;
  if (paramType === "address") {
    // Addresses are 20 bytes in abi.encodePacked (NOT padded)
    encodedParam = paramValue as `0x${string}`;
  } else if (paramType === "uint256") {
    // uint256 is 32 bytes
    encodedParam = pad(toHex(paramValue as bigint), { size: 32 });
  } else {
    // bytes32 is 32 bytes
    encodedParam = paramValue as `0x${string}`;
  }

  const encoded = concat([
    pad(toHex(chainId), { size: 32 }), // uint256 = 32 bytes
    wallet, // address = 20 bytes in abi.encodePacked
    selector, // bytes4 = 4 bytes
    encodedParam, // depends on type
    pad(toHex(nonce), { size: 32 }), // uint256 = 32 bytes
    pad(toHex(deadline), { size: 32 }), // uint256 = 32 bytes
  ]);
  return keccak256(encoded);
}

export async function POST(request: NextRequest) {
  try {
    const body: PrepareCallRequest = await request.json();
    const { chainId, wallet, action, params } = body;

    // Validate required fields
    if (!chainId || !wallet || !action) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    const { chain, rpcUrl } = getChainConfig(chainId);
    const usdcAddress = getUsdcAddress(chainId);
    const SMART_WALLET_ABI = getSmartWalletAbi(chainId);

    if (!usdcAddress) {
      return NextResponse.json({ success: false, error: "USDC address not configured for chain" }, { status: 500 });
    }

    if (!SMART_WALLET_ABI) {
      return NextResponse.json({ success: false, error: "SmartWallet ABI not found for chain" }, { status: 500 });
    }

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    // Get current nonce (now a single uint256, not a mapping)
    const nonce = (await publicClient.readContract({
      address: wallet,
      abi: SMART_WALLET_ABI,
      functionName: "nonce",
    })) as bigint;

    // Set deadline to 1 hour from now
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const gasFee = DEFAULT_GAS_FEE_USDC;

    // Handle settings actions with dedicated meta functions
    if (action === "setWithdrawAddress") {
      const address = params.address;
      if (!address) {
        return NextResponse.json({ success: false, error: "Missing address" }, { status: 400 });
      }

      const challengeHash = buildMetaSettingsChallengeHash(
        BigInt(chainId),
        wallet,
        "setWithdrawAddress(address)",
        address,
        "address",
        nonce,
        deadline,
      );

      return NextResponse.json({
        success: true,
        functionName: "metaSetWithdrawAddress",
        params: {
          withdrawAddress: address,
        },
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        challengeHash,
        estimatedGasFee: "0", // No gas fee for settings
      });
    }

    // Handle setGuardian action with dedicated meta function
    if (action === "setGuardian") {
      const address = params.address;
      if (!address) {
        return NextResponse.json({ success: false, error: "Missing address" }, { status: 400 });
      }

      const challengeHash = buildMetaSettingsChallengeHash(
        BigInt(chainId),
        wallet,
        "setGuardian(address)",
        address,
        "address",
        nonce,
        deadline,
      );

      return NextResponse.json({
        success: true,
        functionName: "metaSetGuardian",
        params: {
          newGuardian: address,
        },
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        challengeHash,
        estimatedGasFee: "0", // No gas fee for settings
      });
    }

    // Handle batch execution actions (payUSDC, withdraw, transfer)
    const calls: Call[] = [];

    // Fixed bet amount for dice roll: 0.05 USDC
    const BET_AMOUNT = BigInt(50000);

    switch (action) {
      case "dumbDiceRoll": {
        const exampleContract = params.exampleContract;

        if (!exampleContract) {
          return NextResponse.json({ success: false, error: "Missing exampleContract address" }, { status: 400 });
        }

        // 1. Approve Example contract to spend 0.05 USDC
        calls.push({
          target: usdcAddress,
          value: 0n,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [exampleContract, BET_AMOUNT],
          }),
        });

        // 2. Call dumbDiceRoll on Example contract (no args)
        calls.push({
          target: exampleContract,
          value: 0n,
          data: encodeFunctionData({
            abi: [
              {
                inputs: [],
                name: "dumbDiceRoll",
                outputs: [],
                stateMutability: "nonpayable",
                type: "function",
              },
            ],
            functionName: "dumbDiceRoll",
            args: [],
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
          // Transfer ETH (shouldn't have any, but just in case)
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

      default:
        return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }

    // Build batch challenge hash
    const challengeHash = buildBatchChallengeHash(BigInt(chainId), wallet, calls, nonce, deadline);

    return NextResponse.json({
      success: true,
      functionName: "metaBatchExec",
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
