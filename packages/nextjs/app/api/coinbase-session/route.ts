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
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per minute per IP

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

export async function POST(req: NextRequest) {
  try {
    // 1. Check origin - ensure request comes from allowed domains
    const origin = req.headers.get("origin");
    const referer = req.headers.get("referer");

    const isAllowedOrigin = origin && ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed) || allowed === "*");
    const isAllowedReferer = referer && ALLOWED_ORIGINS.some(allowed => referer.startsWith(allowed) || allowed === "*");

    if (!isAllowedOrigin && !isAllowedReferer) {
      console.warn("Unauthorized origin/referer:", { origin, referer });
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

    // 5. Generate JWT using CDP SDK
    const jwt = await generateJwt({
      apiKeyId: API_KEY_ID,
      apiKeySecret: API_SECRET,
      requestMethod: "POST",
      requestHost: "api.developer.coinbase.com",
      requestPath: "/onramp/v1/token",
      expiresIn: 120,
    });

    // 6. Call Coinbase session token API
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
      return NextResponse.json({
        success: true,
        sessionToken: data.token,
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
    console.error("Error in /api/coinbase-session:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
