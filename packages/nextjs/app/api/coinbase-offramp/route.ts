import { NextRequest, NextResponse } from "next/server";
import { generateJwt } from "@coinbase/cdp-sdk/auth";

// Coinbase CDP API credentials (must be set in environment variables)
const API_KEY_ID = process.env.COINBASE_API_KEY_ID;
const API_SECRET = process.env.COINBASE_API_SECRET;

// Allowed origins for CORS protection
const ALLOWED_ORIGINS = [
  "http://localhost:", // Allow any localhost port in development
  "https://progressive-self-custody-nextjs.vercel.app",
];

// Simple in-memory rate limiting (use Redis in production for multi-instance)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 20; // 20 requests per minute per IP (higher for polling)

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }

  record.count++;
  return false;
}

function isValidEthAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function checkOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");

  const isAllowedOrigin = origin && ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed) || allowed === "*");
  const isAllowedReferer = referer && ALLOWED_ORIGINS.some(allowed => referer.startsWith(allowed) || allowed === "*");

  return !!(isAllowedOrigin || isAllowedReferer);
}

// POST - Generate offramp session token and URL
export async function POST(req: NextRequest) {
  try {
    // 1. Check origin
    if (!checkOrigin(req)) {
      console.warn("Unauthorized origin/referer for offramp");
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
    }

    // 2. Rate limiting by IP
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("x-real-ip") || "unknown";
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { success: false, error: "Too many requests. Please try again later." },
        { status: 429 },
      );
    }

    // 3. Validate request body
    const { walletAddress } = await req.json();

    if (!walletAddress) {
      return NextResponse.json({ success: false, error: "Missing walletAddress" }, { status: 400 });
    }

    if (!isValidEthAddress(walletAddress)) {
      return NextResponse.json({ success: false, error: "Invalid wallet address format" }, { status: 400 });
    }

    // 4. Check credentials are configured
    if (!API_KEY_ID || !API_SECRET) {
      console.error("Coinbase API credentials not configured");
      return NextResponse.json({ success: false, error: "Server configuration error" }, { status: 500 });
    }

    // 5. Get the redirect URL from the request origin - include query param to trigger auto-continue
    const origin =
      req.headers.get("origin") ||
      req.headers.get("referer")?.split("/").slice(0, 3).join("/") ||
      "https://progressive-self-custody-nextjs.vercel.app";
    const redirectUrl = `${origin}?coinbase-offramp=pending`;

    // 6. Generate JWT using CDP SDK for session token
    const jwt = await generateJwt({
      apiKeyId: API_KEY_ID,
      apiKeySecret: API_SECRET,
      requestMethod: "POST",
      requestHost: "api.developer.coinbase.com",
      requestPath: "/onramp/v1/token",
      expiresIn: 120,
    });

    // 7. Call Coinbase session token API (same endpoint works for both on/offramp)
    const response = await fetch("https://api.developer.coinbase.com/onramp/v1/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        addresses: [
          {
            address: walletAddress,
            blockchains: ["base"],
          },
        ],
        assets: ["USDC"],
      }),
    });

    const responseText = await response.text();

    if (response.ok) {
      const data = JSON.parse(responseText);

      // Build the offramp URL with required redirectUrl
      const params = new URLSearchParams({
        sessionToken: data.token,
        partnerUserId: walletAddress,
        redirectUrl: redirectUrl,
        defaultAsset: "USDC",
        defaultNetwork: "base",
      });

      // Add addresses parameter (JSON encoded)
      const addressesParam = JSON.stringify({
        [walletAddress]: ["base"],
      });
      params.append("addresses", addressesParam);

      const offrampUrl = `https://pay.coinbase.com/v3/sell/input?${params.toString()}`;

      return NextResponse.json({
        success: true,
        sessionToken: data.token,
        offrampUrl,
      });
    } else {
      console.error("Coinbase API error:", response.status, responseText);
      return NextResponse.json(
        {
          success: false,
          error: "Failed to generate session token",
          details: responseText,
        },
        { status: response.status },
      );
    }
  } catch (error: unknown) {
    console.error("Error in /api/coinbase-offramp POST:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}

// GET - Poll Coinbase Transaction Status API
export async function GET(req: NextRequest) {
  try {
    // 1. Check origin
    if (!checkOrigin(req)) {
      console.warn("Unauthorized origin/referer for offramp status");
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
    }

    // 2. Rate limiting by IP
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("x-real-ip") || "unknown";
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { success: false, error: "Too many requests. Please try again later." },
        { status: 429 },
      );
    }

    // 3. Get wallet address from query params
    const { searchParams } = new URL(req.url);
    const walletAddress = searchParams.get("walletAddress");

    if (!walletAddress) {
      return NextResponse.json({ success: false, error: "Missing walletAddress" }, { status: 400 });
    }

    if (!isValidEthAddress(walletAddress)) {
      return NextResponse.json({ success: false, error: "Invalid wallet address format" }, { status: 400 });
    }

    // 4. Check credentials are configured
    if (!API_KEY_ID || !API_SECRET) {
      console.error("Coinbase API credentials not configured");
      return NextResponse.json({ success: false, error: "Server configuration error" }, { status: 500 });
    }

    // 5. Generate JWT for transaction status API
    const jwt = await generateJwt({
      apiKeyId: API_KEY_ID,
      apiKeySecret: API_SECRET,
      requestMethod: "GET",
      requestHost: "api.developer.coinbase.com",
      requestPath: "/onramp/v1/sell/user/" + walletAddress + "/transactions",
      expiresIn: 120,
    });

    // 6. Call Coinbase Transaction Status API
    const response = await fetch(
      `https://api.developer.coinbase.com/onramp/v1/sell/user/${walletAddress}/transactions`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      },
    );

    const responseText = await response.text();

    if (response.ok) {
      const data = JSON.parse(responseText);

      // Find the most recent pending transaction that needs crypto sent
      // Status flow: TRANSACTION_STATUS_STARTED -> TRANSACTION_STATUS_PENDING -> TRANSACTION_STATUS_SUCCESS/FAILED
      const transactions = data.transactions || [];

      // Look for a transaction that needs the user to send crypto
      // Coinbase status: TRANSACTION_STATUS_STARTED means waiting for crypto
      const pendingTransaction = transactions.find(
        (tx: {
          status: string;
          to_address?: string;
          sell_amount?: { value: string; currency: string };
          network?: string;
        }) => tx.status === "TRANSACTION_STATUS_STARTED",
      );

      if (pendingTransaction) {
        return NextResponse.json({
          success: true,
          hasPendingTransaction: true,
          transaction: {
            status: pendingTransaction.status,
            toAddress: pendingTransaction.to_address,
            sellAmount: pendingTransaction.sell_amount?.value,
            sellCurrency: pendingTransaction.sell_amount?.currency,
            network: pendingTransaction.network,
            transactionId: pendingTransaction.transaction_id,
          },
        });
      }

      // No pending transaction found
      return NextResponse.json({
        success: true,
        hasPendingTransaction: false,
      });
    } else {
      console.error("[Coinbase Offramp GET] API error:", response.status, responseText);
      return NextResponse.json(
        {
          success: false,
          error: "Failed to get transaction status",
          details: responseText,
        },
        { status: response.status },
      );
    }
  } catch (error: unknown) {
    console.error("Error in /api/coinbase-offramp GET:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
