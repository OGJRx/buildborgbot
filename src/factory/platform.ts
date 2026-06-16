/**
 * Idempotency Check (Titanium Standard)
 */

export async function isUpdateProcessed(
  db: D1Database,
  botId: string,
  updateId: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT 1 FROM factory_processed_updates WHERE bot_id = ? AND update_id = ?",
    )
    .bind(botId, updateId)
    .first();
  return !!row;
}

export async function markUpdateProcessed(
  db: D1Database,
  botId: string,
  updateId: number,
) {
  return db
    .prepare(
      "INSERT INTO factory_processed_updates (bot_id, update_id, processed_at) VALUES (?, ?, ?)",
    )
    .bind(botId, updateId, Date.now());
}

/**
 * Lazy cleanup of old processed updates (> 24h).
 */
export async function cleanupProcessedUpdates(db: D1Database) {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  await db
    .prepare("DELETE FROM factory_processed_updates WHERE processed_at < ?")
    .bind(oneDayAgo)
    .run();
}

/**
 * Platform Config / Admin Check
 */
export async function isAdmin(
  db: D1Database,
  env: { ADMIN_TELEGRAM_IDS?: string },
  userId: number,
): Promise<boolean> {
  const envAdmins = (env.ADMIN_TELEGRAM_IDS || "").split(",");

  const dbAdminsRow = await db
    .prepare(
      "SELECT value FROM factory_platform_config WHERE key = 'admin_telegram_ids'",
    )
    .first<{ value: string }>();

  const dbAdmins = (dbAdminsRow?.value || "").split(",");

  const allAdmins = [...envAdmins, ...dbAdmins].map((id) => id.trim());
  return allAdmins.includes(String(userId));
}
