import { p256 } from "@noble/curves/nist.js";
import { concat, keccak256, pad, toHex } from "viem";

// P-256 curve order for signature recovery
const P256_CURVE_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

// WebAuthn auth structure for contract calls
export interface WebAuthnAuth {
  authenticatorData: `0x${string}`;
  clientDataJSON: string;
  challengeIndex: bigint;
  typeIndex: bigint;
  r: `0x${string}`;
  s: `0x${string}`;
}

// Stored passkey data
export interface StoredPasskey {
  credentialId: string; // Base64url encoded
  qx: `0x${string}`;
  qy: `0x${string}`;
  passkeyAddress: `0x${string}`;
}

// Check if WebAuthn is supported
export function isWebAuthnSupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}

// Generate a random challenge
function generateChallenge(): Uint8Array {
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  return challenge;
}

// Convert ArrayBuffer to hex string
function bufferToHex(buffer: ArrayBuffer): `0x${string}` {
  return `0x${Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

// Convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Convert base64url to Uint8Array
function base64urlToBytes(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Convert Uint8Array to base64url
function bytesToBase64url(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// Derive passkey address from public key coordinates
export function derivePasskeyAddress(qx: `0x${string}`, qy: `0x${string}`): `0x${string}` {
  const hash = keccak256(concat([qx, qy]));
  return `0x${hash.slice(-40)}` as `0x${string}`;
}

// Get credential ID hash for on-chain storage
export function getCredentialIdHash(credentialId: string): `0x${string}` {
  const bytes = base64urlToBytes(credentialId);
  return keccak256(bufferToHex(bytes.buffer as ArrayBuffer));
}

// Create a new passkey
export async function createPasskey(): Promise<{
  credentialId: string;
  qx: `0x${string}`;
  qy: `0x${string}`;
  passkeyAddress: `0x${string}`;
}> {
  const challenge = generateChallenge();

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: {
        name: "Progressive Self-Custody",
        id: window.location.hostname,
      },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: `progressive-demo-user-${Date.now()}`,
        displayName: "Progressive Self-Custody Demo",
      },
      pubKeyCredParams: [
        { alg: -7, type: "public-key" }, // ES256 (P-256)
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60000,
      attestation: "none",
    },
  })) as PublicKeyCredential;

  if (!credential) {
    throw new Error("Failed to create credential");
  }

  const response = credential.response as AuthenticatorAttestationResponse;

  // Parse the public key from the attestation
  const publicKey = response.getPublicKey();
  if (!publicKey) {
    throw new Error("No public key in response");
  }

  // Import the public key to extract coordinates
  const cryptoKey = await crypto.subtle.importKey("spki", publicKey, { name: "ECDSA", namedCurve: "P-256" }, true, [
    "verify",
  ]);

  const jwk = await crypto.subtle.exportKey("jwk", cryptoKey);
  if (!jwk.x || !jwk.y) {
    throw new Error("Failed to extract public key coordinates");
  }

  // Convert from base64url to hex (32 bytes each)
  const xBytes = base64urlToBytes(jwk.x);
  const yBytes = base64urlToBytes(jwk.y);

  const qx = bufferToHex(xBytes.buffer as ArrayBuffer);
  const qy = bufferToHex(yBytes.buffer as ArrayBuffer);
  const credentialId = bytesToBase64url(new Uint8Array(credential.rawId));
  const passkeyAddress = derivePasskeyAddress(qx, qy);

  return {
    credentialId,
    qx,
    qy,
    passkeyAddress,
  };
}

// Login with existing passkey (recovers public key from signature)
export async function loginWithPasskey(checkIsPasskey?: (passkeyAddress: `0x${string}`) => Promise<boolean>): Promise<{
  credentialId: string;
  qx: `0x${string}`;
  qy: `0x${string}`;
  passkeyAddress: `0x${string}`;
}> {
  console.log("[loginWithPasskey] Starting login flow...");

  // First signature to get candidates
  const challenge1 = generateChallenge();
  console.log("[loginWithPasskey] Challenge 1:", bufferToHex(challenge1.buffer as ArrayBuffer));

  const credential1 = (await navigator.credentials.get({
    publicKey: {
      challenge: challenge1,
      rpId: window.location.hostname,
      userVerification: "required",
      timeout: 60000,
    },
  })) as PublicKeyCredential;

  if (!credential1) {
    throw new Error("No credential returned");
  }

  const response1 = credential1.response as AuthenticatorAssertionResponse;
  const credentialId = bytesToBase64url(new Uint8Array(credential1.rawId));
  console.log("[loginWithPasskey] Credential ID:", credentialId);

  // Parse signature and recover candidates
  const sig1 = parseSignature(new Uint8Array(response1.signature));
  console.log("[loginWithPasskey] Signature 1 - r:", sig1.r);
  console.log("[loginWithPasskey] Signature 1 - s:", sig1.s);

  const message1 = await computeWebAuthnMessage(response1.authenticatorData, response1.clientDataJSON);
  console.log("[loginWithPasskey] Message 1 hash:", bufferToHex(message1.buffer as ArrayBuffer));

  const candidates = await recoverPublicKeyCandidates(sig1.r, sig1.s, message1);
  console.log("[loginWithPasskey] Recovered", candidates.length, "candidates from first signature:");
  candidates.forEach((c, i) => {
    console.log(`  Candidate ${i}: qx=${c.qx.slice(0, 20)}... qy=${c.qy.slice(0, 20)}...`);
  });

  // Self-test: verify each candidate against signature 1 (at least one should pass)
  console.log("[loginWithPasskey] Self-test: verifying candidates against signature 1...");
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const selfTestResult = await verifySignature(candidate.qx, candidate.qy, sig1.r, sig1.s, message1);
    console.log(`[loginWithPasskey] Self-test candidate ${i}:`, selfTestResult);
  }

  // If we have a checkIsPasskey function, try single-signature login
  if (checkIsPasskey) {
    for (const candidate of candidates) {
      const passkeyAddress = derivePasskeyAddress(candidate.qx, candidate.qy);
      const isRegistered = await checkIsPasskey(passkeyAddress);
      if (isRegistered) {
        console.log("[loginWithPasskey] Found registered passkey via single signature!");
        return {
          credentialId,
          qx: candidate.qx,
          qy: candidate.qy,
          passkeyAddress,
        };
      }
    }
  }

  // Need second signature to determine correct public key
  console.log("[loginWithPasskey] Requesting second signature...");
  const challenge2 = generateChallenge();
  console.log("[loginWithPasskey] Challenge 2:", bufferToHex(challenge2.buffer as ArrayBuffer));

  const credential2 = (await navigator.credentials.get({
    publicKey: {
      challenge: challenge2,
      rpId: window.location.hostname,
      userVerification: "required",
      timeout: 60000,
      allowCredentials: [
        {
          type: "public-key",
          id: credential1.rawId,
        },
      ],
    },
  })) as PublicKeyCredential;

  if (!credential2) {
    throw new Error("No credential returned for second signature");
  }

  const response2 = credential2.response as AuthenticatorAssertionResponse;
  const sig2 = parseSignature(new Uint8Array(response2.signature));
  console.log("[loginWithPasskey] Signature 2 - r:", sig2.r);
  console.log("[loginWithPasskey] Signature 2 - s:", sig2.s);

  const message2 = await computeWebAuthnMessage(response2.authenticatorData, response2.clientDataJSON);
  console.log("[loginWithPasskey] Message 2 hash:", bufferToHex(message2.buffer as ArrayBuffer));

  // Verify each candidate against second signature
  console.log("[loginWithPasskey] Verifying candidates against second signature...");
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    console.log(`[loginWithPasskey] Testing candidate ${i}...`);
    const isValid = await verifySignature(candidate.qx, candidate.qy, sig2.r, sig2.s, message2);
    console.log(`[loginWithPasskey] Candidate ${i} valid:`, isValid);
    if (isValid) {
      const passkeyAddress = derivePasskeyAddress(candidate.qx, candidate.qy);
      console.log("[loginWithPasskey] SUCCESS! Found matching public key, passkeyAddress:", passkeyAddress);
      return {
        credentialId,
        qx: candidate.qx,
        qy: candidate.qy,
        passkeyAddress,
      };
    }
  }

  console.error("[loginWithPasskey] FAILED - No candidate verified against second signature");
  console.error("[loginWithPasskey] This could mean:");
  console.error("  1. The two signatures were from different passkeys");
  console.error("  2. There's a bug in signature parsing or message computation");
  console.error("  3. The recovery algorithm is missing valid candidates");
  throw new Error("Failed to recover public key from signatures");
}

// Sign with passkey
export async function signWithPasskey(
  credentialId: string,
  challenge: Uint8Array,
): Promise<{
  auth: WebAuthnAuth;
}> {
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: window.location.hostname,
      userVerification: "required",
      timeout: 60000,
      allowCredentials: [
        {
          type: "public-key",
          id: base64urlToBytes(credentialId),
        },
      ],
    },
  })) as PublicKeyCredential;

  if (!credential) {
    throw new Error("No credential returned");
  }

  const response = credential.response as AuthenticatorAssertionResponse;

  // Parse signature
  const sig = parseSignature(new Uint8Array(response.signature));

  // Normalize s to low-s form if needed
  let s = BigInt(sig.s);
  if (s > P256_CURVE_ORDER / 2n) {
    s = P256_CURVE_ORDER - s;
  }

  const clientDataJSON = new TextDecoder().decode(response.clientDataJSON);

  // Find challenge index in clientDataJSON
  const challengeIndex = clientDataJSON.indexOf('"challenge"');
  const typeIndex = clientDataJSON.indexOf('"type"');

  return {
    auth: {
      authenticatorData: bufferToHex(response.authenticatorData),
      clientDataJSON,
      challengeIndex: BigInt(challengeIndex),
      typeIndex: BigInt(typeIndex),
      r: sig.r,
      s: `0x${s.toString(16).padStart(64, "0")}` as `0x${string}`,
    },
  };
}

// Parse DER-encoded ECDSA signature
function parseSignature(sig: Uint8Array): { r: `0x${string}`; s: `0x${string}` } {
  // DER format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
  let offset = 0;

  if (sig[offset++] !== 0x30) throw new Error("Invalid signature format");
  offset++; // Skip total length

  if (sig[offset++] !== 0x02) throw new Error("Invalid r marker");
  const rLen = sig[offset++];
  let r = sig.slice(offset, offset + rLen);
  offset += rLen;

  // Remove leading zero if present
  if (r[0] === 0 && r.length > 32) {
    r = r.slice(1);
  }
  // Pad to 32 bytes if needed
  if (r.length < 32) {
    const padded = new Uint8Array(32);
    padded.set(r, 32 - r.length);
    r = padded;
  }

  if (sig[offset++] !== 0x02) throw new Error("Invalid s marker");
  const sLen = sig[offset++];
  let s = sig.slice(offset, offset + sLen);

  // Remove leading zero if present
  if (s[0] === 0 && s.length > 32) {
    s = s.slice(1);
  }
  // Pad to 32 bytes if needed
  if (s.length < 32) {
    const padded = new Uint8Array(32);
    padded.set(s, 32 - s.length);
    s = padded;
  }

  return {
    r: bufferToHex(r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength)),
    s: bufferToHex(s.buffer.slice(s.byteOffset, s.byteOffset + s.byteLength)),
  };
}

// Compute WebAuthn message hash (sha256(authenticatorData || sha256(clientDataJSON)))
async function computeWebAuthnMessage(authData: ArrayBuffer, clientDataJSON: ArrayBuffer): Promise<Uint8Array> {
  const clientDataHash = await crypto.subtle.digest("SHA-256", clientDataJSON);
  const combined = new Uint8Array(authData.byteLength + clientDataHash.byteLength);
  combined.set(new Uint8Array(authData), 0);
  combined.set(new Uint8Array(clientDataHash), authData.byteLength);
  const messageHash = await crypto.subtle.digest("SHA-256", combined);
  return new Uint8Array(messageHash);
}

// Recover public key candidates from signature
async function recoverPublicKeyCandidates(
  r: `0x${string}`,
  s: `0x${string}`,
  message: Uint8Array,
): Promise<Array<{ qx: `0x${string}`; qy: `0x${string}` }>> {
  const rBigInt = BigInt(r);
  const sBigInt = BigInt(s);
  const candidates: Array<{ qx: `0x${string}`; qy: `0x${string}` }> = [];

  console.log("[recoverPublicKeyCandidates] r:", r);
  console.log("[recoverPublicKeyCandidates] s:", s);
  console.log("[recoverPublicKeyCandidates] message length:", message.length);

  // Try both s values (original and flipped for malleability)
  const sValues = [sBigInt, P256_CURVE_ORDER - sBigInt];

  for (let sIdx = 0; sIdx < sValues.length; sIdx++) {
    const tryS = sValues[sIdx];
    for (const recovery of [0, 1]) {
      try {
        const sig = new p256.Signature(rBigInt, tryS, recovery);
        const pubKey = sig.recoverPublicKey(message);
        const hex = pubKey.toHex(false); // uncompressed: 04 || x || y
        console.log(`[recoverPublicKeyCandidates] sIdx=${sIdx} recovery=${recovery} SUCCESS: ${hex.slice(0, 40)}...`);
        const qx = `0x${hex.slice(2, 66)}` as `0x${string}`;
        const qy = `0x${hex.slice(66)}` as `0x${string}`;
        candidates.push({ qx, qy });
      } catch (e) {
        console.log(`[recoverPublicKeyCandidates] sIdx=${sIdx} recovery=${recovery} FAILED:`, (e as Error).message);
      }
    }
  }
  console.log("[recoverPublicKeyCandidates] Total candidates:", candidates.length);
  return candidates;
}

// Verify signature with public key using @noble/curves (avoids double-hashing issue with Web Crypto)
async function verifySignature(
  qx: `0x${string}`,
  qy: `0x${string}`,
  r: `0x${string}`,
  s: `0x${string}`,
  message: Uint8Array,
): Promise<boolean> {
  try {
    // Build uncompressed public key: 04 || x || y
    const pubKeyBytes = new Uint8Array(65);
    pubKeyBytes[0] = 0x04;
    pubKeyBytes.set(hexToBytes(qx), 1);
    pubKeyBytes.set(hexToBytes(qy), 33);

    const rBytes = hexToBytes(r);
    const sBigInt = BigInt(s);

    console.log("[verifySignature] pubKey:", bufferToHex(pubKeyBytes.buffer as ArrayBuffer).slice(0, 40) + "...");
    console.log("[verifySignature] sig r:", r.slice(0, 20) + "...");
    console.log("[verifySignature] sig s:", s.slice(0, 20) + "...");
    console.log("[verifySignature] s > n/2:", sBigInt > P256_CURVE_ORDER / 2n);
    // Use slice to get only the view's bytes, not the whole underlying buffer
    const msgHex = Array.from(message)
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
    console.log("[verifySignature] message (", message.length, "bytes):", `0x${msgHex}`);

    // Try both s values (original and low-s normalized) since WebAuthn may return high-s
    const sValuesToTry = [sBigInt];
    if (sBigInt > P256_CURVE_ORDER / 2n) {
      // Normalize to low-s
      sValuesToTry.push(P256_CURVE_ORDER - sBigInt);
    } else {
      // Also try high-s version
      sValuesToTry.push(P256_CURVE_ORDER - sBigInt);
    }

    for (const tryS of sValuesToTry) {
      const trySBytes = new Uint8Array(32);
      const trySHex = tryS.toString(16).padStart(64, "0");
      for (let i = 0; i < 32; i++) {
        trySBytes[i] = parseInt(trySHex.slice(i * 2, i * 2 + 2), 16);
      }

      // Build signature as 64-byte r||s concatenation (compact format)
      const sigBytes = new Uint8Array(64);
      sigBytes.set(rBytes, 0);
      sigBytes.set(trySBytes, 32);

      // p256.verify with prehash: false since message is already hashed, lowS: false to accept both
      const result = p256.verify(sigBytes, message, pubKeyBytes, { prehash: false, lowS: false });
      console.log("[verifySignature] tryS:", `0x${trySHex.slice(0, 16)}...`, "result:", result);
      if (result) {
        return true;
      }
    }
    return false;
  } catch (e) {
    console.error("[verifySignature] Error:", e);
    return false;
  }
}

// Build challenge hash for single transaction
export function buildChallengeHash(
  chainId: bigint,
  wallet: `0x${string}`,
  target: `0x${string}`,
  value: bigint,
  data: `0x${string}`,
  nonce: bigint,
  deadline: bigint,
): `0x${string}` {
  const innerHash = keccak256(
    concat([
      pad(toHex(chainId), { size: 32 }),
      wallet,
      target,
      pad(toHex(value), { size: 32 }),
      data,
      pad(toHex(nonce), { size: 32 }),
      pad(toHex(deadline), { size: 32 }),
    ]),
  );
  return innerHash;
}

// Build challenge hash for batch transaction
export function buildBatchChallengeHash(
  chainId: bigint,
  wallet: `0x${string}`,
  calls: Array<{ target: `0x${string}`; value: bigint; data: `0x${string}` }>,
  nonce: bigint,
  deadline: bigint,
): `0x${string}` {
  // Encode calls the same way Solidity does with abi.encode
  const callsEncoded = calls.map(c => concat([c.target, pad(toHex(c.value), { size: 32 }), c.data]));
  const callsHash = keccak256(concat(callsEncoded));

  const innerHash = keccak256(
    concat([
      pad(toHex(chainId), { size: 32 }),
      wallet,
      callsHash,
      pad(toHex(nonce), { size: 32 }),
      pad(toHex(deadline), { size: 32 }),
    ]),
  );
  return innerHash;
}

// Local storage helpers
const PASSKEY_STORAGE_PREFIX = "psc-passkey-";

export function savePasskeyToStorage(walletAddress: string, passkey: StoredPasskey): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(`${PASSKEY_STORAGE_PREFIX}${walletAddress.toLowerCase()}`, JSON.stringify(passkey));
}

export function getPasskeyFromStorage(walletAddress: string): StoredPasskey | null {
  if (typeof window === "undefined") return null;
  const data = localStorage.getItem(`${PASSKEY_STORAGE_PREFIX}${walletAddress.toLowerCase()}`);
  if (!data) return null;
  try {
    return JSON.parse(data) as StoredPasskey;
  } catch {
    return null;
  }
}

export function clearPasskeyFromStorage(walletAddress: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(`${PASSKEY_STORAGE_PREFIX}${walletAddress.toLowerCase()}`);
}
