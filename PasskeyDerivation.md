# Passkey Public Key Recovery via Two Signatures

## The Problem

WebAuthn passkeys only expose the public key (Qx, Qy) during credential creation. After that, you can't get it back - the API only returns signatures.

## The Solution

**ECDSA signature recovery.** Given any ECDSA signature (r, s) and the message that was signed, you can mathematically recover candidate public keys that could have produced that signature.

### Why "candidates"?

On the P-256 curve, a single signature produces up to 4 possible public keys:

- **2 recovery bit values (0 or 1)** - the y-coordinate parity
- **2 S values (s and n-s)** - due to ECDSA signature malleability

## The Two-Signature Trick

1. **First signature:** User authenticates with their passkey (random challenge). Parse the DER signature to get (r, s). Compute `message = sha256(authenticatorData || sha256(clientDataJSON))`. Use `sig.recoverPublicKey(message)` for all 4 combinations → get up to 4 candidate (Qx, Qy) pairs.

2. **Second signature:** Request another signature with a different random challenge (same credential via `allowCredentials`).

3. **Verify:** For each candidate from step 1, verify if it validates the second signature using `p256.verify()`. Only the real public key will verify both signatures.

## Key Code (using @noble/curves)

```typescript
import { p256 } from "@noble/curves/p256";
import { sha256 } from "@noble/hashes/sha256";

const P256_CURVE_ORDER =
  0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

// From signature, recover candidates
const sValues = [s, P256_CURVE_ORDER - s]; // original and flipped

for (const tryS of sValues) {
  for (const recovery of [0, 1]) {
    const sig = new p256.Signature(r, tryS, recovery);
    const pubKey = sig.recoverPublicKey(message); // 65 bytes: 04 || x || y
    candidates.push(pubKey);
  }
}

// Verify with second signature
for (const candidate of candidates) {
  if (p256.verify(sig2Bytes, message2, candidate)) {
    return candidate; // This is the real public key!
  }
}
```

## Credential ID

This is just `credential.rawId` from the WebAuthn response (available on every signature). Hash it with `keccak256` for on-chain use.
