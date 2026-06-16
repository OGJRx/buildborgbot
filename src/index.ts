import type { Update } from "grammy/types";
import { handleUpdate } from "./factory/engine";
import { cleanupProcessedUpdates, isUpdateProcessed } from "./factory/platform";
import {
  ConfigSchema,
  MemoryQuerySchema,
  PatchConfigSchema,
  SequenceSchema,
  SummarizeSchema,
  TelegramUpdateSchema,
} from "./factory/schemas";
import {
  decrypt,
  deriveKey,
  encrypt,
  timingSafeEqual,
} from "./factory/security";
import { summarizeConversation } from "./factory/summarize";
import type { CoreEnv } from "./factory/types";

export default {
  async fetch(
    request: Request,
    env: CoreEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Health Check
    if (url.pathname === "/api/health") {
      try {
        await env.DB.prepare("SELECT 1").run();
        return Response.json({ status: "ok", db: "ok" });
      } catch (e) {
        console.error("Health check DB error:", e);
        return Response.json({ status: "error", db: "error" }, { status: 503 });
      }
    }

    // --- Webhook Route (Titanium Slug-based) ---
    if (url.pathname.startsWith("/webhook/")) {
      const slug = url.pathname.split("/")[2];
      if (!slug) return new Response("slug required", { status: 400 });

      const incomingSecret = request.headers.get(
        "X-Telegram-Bot-Api-Secret-Token",
      );
      if (!incomingSecret)
        return new Response("Forbidden: Secret missing", { status: 403 });

      // Lookup bot by slug
      const botConfig = await env.DB.prepare(
        "SELECT bot_id, token, token_iv, webhook_secret FROM factory_bots WHERE slug = ?",
      )
        .bind(slug)
        .first<{
          bot_id: string;
          token: string | null;
          token_iv: string | null;
          webhook_secret: string;
        }>();

      if (!botConfig) return new Response("Bot not found", { status: 404 });

      // Validate webhook secret (Timing-safe comparison)
      if (!timingSafeEqual(incomingSecret, botConfig.webhook_secret)) {
        return new Response("Forbidden: Invalid secret", { status: 403 });
      }

      const body = await request.json();
      const update = TelegramUpdateSchema.parse(body) as Update;

      // Idempotency Check
      if (await isUpdateProcessed(env.DB, botConfig.bot_id, update.update_id)) {
        return new Response("OK (already processed)");
      }

      // Decrypt token
      let token: string;
      if (botConfig.token && botConfig.token_iv) {
        const key = await deriveKey(env.TITANIUM_API_SECRET);
        token = await decrypt(botConfig.token, botConfig.token_iv, key);
      } else {
        return new Response("Internal configuration error: Token missing", {
          status: 500,
        });
      }

      // Cleanup old updates (lazy)
      ctx.waitUntil(cleanupProcessedUpdates(env.DB));

      return await handleUpdate(
        botConfig.bot_id,
        token,
        update,
        env,
        ctx.waitUntil.bind(ctx),
        request.headers.get("host") || "unknown",
      );
    }

    // --- Migration API ---
    if (
      url.pathname === "/api/factory/migrate-tokens" &&
      request.method === "POST"
    ) {
      if (request.headers.get("x-migration-key") !== env.MIGRATION_KEY) {
        return new Response("Unauthorized", { status: 401 });
      }

      const bots = await env.DB.prepare(
        "SELECT bot_id, token_var_name, slug FROM factory_bots",
      ).all<{ bot_id: string; token_var_name: string; slug: string }>();
      const key = await deriveKey(env.TITANIUM_API_SECRET);

      const statements = [];
      for (const bot of bots.results || []) {
        const token = env.BOT_TOKENS[bot.token_var_name];
        if (token) {
          const { ciphertext, iv } = await encrypt(token, key);
          const webhookSecret = crypto.randomUUID();
          const slug = bot.slug || `bot-${bot.bot_id.substring(0, 8)}`;

          statements.push(
            env.DB.prepare(
              "UPDATE factory_bots SET token = ?, token_iv = ?, slug = ?, webhook_secret = ? WHERE bot_id = ?",
            ).bind(ciphertext, iv, slug, webhookSecret, bot.bot_id),
          );
        }
      }

      if (statements.length > 0) {
        await env.DB.batch(statements);
      }

      return Response.json({ success: true, migrated: statements.length });
    }

    // --- Platform Admins API ---
    if (url.pathname === "/api/factory/admins") {
      if (
        request.headers.get("x-titanium-api-secret") !== env.TITANIUM_API_SECRET
      ) {
        return new Response("Unauthorized", { status: 401 });
      }

      if (request.method === "GET") {
        const row = await env.DB.prepare(
          "SELECT value FROM factory_platform_config WHERE key = 'admin_telegram_ids'",
        ).first<{ value: string }>();
        return Response.json({ admins: row?.value || "" });
      }

      if (request.method === "POST") {
        const body = (await request.json()) as { admins: string };
        await env.DB.prepare(
          "INSERT INTO factory_platform_config (key, value) VALUES ('admin_telegram_ids', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
          .bind(body.admins)
          .run();
        return Response.json({ success: true });
      }
    }

    // --- Config API ---
    if (url.pathname === "/api/factory/config" && request.method === "POST") {
      if (
        request.headers.get("x-titanium-api-secret") !== env.TITANIUM_API_SECRET
      ) {
        return new Response("Unauthorized", { status: 401 });
      }

      const body = await request.json();
      const validated = ConfigSchema.parse(body);

      const existing = await env.DB.prepare(
        "SELECT slug, webhook_secret FROM factory_bots WHERE bot_id = ?",
      )
        .bind(validated.bot_id)
        .first<{ slug: string; webhook_secret: string }>();

      const slug = existing?.slug || validated.bot_id;
      const webhookSecret = existing?.webhook_secret || crypto.randomUUID();

      await env.DB.prepare(
        "INSERT INTO factory_bots (bot_id, bot_name, token_var_name, system_prompt, welcome_message, menu_json, slug, webhook_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(bot_id) DO UPDATE SET bot_name=excluded.bot_name, token_var_name=excluded.token_var_name, system_prompt=excluded.system_prompt, welcome_message=excluded.welcome_message, menu_json=excluded.menu_json, updated_at=CURRENT_TIMESTAMP",
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
        )
        .run();

      // Auto-setWebhook para bots nuevos (cuando no tiene token en D1 aún)
      const isNewBot = !existing;
      if (isNewBot && validated.token_var_name) {
        const plainToken = env.BOT_TOKENS[validated.token_var_name];
        if (plainToken && webhookSecret) {
          const workerUrl = `https://${request.headers.get("host") || "unknown"}`;
          const webhookUrl = `${workerUrl}/webhook/${slug}`;
          const telegramApiUrl = `https://api.telegram.org/bot${plainToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}&secret_token=${webhookSecret}`;

          try {
            const tgRes = await fetch(telegramApiUrl);
            const tgData = (await tgRes.json()) as {
              ok: boolean;
              description?: string;
            };
            if (!tgData.ok) {
              console.error(
                `Webhook setup failed for ${validated.bot_id}: ${tgData.description}`,
              );
            }
          } catch (webhookErr) {
            console.error(
              `Webhook setup error for ${validated.bot_id}:`,
              webhookErr,
            );
          }
        }
      }

      return Response.json({ success: true });
    }

    // --- Memory API ---
    if (url.pathname === "/api/factory/memory") {
      if (
        request.headers.get("x-titanium-api-secret") !== env.TITANIUM_API_SECRET
      ) {
        return new Response("Unauthorized", { status: 401 });
      }

      if (request.method === "GET") {
        const params = Object.fromEntries(url.searchParams);
        const { bot_id, chat_id, cursor, limit } =
          MemoryQuerySchema.parse(params);

        let query =
          "SELECT bot_id, chat_id, message_id, role, content, created_at FROM factory_messages WHERE bot_id = ? AND chat_id = ?";
        const bindings: (string | number)[] = [bot_id, chat_id];

        if (cursor !== undefined) {
          query += " AND message_id < ?";
          bindings.push(cursor);
        }

        query += " ORDER BY message_id DESC LIMIT ?";
        bindings.push(limit + 1);

        const messages = await env.DB.prepare(query)
          .bind(...bindings)
          .all<{ message_id: number }>();
        const results = messages.results || [];
        const hasMore = results.length > limit;
        if (hasMore) results.pop();

        const lastItem = results[results.length - 1];
        const nextCursor = hasMore && lastItem ? lastItem.message_id : null;

        return Response.json({ results, hasMore, nextCursor });
      }

      if (request.method === "DELETE") {
        const botId = url.searchParams.get("bot_id");
        const chatId = url.searchParams.get("chat_id");
        const includeSummary =
          url.searchParams.get("include_summary") === "true";

        if (!botId || !chatId) {
          return Response.json(
            { error: "bot_id and chat_id required" },
            { status: 400 },
          );
        }

        let query =
          "DELETE FROM factory_messages WHERE bot_id = ? AND chat_id = ?";
        if (!includeSummary) {
          query += " AND message_id != 0";
        }

        await env.DB.prepare(query).bind(botId, chatId).run();
        return Response.json({ success: true });
      }
    }

    // --- Summarize API ---
    if (
      url.pathname === "/api/factory/memory/summarize" &&
      request.method === "POST"
    ) {
      if (
        request.headers.get("x-titanium-api-secret") !== env.TITANIUM_API_SECRET
      ) {
        return new Response("Unauthorized", { status: 401 });
      }

      const body = await request.json();
      const { bot_id, chat_id, mode, manual_summary } =
        SummarizeSchema.parse(body);

      try {
        const summary = await summarizeConversation(
          env.DB,
          bot_id,
          chat_id,
          env,
          mode === "manual" ? manual_summary : undefined,
        );
        return Response.json({ success: true, summary });
      } catch (err) {
        return Response.json(
          { error: String(err) },
          { status: mode === "manual" && !manual_summary ? 400 : 500 },
        );
      }
    }

    // --- Sequences API ---
    if (url.pathname === "/api/factory/sequences") {
      if (
        request.headers.get("x-titanium-api-secret") !== env.TITANIUM_API_SECRET
      ) {
        return new Response("Unauthorized", { status: 401 });
      }

      if (request.method === "GET") {
        const botId = url.searchParams.get("bot_id");
        if (!botId)
          return Response.json({ error: "bot_id required" }, { status: 400 });

        const sequences = await env.DB.prepare(
          "SELECT step_number, title, description, payload_json, created_at FROM factory_sequences WHERE bot_id = ? ORDER BY title ASC, step_number ASC",
        )
          .bind(botId)
          .all();
        return Response.json(sequences.results);
      }

      if (request.method === "POST") {
        const body = await request.json();
        const validated = SequenceSchema.parse(body);

        await env.DB.prepare(
          "INSERT INTO factory_sequences (bot_id, step_number, title, description, payload_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(bot_id, title, step_number) DO UPDATE SET description=excluded.description, payload_json=excluded.payload_json, created_at=CURRENT_TIMESTAMP",
        )
          .bind(
            validated.bot_id,
            validated.step_number,
            validated.title,
            validated.description,
            validated.payload_json,
          )
          .run();
        return Response.json({ success: true });
      }
    }

    // --- Bots API ---
    if (url.pathname === "/api/factory/bots" && request.method === "GET") {
      if (
        request.headers.get("x-titanium-api-secret") !== env.TITANIUM_API_SECRET
      ) {
        return new Response("Unauthorized", { status: 401 });
      }
      const bots = await env.DB.prepare(
        "SELECT bot_id, bot_name, token_var_name, system_prompt, welcome_message, menu_json, slug FROM factory_bots",
      ).all();
      return Response.json(bots.results);
    }

    if (url.pathname.startsWith("/api/factory/bots/")) {
      if (
        request.headers.get("x-titanium-api-secret") !== env.TITANIUM_API_SECRET
      ) {
        return new Response("Unauthorized", { status: 401 });
      }
      const botId = url.pathname.split("/")[4];
      if (!botId) return new Response("bot_id required", { status: 400 });

      if (request.method === "DELETE") {
        await env.DB.batch([
          env.DB.prepare("DELETE FROM factory_sessions WHERE key LIKE ?").bind(
            `${botId}:%`,
          ),
          env.DB.prepare(
            "DELETE FROM factory_callback_tokens WHERE bot_id = ?",
          ).bind(botId),
          env.DB.prepare(
            "DELETE FROM factory_processed_updates WHERE bot_id = ?",
          ).bind(botId),
          env.DB.prepare(
            "DELETE FROM factory_circuit_breaker WHERE bot_id = ?",
          ).bind(botId),
          env.DB.prepare("DELETE FROM factory_bots WHERE bot_id = ?").bind(
            botId,
          ),
        ]);
        return Response.json({ success: true });
      }

      if (request.method === "PATCH") {
        const body = await request.json();
        const validated = PatchConfigSchema.parse(body);

        const updates: string[] = [];
        const values: (string | undefined)[] = [];

        Object.entries(validated).forEach(([key, value]) => {
          if (value !== undefined) {
            updates.push(`${key} = ?`);
            values.push(value);
          }
        });

        if (updates.length === 0) return Response.json({ success: true });

        values.push(botId);
        await env.DB.prepare(
          `UPDATE factory_bots SET ${updates.join(", ")}, updated_at=CURRENT_TIMESTAMP WHERE bot_id = ?`,
        )
          .bind(...values)
          .run();

        return Response.json({ success: true });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};
