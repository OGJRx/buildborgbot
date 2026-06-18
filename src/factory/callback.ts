import { generateSignature } from "./security";

/**
 * Callback Pointer System (Titanium Standard)
 * Pattern: s:{sig8}:{ref}
 */

export interface CallbackData {
  bot_id: string;
  action: string;
  payload: string;
}

/**
 * Creates a signed callback pointer and stores the payload in D1.
 */
export async function buildCallback(
  db: D1Database,
  apiSecret: string,
  data: CallbackData,
  ttlSeconds = 86400,
): Promise<string> {
  // Insert into D1 to get the reference (ID) using SQLite's unixepoch
  const result = await db
    .prepare(
      "INSERT INTO factory_callback_tokens (bot_id, action, payload, created_at, expires_at) VALUES (?, ?, ?, unixepoch(), unixepoch() + ?)",
    )
    .bind(data.bot_id, data.action, data.payload, ttlSeconds)
    .run();

  const ref = result.meta.last_row_id;

  // HMAC calculated over: ref + bot_id + action + payload
  const sigInput = `${ref}${data.bot_id}${data.action}${data.payload}`;
  const sig8 = await generateSignature(sigInput, apiSecret);

  return `s:${sig8}:${ref}`;
}

/**
 * Parses and validates a callback pointer.
 * Returns the full CallbackData if valid, or null if invalid/expired.
 */
export async function parseCallback(
  db: D1Database,
  apiSecret: string,
  botId: string,
  callbackString: string,
): Promise<CallbackData | null> {
  if (!callbackString.startsWith("s:")) return null;

  const parts = callbackString.split(":");
  if (parts.length !== 3) return null;

  const sig8 = parts[1];
  const refStr = parts[2];
  const ref = Number.parseInt(refStr || "", 10);
  if (Number.isNaN(ref)) return null;

  // Fetch from D1
  const row = await db
    .prepare(
      "SELECT bot_id, action, payload, expires_at FROM factory_callback_tokens WHERE id = ?",
    )
    .bind(ref)
    .first<{
      bot_id: string;
      action: string;
      payload: string;
      expires_at: number;
    }>();

  if (!row) return null;

  // Multi-tenant isolation: check bot_id
  if (row.bot_id !== botId) return null;

  // Check expiration (row.expires_at is in seconds from unixepoch())
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds > row.expires_at) return null;

  // Validate signature
  const sigInput = `${ref}${row.bot_id}${row.action}${row.payload}`;
  const expectedSig8 = await generateSignature(sigInput, apiSecret);

  if (sig8 !== expectedSig8) return null;

  return {
    bot_id: row.bot_id,
    action: row.action,
    payload: row.payload,
  };
}

/**
 * Lazy cleanup of expired callback tokens.
 */
export async function cleanupExpiredCallbacks(db: D1Database): Promise<void> {
  await db
    .prepare(
      "DELETE FROM factory_callback_tokens WHERE expires_at < unixepoch()",
    )
    .run();
}
