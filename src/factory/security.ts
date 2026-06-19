/**
 * Security and Encryption Core (Titanium Standard)
 */

/**
 * Derives a 256-bit key from the TITANIUM_API_SECRET using PBKDF2.
 * SHA-256, 100,000 iterations, fixed salt.
 */
export async function deriveKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("buildborgbot-v1"),
      iterations: 100000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypts a plaintext string using AES-GCM-256.
 * Returns { ciphertext, iv } in Base64.
 */
export async function encrypt(
  plaintext: string,
  key: CryptoKey,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );

  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

/**
 * Decrypts a Base64 ciphertext using AES-GCM-256 and Base64 IV.
 */
export async function decrypt(
  ciphertextBase64: string,
  ivBase64: string,
  key: CryptoKey,
): Promise<string> {
  const iv = Uint8Array.from(atob(ivBase64), (c) => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(ciphertextBase64), (c) =>
    c.charCodeAt(0),
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Constant-time comparison to prevent timing attacks.
 * Uses a double-hmac or padding approach to avoid length leaks.
 */
export function timingSafeEqual(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const lenA = a.length;
  const lenB = b.length;

  // We compare up to the max length to avoid early return on length mismatch.
  // However, charCodeAt on undefined will return NaN which we handle with || 0.
  let result = lenA ^ lenB;
  const maxLen = Math.max(lenA, lenB);

  for (let i = 0; i < maxLen; i++) {
    const charA = i < lenA ? a.charCodeAt(i) : 0;
    const charB = i < lenB ? b.charCodeAt(i) : 0;
    result |= charA ^ charB;
  }
  return result === 0;
}

/**
 * Generates an HMAC-SHA256 signature (truncated to 8 hex chars).
 */
export async function generateSignature(
  data: string,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(signature));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hashHex.substring(0, 8);
}
