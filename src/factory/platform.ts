import { decrypt, deriveKey, encrypt } from "./security";
import type { CoreEnv } from "./types";

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
      "INSERT INTO factory_processed_updates (bot_id, update_id, processed_at) VALUES (?, ?, unixepoch())",
    )
    .bind(botId, updateId);
}

/**
 * Lazy cleanup of old processed updates (> 24h).
 */
export async function cleanupProcessedUpdates(db: D1Database) {
  await db
    .prepare(
      "DELETE FROM factory_processed_updates WHERE processed_at < unixepoch('now', '-1 day')",
    )
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

/**
 * Upsert Bot Configuration (Internal Service)
 */
export async function upsertBotConfig(
  db: D1Database,
  env: CoreEnv,
  validated: {
    bot_id: string;
    bot_name: string;
    token_var_name: string;
    system_prompt: string;
    welcome_message: string;
    menu_json: string;
    token?: string | undefined;
  },
  host: string,
): Promise<{
  success: boolean;
  webhook_ok?: boolean | undefined;
  webhook_error?: string | undefined;
  error?: string | undefined;
}> {
  const existing = await db
    .prepare(
      "SELECT slug, webhook_secret, token, token_iv FROM factory_bots WHERE bot_id = ?",
    )
    .bind(validated.bot_id)
    .first<{
      slug: string;
      webhook_secret: string;
      token: string | null;
      token_iv: string | null;
    }>();

  const slug = existing?.slug || validated.bot_id;
  const webhookSecret = existing?.webhook_secret || crypto.randomUUID();

  let tokenCiphertext = existing?.token || null;
  let tokenIv = existing?.token_iv || null;

  const key = await deriveKey(env.TITANIUM_API_SECRET);

  if (validated.token) {
    const encrypted = await encrypt(validated.token, key);
    tokenCiphertext = encrypted.ciphertext;
    tokenIv = encrypted.iv;
  }

  await db
    .prepare(
      "INSERT INTO factory_bots (bot_id, bot_name, token_var_name, system_prompt, welcome_message, menu_json, slug, webhook_secret, token, token_iv) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(bot_id) DO UPDATE SET bot_name=excluded.bot_name, token_var_name=excluded.token_var_name, system_prompt=excluded.system_prompt, welcome_message=excluded.welcome_message, menu_json=excluded.menu_json, token=excluded.token, token_iv=excluded.token_iv, updated_at=CURRENT_TIMESTAMP",
    )
    .bind(
      validated.bot_id,
      validated.bot_name,
      validated.token_var_name,
      validated.system_prompt,
      validated.welcome_message,
      validated.menu_json,
      slug,
      webhookSecret,
      tokenCiphertext,
      tokenIv,
    )
    .run();

  // Auto-setWebhook logic
  let plainToken: string | null = null;
  if (tokenCiphertext && tokenIv) {
    plainToken = await decrypt(tokenCiphertext, tokenIv, key);
  } else if (validated.token) {
    plainToken = validated.token;
  }

  let webhook_ok = true;
  let webhook_error: string | undefined;

  if (plainToken && webhookSecret) {
    const webhookUrl = `https://${host}/webhook/${slug}`;
    const telegramApiUrl = `https://api.telegram.org/bot${plainToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}&secret_token=${webhookSecret}&allowed_updates=["message","callback_query"]`;

    try {
      const tgRes = await fetch(telegramApiUrl);
      const tgData = (await tgRes.json()) as {
        ok: boolean;
        description?: string;
      };
      if (tgData.ok) {
        webhook_ok = true;
        try {
          await db
            .prepare(
              "UPDATE factory_bots SET webhook_configured_at = CURRENT_TIMESTAMP, webhook_last_error = NULL WHERE bot_id = ?",
            )
            .bind(validated.bot_id)
            .run();
        } catch (dbErr) {
          console.error(
            `Failed to update webhook success status for ${validated.bot_id}:`,
            dbErr,
          );
        }
      } else {
        webhook_ok = false;
        webhook_error = tgData.description || "Unknown Telegram error";
        console.error(
          `Webhook setup failed for ${validated.bot_id}: ${tgData.description}`,
        );
        try {
          await db
            .prepare(
              "UPDATE factory_bots SET webhook_last_error = ? WHERE bot_id = ?",
            )
            .bind(webhook_error, validated.bot_id)
            .run();
        } catch (dbErr) {
          console.error(
            `Failed to update webhook error status for ${validated.bot_id}:`,
            dbErr,
          );
        }
      }
    } catch (webhookErr) {
      webhook_ok = false;
      webhook_error = String(webhookErr);
      console.error(`Webhook setup error for ${validated.bot_id}:`, webhookErr);
      try {
        await db
          .prepare(
            "UPDATE factory_bots SET webhook_last_error = ? WHERE bot_id = ?",
          )
          .bind(webhook_error, validated.bot_id)
          .run();
      } catch (dbErr) {
        console.error(
          `Failed to update webhook exception status for ${validated.bot_id}:`,
          dbErr,
        );
      }
    }
  }

  return { success: true, webhook_ok, webhook_error };
}
