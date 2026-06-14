import { FactoryEngine, CoreEnv, BorgExecutionContext } from "./factory/engine";
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
      traceId: crypto.randomUUID(),
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
    if (url.pathname === "/api/factory/memory" && request.method === "GET") {
      const botId = url.searchParams.get("bot_id");
      const chatId = url.searchParams.get("chat_id");
      if (!botId || !chatId) {
        return Response.json({ error: "bot_id and chat_id required" }, { status: 400 });
      }
      const messages = await env.DB.prepare(
        "SELECT bot_id, chat_id, message_id, role, content, created_at FROM factory_messages WHERE bot_id = ? AND chat_id = ? ORDER BY created_at DESC LIMIT 50"
      )
        .bind(botId, chatId)
        .all();
      return Response.json(messages.results);
    }

    // List Bots API
    if (url.pathname === "/api/factory/bots" && request.method === "GET") {
      if (request.headers.get("x-titanium-api-secret") !== env.TITANIUM_API_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }
      const bots = await env.DB.prepare(
        "SELECT bot_id, bot_name, token_var_name, system_prompt, welcome_message, menu_json FROM factory_bots"
      ).all();
      return Response.json(bots.results);
    }

    return new Response("Not Found", { status: 404 });
  },
};
