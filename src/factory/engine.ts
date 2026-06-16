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

export async function handleUpdate(
  botId: string,
  token: string,
  update: Update,
  env: CoreEnv,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<Response> {
  const db = env.DB;
  const bot = new Bot<FactoryContext>(token);

  bot.use(async (ctx, next) => {
    ctx.env = env;
    ctx.botId = botId;
    await next();
  });

  // Session storage
  const sessionRaw = await D1Adapter.create<Record<string, unknown>>(
    db,
    "factory_sessions",
  );
  const sessionAdapter: StorageAdapter<Record<string, unknown>> = {
    read: (key) => sessionRaw.read(key),
    write: (key, value) => sessionRaw.write(key, value),
    delete: (key) => sessionRaw.delete(key),
  };

  bot.use(
    session({
      initial: () => ({}),
      storage: sessionAdapter,
      getSessionKey: (ctx) => {
        const chatId = ctx.chat?.id.toString() ?? "unknown";
        return `${chatId}:${ctx.botId}`;
      },
    }),
  );

  // Conversation storage
  const convoRaw = await D1Adapter.create<VersionedState<ConversationData>>(
    db,
    "factory_sessions",
  );
  bot.use(
    conversations({
      storage: {
        type: "key",
        adapter: {
          read: (key) => convoRaw.read(key),
          write: (key, value) => convoRaw.write(key, value),
          delete: (key) => convoRaw.delete(key),
        },
        getStorageKey: (ctx: Context & { botId: string }) => {
          const chatId = ctx.chat?.id.toString() ?? "unknown";
          return `${chatId}:${ctx.botId}`;
        },
      },
    }),
  );

  setupBot(bot, waitUntil);

  // Mark processed and run update in parallel
  const runUpdate = async () => {
    await bot.handleUpdate(update);
    await (await markUpdateProcessed(db, botId, update.update_id)).run();
  };

  waitUntil(runUpdate());

  return new Response("OK");
}

function setupBot(
  bot: Bot<FactoryContext>,
  _waitUntil: (p: Promise<unknown>) => void,
) {
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
      for (const btn of menu) {
        const cb = await buildCallback(db, ctx.env.TITANIUM_API_SECRET, {
          bot_id: ctx.botId,
          action: btn.action,
          payload: "",
        });
        keyboard.text(btn.label, cb);
      }
      // Chunking keyboard
      if (keyboard.inline_keyboard.length > 0) {
        keyboard.row();
      }
    } catch (e) {
      console.error("Menu parsing error:", e);
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
        console.error("Menu match parse error:", e);
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
        `[CALLBACK_QUERY_ERROR] bot=${ctx.botId} chat=${ctx.chat?.id} err=${String(err)}`,
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

  bot.catch((err) => console.error("Grammy error:", err));
}

export {
  CoreEnv,
  FactoryBotConfig,
  FactoryContext,
  Menu,
} from "./types";
