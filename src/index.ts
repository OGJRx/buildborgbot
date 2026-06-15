import { FactoryEngine, CoreEnv, BorgExecutionContext } from "./factory/engine";
import { GoogleGenAI } from "@google/genai";
import { Update } from "grammy/types";
import { z } from "zod";

const ConfigSchema = z.object({
  bot_id: z.string(),
  bot_name: z.string(),
  token_var_name: z.string(),
  system_prompt: z.string(),
  welcome_message: z.string(),
  menu_json: z.string(),
  webhook_secret_hash: z.string().optional(),
});

const PatchConfigSchema = ConfigSchema.partial().omit({ bot_id: true });

const SummarizeSchema = z.object({
  bot_id: z.string(),
  chat_id: z.string(),
  mode: z.enum(["ai", "manual"]),
  manual_summary: z.string().optional(),
});

const MemoryQuerySchema = z.object({
  bot_id: z.string(),
  chat_id: z.string(),
  cursor: z.coerce.number().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
});

const SequenceSchema = z.object({
  bot_id: z.string(),
  step_number: z.number(),
  title: z.string(),
  description: z.string(),
  payload_json: z.string(),
});

async function hashSecret(secret: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(secret);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request: Request, env: CoreEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const borgCtx: BorgExecutionContext = {
      waitUntil: ctx.waitUntil.bind(ctx),
    };

    // Webhook Route
    if (url.pathname.startsWith("/webhook/factory/")) {
      const botId = url.pathname.split("/")[3];
      if (!botId) return new Response("bot_id required", { status: 400 });

      const incomingSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (!incomingSecret) return new Response("Forbidden: Secret missing", { status: 403 });

      const botConfig = await env.DB.prepare(
        "SELECT webhook_secret_hash FROM factory_bots WHERE bot_id = ?"
      )
        .bind(botId)
        .first<{ webhook_secret_hash: string | null }>();

      if (!botConfig || !botConfig.webhook_secret_hash) {
        return new Response("Bot not configured for secure webhooks", { status: 403 });
      }

      const incomingHash = await hashSecret(incomingSecret);
      if (incomingHash !== botConfig.webhook_secret_hash) {
        return new Response("Forbidden: Invalid secret", { status: 403 });
      }

      const update = (await request.json()) as Update;
      return await FactoryEngine.handleUpdate(botId, update, env, borgCtx);
    }

    // Config API
    if (url.pathname === "/api/factory/config" && request.method === "POST") {
      if (request.headers.get("x-titanium-api-secret") !== env.TITANIUM_API_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }

      const body = await request.json();
      const validated = ConfigSchema.parse(body);

      await env.DB.prepare(
        "INSERT INTO factory_bots (bot_id, bot_name, token_var_name, system_prompt, welcome_message, menu_json, webhook_secret_hash) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(bot_id) DO UPDATE SET bot_name=excluded.bot_name, token_var_name=excluded.token_var_name, system_prompt=excluded.system_prompt, welcome_message=excluded.welcome_message, menu_json=excluded.menu_json, webhook_secret_hash=COALESCE(excluded.webhook_secret_hash, factory_bots.webhook_secret_hash), updated_at=CURRENT_TIMESTAMP"
      )
        .bind(
          validated.bot_id,
          validated.bot_name,
          validated.token_var_name,
          validated.system_prompt,
          validated.welcome_message,
          validated.menu_json,
          validated.webhook_secret_hash ?? null
        )
        .run();
      return Response.json({ success: true });
    }

    // Memory API
    if (url.pathname === "/api/factory/memory") {
      if (request.headers.get("x-titanium-api-secret") !== env.TITANIUM_API_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }

      if (request.method === "GET") {
        const params = Object.fromEntries(url.searchParams);
        const { bot_id, chat_id, cursor, limit } = MemoryQuerySchema.parse(params);

        let query = "SELECT bot_id, chat_id, message_id, role, content, created_at FROM factory_messages WHERE bot_id = ? AND chat_id = ?";
        const bindings: (string | number)[] = [bot_id, chat_id];

        if (cursor !== undefined) {
          query += " AND message_id < ?";
          bindings.push(cursor);
        }

        query += " ORDER BY message_id DESC LIMIT ?";
        bindings.push(limit + 1);

        const messages = await env.DB.prepare(query).bind(...bindings).all<{ message_id: number }>();
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
        const includeSummary = url.searchParams.get("include_summary") === "true";

        if (!botId || !chatId) {
          return Response.json({ error: "bot_id and chat_id required" }, { status: 400 });
        }

        let query = "DELETE FROM factory_messages WHERE bot_id = ? AND chat_id = ?";
        if (!includeSummary) {
          query += " AND message_id != 0";
        }

        await env.DB.prepare(query).bind(botId, chatId).run();
        return Response.json({ success: true });
      }
    }

    // Summarize API
    if (url.pathname === "/api/factory/memory/summarize" && request.method === "POST") {
      if (request.headers.get("x-titanium-api-secret") !== env.TITANIUM_API_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }

      const body = await request.json();
      const { bot_id, chat_id, mode, manual_summary } = SummarizeSchema.parse(body);

      let summary = "";

      if (mode === "ai") {
        const historyRows = await env.DB.prepare(
          "SELECT role, content FROM factory_messages WHERE bot_id = ? AND chat_id = ? ORDER BY message_id ASC"
        )
          .bind(bot_id, chat_id)
          .all<{ role: string; content: string }>();

        const fullText = (historyRows.results || [])
          .map((r) => `${r.role === "model" ? "Asistente" : "Usuario"}: ${r.content}`)
          .join("\n\n");

        const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
        const result = await ai.models.generateContent({
          model: env.AI_MODEL_NAME,
          contents: [{
            role: "user",
            parts: [{ text: `Resume la siguiente conversación en máximo 500 palabras, preservando datos críticos, decisiones tomadas y contexto relevante. Formato: texto plano.\n\nCONVERSACIÓN:\n${fullText}` }]
          }]
        });
        summary = result.text || "";
      } else {
        if (!manual_summary) return Response.json({ error: "manual_summary required for manual mode" }, { status: 400 });
        summary = manual_summary;
      }

      if (!summary) return Response.json({ error: "Failed to generate summary" }, { status: 500 });

      await env.DB.batch([
        env.DB.prepare("DELETE FROM factory_messages WHERE bot_id = ? AND chat_id = ?").bind(bot_id, chat_id),
        env.DB.prepare("INSERT INTO factory_messages (bot_id, chat_id, message_id, role, content) VALUES (?, ?, 0, 'model', ?)").bind(bot_id, chat_id, summary)
      ]);

      return Response.json({ success: true, summary });
    }

    // Sequences API
    if (url.pathname === "/api/factory/sequences") {
      if (request.headers.get("x-titanium-api-secret") !== env.TITANIUM_API_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }

      if (request.method === "GET") {
        const botId = url.searchParams.get("bot_id");
        if (!botId) return Response.json({ error: "bot_id required" }, { status: 400 });

        const sequences = await env.DB.prepare(
          "SELECT step_number, title, description, payload_json, created_at FROM factory_sequences WHERE bot_id = ? ORDER BY title ASC, step_number ASC"
        )
          .bind(botId)
          .all();
        return Response.json(sequences.results);
      }

      if (request.method === "POST") {
        const body = await request.json();
        const validated = SequenceSchema.parse(body);

        await env.DB.prepare(
          "INSERT INTO factory_sequences (bot_id, step_number, title, description, payload_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(bot_id, title, step_number) DO UPDATE SET description=excluded.description, payload_json=excluded.payload_json, created_at=CURRENT_TIMESTAMP"
        )
          .bind(
            validated.bot_id,
            validated.step_number,
            validated.title,
            validated.description,
            validated.payload_json
          )
          .run();
        return Response.json({ success: true });
      }
    }

    // Bots API
    if (url.pathname === "/api/factory/bots" && request.method === "GET") {
      if (request.headers.get("x-titanium-api-secret") !== env.TITANIUM_API_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }
      const bots = await env.DB.prepare(
        "SELECT bot_id, bot_name, token_var_name, system_prompt, welcome_message, menu_json FROM factory_bots"
      ).all();
      return Response.json(bots.results);
    }

    if (url.pathname.startsWith("/api/factory/bots/")) {
      if (request.headers.get("x-titanium-api-secret") !== env.TITANIUM_API_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }
      const botId = url.pathname.split("/")[4];
      if (!botId) return new Response("bot_id required", { status: 400 });

      if (request.method === "DELETE") {
        await env.DB.prepare("DELETE FROM factory_bots WHERE bot_id = ?").bind(botId).run();
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
          `UPDATE factory_bots SET ${updates.join(", ")}, updated_at=CURRENT_TIMESTAMP WHERE bot_id = ?`
        )
          .bind(...values)
          .run();

        return Response.json({ success: true });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};
