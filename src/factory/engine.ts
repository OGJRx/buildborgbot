import {
  type ConversationData,
  conversations,
  createConversation,
  type VersionedState,
} from "@grammyjs/conversations";
import { D1Adapter } from "@grammyjs/storage-cloudflare";
import {
  Bot,
  type Context,
  InlineKeyboard,
  type StorageAdapter,
  session,
} from "grammy";
import type { Update } from "grammy/types";
import { setupBotFather } from "./botfather";
import { buildCallback, parseCallback } from "./callback";
import { feedbackConversation } from "./conversations";
import {
  handleAction,
  handleConfirmAndProcess,
  handleSummarize,
} from "./handlers";
import { markUpdateProcessed } from "./platform";
import { MenuSchema } from "./schemas";
import type { CoreEnv, FactoryContext, Menu } from "./types";

// --- FACTORY ENGINE ---

const botCache = new Map<string, Bot<FactoryContext>>();

type ExtendedUpdate = Update & {
  env: CoreEnv;
  botId: string;
  host: string;
  waitUntil: (promise: Promise<unknown>) => void;
};

const sessionAdapterCache = new Map<
  D1Database,
  StorageAdapter<Record<string, unknown>>
>();
const convoAdapterCache = new Map<
  D1Database,
  StorageAdapter<VersionedState<ConversationData>>
>();

export async function handleUpdate(
  botId: string,
  token: string,
  update: Update,
  env: CoreEnv,
  waitUntil: (promise: Promise<unknown>) => void,
  host = "unknown",
): Promise<Response> {
  if (!env?.DB) {
    console.error(
      JSON.stringify({
        level: "error",
        tag: "BINDING_MISSING",
        botId,
        error:
          "D1 binding 'DB' is undefined. Check wrangler.toml and Cloudflare dashboard.",
        timestamp: new Date().toISOString(),
      }),
    );
    return new Response("Service configuration error", { status: 503 });
  }

  const db = env.DB;

  // Validate token format (Titanium Guard)
  if (!token?.includes(":") || token.length < 10) {
    console.error(`[FATAL] Invalid token for bot ${botId}`);
    return new Response("Unauthorized: Invalid Token Format", { status: 401 });
  }

  const botIdFromToken = token.split(":")[0];
  const parsedId = Number.parseInt(botIdFromToken ?? "0", 10);

  if (Number.isNaN(parsedId) || parsedId === 0) {
    console.error(`[FATAL] Could not derive ID from token for bot ${botId}`);
    return new Response("Unauthorized: Malformed Token", { status: 401 });
  }

  const botInfo = {
    id: parsedId,
    is_bot: true as const,
    first_name: botId === "botfather" ? "BuildBorg Factory" : "BuildBorg Bot",
    username:
      botId === "botfather"
        ? "BuildBorgFactoryBot"
        : `buildborg_bot_${botIdFromToken}`,
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
  };

  let bot = botCache.get(token);
  if (!bot) {
    bot = new Bot<FactoryContext>(token, { botInfo });
    botCache.set(token, bot);

    // Always re-inject latest request context to handle bot reuse across requests
    bot.use(async (ctx, next) => {
      const req = ctx.update as ExtendedUpdate;

      if (!req.env?.DB) {
        console.error(
          JSON.stringify({
            level: "error",
            tag: "BINDING_MISSING_MIDDLEWARE",
            botId: req.botId ?? botId,
            error: "D1 binding 'DB' was lost or not propagated to middleware.",
            timestamp: new Date().toISOString(),
          }),
        );
      }

      ctx.env = req.env;
      ctx.botId = req.botId;
      ctx.host = req.host;
      ctx.waitUntil = req.waitUntil;
      await next();
    });

    // Session storage
    let sessionAdapter = sessionAdapterCache.get(db);
    if (!sessionAdapter) {
      const sessionRaw = await D1Adapter.create<Record<string, unknown>>(
        db,
        "factory_sessions",
      );
      sessionAdapter = {
        read: (key) => sessionRaw.read(key),
        write: (key, value) => sessionRaw.write(key, value),
        delete: (key) => sessionRaw.delete(key),
      };
      sessionAdapterCache.set(db, sessionAdapter);
    }

    bot.use(
      session({
        initial: () => ({}),
        storage: sessionAdapter,
        getSessionKey: (ctx) => {
          const chatId = ctx.chat?.id.toString() ?? "unknown";
          return `session:${chatId}:${ctx.botId}`;
        },
      }),
    );

    // Conversation storage
    let convoAdapter = convoAdapterCache.get(db);
    if (!convoAdapter) {
      const convoRaw = await D1Adapter.create<VersionedState<ConversationData>>(
        db,
        "factory_sessions",
      );
      convoAdapter = {
        read: (key) => convoRaw.read(key),
        write: (key, value) => convoRaw.write(key, value),
        delete: (key) => convoRaw.delete(key),
      };
      convoAdapterCache.set(db, convoAdapter);
    }

    bot.use(
      conversations({
        storage: {
          type: "key",
          adapter: convoAdapter,
          getStorageKey: (ctx: Context & { botId: string }) => {
            const chatId = ctx.chat?.id.toString() ?? "unknown";
            return `convo:${chatId}:${ctx.botId}`;
          },
        },
      }),
    );

    if (botId === "botfather") {
      setupBotFather(botId, bot);
    } else {
      setupBot(botId, bot);
    }
  }

  // Attach latest context to update to avoid stale closures in cached bot
  const extendedUpdate = update as ExtendedUpdate;
  extendedUpdate.env = env;
  extendedUpdate.botId = botId;
  extendedUpdate.host = host;
  extendedUpdate.waitUntil = waitUntil;

  // Mark processed and run update in parallel
  const runUpdate = async () => {
    try {
      await bot.handleUpdate(extendedUpdate);
      await (await markUpdateProcessed(db, botId, update.update_id)).run();
    } catch (e) {
      console.error(
        JSON.stringify({
          level: "error",
          tag: "UPDATE_FAILURE",
          botId,
          envMissing: !env?.DB,
          error: String(e),
          timestamp: new Date().toISOString(),
        }),
      );
    }
  };

  waitUntil(runUpdate());

  return new Response("OK");
}

function setupBot(botId: string, bot: Bot<FactoryContext>) {
  bot.use(createConversation(feedbackConversation));

  bot.command("start", async (ctx) => {
    const db = ctx.env.DB;
    const config = await db
      .prepare(
        "SELECT welcome_message, menu_json FROM factory_bots WHERE bot_id = ?",
      )
      .bind(ctx.botId)
      .first<{ welcome_message: string; menu_json: string }>();

    if (!config) return;

    const keyboard = new InlineKeyboard();
    let menu: Menu = [];
    try {
      const parsed = JSON.parse(config.menu_json);
      menu = MenuSchema.parse(parsed);
      for (let i = 0; i < menu.length; i++) {
        const btn = menu[i];
        if (!btn) continue;
        const cb = await buildCallback(db, ctx.env.TITANIUM_API_SECRET, {
          bot_id: ctx.botId,
          action: btn.action,
          payload: "",
        });
        keyboard.text(btn.label, cb);
        if (i % 2 === 1) keyboard.row();
      }
    } catch (e) {
      console.error(
        JSON.stringify({
          level: "error",
          tag: "MENU_PARSING_ERROR",
          botId: ctx.botId,
          error: String(e),
          timestamp: new Date().toISOString(),
        }),
      );
    }

    await ctx.reply(config.welcome_message, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });

    const replyKeyboard: {
      keyboard: { text: string }[][];
      resize_keyboard: boolean;
    } = {
      keyboard: [],
      resize_keyboard: true,
    };

    menu.forEach((btn) => {
      replyKeyboard.keyboard.push([{ text: btn.label }]);
    });

    if (replyKeyboard.keyboard.length > 0) {
      await ctx.reply("Accediendo al menú...", {
        parse_mode: "HTML",
        reply_markup: replyKeyboard,
      });
    }
  });

  bot.on("message:text", async (ctx, next) => {
    if (ctx.message.text.startsWith("/")) return await next();

    const db = ctx.env.DB;
    const config = await db
      .prepare("SELECT menu_json FROM factory_bots WHERE bot_id = ?")
      .bind(ctx.botId)
      .first<{ menu_json: string }>();

    if (config) {
      try {
        const parsed = JSON.parse(config.menu_json);
        const menu = MenuSchema.parse(parsed);
        const match = menu.find((btn) => btn.label === ctx.message.text);
        if (match) {
          return await handleAction(ctx, match.action);
        }
      } catch (e) {
        console.error(
          JSON.stringify({
            level: "error",
            tag: "MENU_MATCH_ERROR",
            botId: ctx.botId,
            error: String(e),
            timestamp: new Date().toISOString(),
          }),
        );
      }
    }
    await next();
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const db = ctx.env.DB;
    const apiSecret = ctx.env.TITANIUM_API_SECRET;

    // Pointer Pattern parsing
    const parsed = await parseCallback(db, apiSecret, ctx.botId, data);
    if (!parsed) {
      // Legacy support or fallback
      if (data === "fact_summarize") {
        await handleSummarize(ctx);
      }
      return await ctx.answerCallbackQuery("⚠️ Sesión expirada o inválida.");
    }

    const { action, payload } = parsed;

    if (action === "feedback" || action.startsWith("sequence_")) {
      await handleAction(ctx, action);
    } else if (action === "fact_exec") {
      const msgId = Number.parseInt(payload, 10);
      if (!Number.isNaN(msgId)) {
        await handleConfirmAndProcess(ctx, msgId);
      }
    } else if (action === "fact_summarize") {
      await handleSummarize(ctx);
    } else {
      // Direct action from menu
      await handleAction(ctx, action);
    }

    await ctx.answerCallbackQuery().catch((err: unknown) => {
      console.error(
        JSON.stringify({
          level: "error",
          tag: "CALLBACK_QUERY_ERROR",
          botId: ctx.botId,
          chatId: ctx.chat?.id,
          error: String(err),
          timestamp: new Date().toISOString(),
        }),
      );
    });
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    const msgId = ctx.message.message_id;

    if (!ctx.chat) return;

    await ctx.env.DB.prepare(
      "INSERT INTO factory_messages (bot_id, chat_id, message_id, role, content) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(ctx.botId, String(ctx.chat.id), msgId, "user", text)
      .run();

    const cb = await buildCallback(ctx.env.DB, ctx.env.TITANIUM_API_SECRET, {
      bot_id: ctx.botId,
      action: "fact_exec",
      payload: String(msgId),
    });

    const keyboard = new InlineKeyboard().text("⚡ PROCESAR", cb);

    await ctx.reply(
      `<b>ENTRADA RECIBIDA</b>\n\n<code>CONTENIDO:</code> <i>"${text.substring(0, 100)}${text.length > 100 ? "..." : ""}"</i>\n\n¿Desea procesar este mensaje con IA?`,
      { parse_mode: "HTML", reply_markup: keyboard },
    );
  });

  bot.catch(async (err) => {
    console.error(
      JSON.stringify({
        level: "error",
        tag: "GRAMMY_ERROR",
        botId: botId,
        error: String(err),
        timestamp: new Date().toISOString(),
      }),
    );
    try {
      if (err.ctx) {
        await err.ctx.reply("⚠️ Error interno. Por favor, intenta de nuevo.", {
          parse_mode: "HTML",
        });
      }
    } catch (_replyErr) {
      // Ignore errors during reply in catch
    }
  });
}

export {
  CoreEnv,
  FactoryBotConfig,
  FactoryContext,
  Menu,
} from "./types";
