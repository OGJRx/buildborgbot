import { FactoryEngine } from "./factory/engine";
import { CoreEnv, BorgExecutionContext } from "./shared/types";

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
      const update = await request.json();
      return await FactoryEngine.handleUpdate(botId, update, env, borgCtx);
    }

    // Config API
    if (url.pathname === "/api/factory/config" && request.method === "POST") {
      const body = (await request.json()) as any;
      await env.DB.prepare(
        "INSERT INTO factory_bots (bot_id, bot_name, token_var_name, system_prompt, welcome_message, menu_json) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(bot_id) DO UPDATE SET bot_name=excluded.bot_name, token_var_name=excluded.token_var_name, system_prompt=excluded.system_prompt, welcome_message=excluded.welcome_message, menu_json=excluded.menu_json, updated_at=CURRENT_TIMESTAMP"
      )
        .bind(
          body.bot_id,
          body.bot_name,
          body.token_var_name,
          body.system_prompt,
          body.welcome_message,
          body.menu_json
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
        "SELECT * FROM factory_messages WHERE bot_id = ? AND chat_id = ? ORDER BY created_at DESC LIMIT 50"
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
      const bots = await env.DB.prepare("SELECT * FROM factory_bots").all();
      return Response.json(bots.results);
    }

    return new Response("Not Found", { status: 404 });
  },
};
