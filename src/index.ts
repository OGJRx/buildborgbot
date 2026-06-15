import type { Update } from "grammy/types";
import { type CoreEnv, handleUpdate } from "./factory/engine";
import {
  ConfigSchema,
  MemoryQuerySchema,
  PatchConfigSchema,
  SequenceSchema,
  SummarizeSchema,
  TelegramUpdateSchema,
} from "./factory/schemas";
import { summarizeConversation } from "./factory/summarize";

async function hashSecret(secret: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(secret);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

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

    // Webhook Route
    if (url.pathname.startsWith("/webhook/factory/")) {
      const botId = url.pathname.split("/")[3];
      if (!botId) return new Response("bot_id required", { status: 400 });

      const incomingSecret = request.headers.get(
        "X-Telegram-Bot-Api-Secret-Token",
      );
      if (!incomingSecret)
        return new Response("Forbidden: Secret missing", { status: 403 });

      const botConfig = await env.DB.prepare(
        "SELECT webhook_secret_hash FROM factory_bots WHERE bot_id = ?",
      )
        .bind(botId)
        .first<{ webhook_secret_hash: string | null }>();

      if (!botConfig?.webhook_secret_hash) {
        return new Response("Bot not configured for secure webhooks", {
          status: 403,
        });
      }

      const incomingHash = await hashSecret(incomingSecret);
      if (incomingHash !== botConfig.webhook_secret_hash) {
        return new Response("Forbidden: Invalid secret", { status: 403 });
      }

      const body = await request.json();
      const update = TelegramUpdateSchema.parse(body) as Update;
      return await handleUpdate(botId, update, env, ctx.waitUntil.bind(ctx));
    }

    // Config API
    if (url.pathname === "/api/factory/config" && request.method === "POST") {
      if (
        request.headers.get("x-titanium-api-secret") !== env.TITANIUM_API_SECRET
      ) {
        return new Response("Unauthorized", { status: 401 });
      }

      const body = await request.json();
      const validated = ConfigSchema.parse(body);

      await env.DB.prepare(
        "INSERT INTO factory_bots (bot_id, bot_name, token_var_name, system_prompt, welcome_message, menu_json, webhook_secret_hash) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(bot_id) DO UPDATE SET bot_name=excluded.bot_name, token_var_name=excluded.token_var_name, system_prompt=excluded.system_prompt, welcome_message=excluded.welcome_message, menu_json=excluded.menu_json, webhook_secret_hash=COALESCE(excluded.webhook_secret_hash, factory_bots.webhook_secret_hash), updated_at=CURRENT_TIMESTAMP",
      )
        .bind(
          validated.bot_id,
          validated.bot_name,
          validated.token_var_name,
          validated.system_prompt,
          validated.welcome_message,
          validated.menu_json,
          validated.webhook_secret_hash ?? null,
        )
        .run();
      return Response.json({ success: true });
    }

    // Memory API
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

    // Summarize API
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

    // Sequences API
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

    // Bots API
    if (url.pathname === "/api/factory/bots" && request.method === "GET") {
      if (
        request.headers.get("x-titanium-api-secret") !== env.TITANIUM_API_SECRET
      ) {
        return new Response("Unauthorized", { status: 401 });
      }
      const bots = await env.DB.prepare(
        "SELECT bot_id, bot_name, token_var_name, system_prompt, welcome_message, menu_json FROM factory_bots",
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
        await env.DB.prepare("DELETE FROM factory_bots WHERE bot_id = ?")
          .bind(botId)
          .run();
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
