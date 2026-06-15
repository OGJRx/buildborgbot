import { Bot, InlineKeyboard } from "grammy";
import { Update } from "grammy/types";
import {
  CoreEnv,
  BorgExecutionContext,
  FactoryBotConfig,
  FactoryContext,
  MenuSchema,
  Menu,
} from "./types";
import { handleAction, handleConfirmAndProcess } from "./handlers";

// --- FACTORY ENGINE ---

export class FactoryEngine {
  static async handleUpdate(
    botId: string,
    update: Update,
    env: CoreEnv,
    borgCtx: BorgExecutionContext
  ): Promise<Response> {
    const db = env.DB;
    const config = await db
      .prepare(
        "SELECT bot_id, bot_name, token_var_name, system_prompt, welcome_message, menu_json, webhook_secret_hash FROM factory_bots WHERE bot_id = ?"
      )
      .bind(botId)
      .first<FactoryBotConfig>();

    if (!config) return new Response("Bot not found", { status: 404 });

    const token = env.BOT_TOKENS[config.token_var_name];
    if (!token) {
      return new Response("Internal configuration error", { status: 500 });
    }

    const bot = new Bot<FactoryContext>(token);

    bot.use(async (ctx, next) => {
      ctx.env = env;
      ctx.botId = botId;
      await next();
    });

    this.setupBot(bot, borgCtx);

    borgCtx.waitUntil(bot.handleUpdate(update));

    return new Response("OK");
  }

  private static setupBot(bot: Bot<FactoryContext>, borgCtx: BorgExecutionContext) {
    bot.command("start", async (ctx) => {
      const db = ctx.env.DB;
      const config = await db
        .prepare("SELECT welcome_message, menu_json FROM factory_bots WHERE bot_id = ?")
        .bind(ctx.botId)
        .first<{ welcome_message: string; menu_json: string }>();

      if (!config) return;

      const keyboard = new InlineKeyboard();
      let menu: Menu = [];
      try {
        const parsed = JSON.parse(config.menu_json);
        menu = MenuSchema.parse(parsed);
        menu.forEach((btn, i) => {
          keyboard.text(btn.label, `fact_act:${btn.action}`);
          if (i % 2 === 1) keyboard.row();
        });
      } catch (e) {
        console.error("Menu parsing error:", e);
      }

      await ctx.reply(config.welcome_message, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });

      const replyKeyboard = {
        keyboard: [] as { text: string }[][],
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
      if (data.startsWith("fact_act:")) {
        const action = data.split(":")[1];
        if (action) await handleAction(ctx, action);
      } else if (data.startsWith("fact_exec:")) {
        const msgIdStr = data.split(":")[1];
        if (msgIdStr) {
          const msgId = parseInt(msgIdStr, 10);
          await handleConfirmAndProcess(ctx, msgId);
        }
      }
      await ctx.answerCallbackQuery().catch(() => {});
    });

    bot.on("message:text", async (ctx) => {
      const text = ctx.message.text;
      const msgId = ctx.message.message_id;

      if (!ctx.chat) return;

      await ctx.env.DB.prepare(
        "INSERT INTO factory_messages (bot_id, chat_id, message_id, role, content) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(ctx.botId, String(ctx.chat.id), msgId, "user", text)
        .run();

      const keyboard = new InlineKeyboard().text(
        "⚡ PROCESAR",
        `fact_exec:${msgId}`
      );

      await ctx.reply(
        `<b>ENTRADA RECIBIDA</b>\n\n<code>CONTENIDO:</code> <i>"${text.substring(0, 100)}${text.length > 100 ? "..." : ""}"</i>\n\n¿Desea procesar este mensaje con IA?`,
        { parse_mode: "HTML", reply_markup: keyboard }
      );
    });

    bot.catch((err) => console.error("Grammy error:", err));
  }
}

export {
  CoreEnv,
  BorgExecutionContext,
  FactoryBotConfig,
  FactoryContext,
  MenuSchema,
  Menu,
} from "./types";
