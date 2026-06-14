import { Bot, Context, InlineKeyboard } from "grammy";
import { CoreEnv, BorgExecutionContext, FactoryBotConfig } from "../shared/types";

export type FactoryContext = Context & {
  env: CoreEnv;
  botId: string;
};

export class FactoryEngine {
  private static botInstances = new Map<string, Bot<FactoryContext>>();

  static async handleUpdate(
    botId: string,
    update: any,
    env: CoreEnv,
    ctx: BorgExecutionContext
  ): Promise<Response> {
    const db = env.DB;
    const config = await db
      .prepare("SELECT * FROM factory_bots WHERE bot_id = ?")
      .bind(botId)
      .first<FactoryBotConfig>();

    if (!config) return new Response("Bot not found", { status: 404 });

    const token = env[config.token_var_name];
    if (!token) return new Response(`Secret ${config.token_var_name} not found`, { status: 500 });

    const bot = this.getBotInstance(botId, token);
    
    // Inject custom properties into update for middleware
    (update as any).env = env;
    (update as any).botId = botId;

    try {
      await bot.handleUpdate(update);
    } catch (err) {
      console.error(`Error in bot ${botId}:`, err);
    }

    return new Response("OK");
  }

  private static getBotInstance(botId: string, token: string): Bot<FactoryContext> {
    if (this.botInstances.has(botId)) return this.botInstances.get(botId)!;

    const bot = new Bot<FactoryContext>(token);
    bot.use(async (ctx, next) => {
      ctx.env = (ctx.update as any).env;
      ctx.botId = (ctx.update as any).botId;
      await next();
    });

    this.setupBot(bot);
    this.botInstances.set(botId, bot);
    return bot;
  }

  private static setupBot(bot: Bot<FactoryContext>) {
    bot.command("start", async (ctx) => {
      const db = ctx.env.DB;
      const config = await db
        .prepare("SELECT welcome_message, menu_json FROM factory_bots WHERE bot_id = ?")
        .bind(ctx.botId)
        .first<{ welcome_message: string; menu_json: string }>();

      if (!config) return;

      const keyboard = new InlineKeyboard();
      try {
        const menu = JSON.parse(config.menu_json);
        menu.forEach((btn: any, i: number) => {
          keyboard.text(btn.label, `fact_act:${btn.action}`);
          if (i % 2 === 1) keyboard.row();
        });
      } catch (e) {}

      await ctx.reply(config.welcome_message, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });

      // Persistent Reply Keyboard
      const replyKeyboard = {
        keyboard: [] as any[],
        resize_keyboard: true,
      };
      try {
        const menu = JSON.parse(config.menu_json);
        menu.forEach((btn: any) => {
          replyKeyboard.keyboard.push([{ text: btn.label }]);
        });
      } catch (e) {}

      if (replyKeyboard.keyboard.length > 0) {
        await ctx.reply("Acceso directo al menú:", {
          reply_markup: replyKeyboard,
        });
      }
    });

    bot.on("message:text", async (ctx, next) => {
      // Handle menu text clicks
      const db = ctx.env.DB;
      const config = await db
        .prepare("SELECT menu_json FROM factory_bots WHERE bot_id = ?")
        .bind(ctx.botId)
        .first<{ menu_json: string }>();
      if (config) {
        try {
          const menu = JSON.parse(config.menu_json);
          const match = menu.find((btn: any) => btn.label === ctx.message.text);
          if (match) {
            return await this.handleAction(ctx, match.action);
          }
        } catch (e) {}
      }
      await next();
    });

    bot.on("callback_query:data", async (ctx) => {
      const data = ctx.callbackQuery.data;
      if (data.startsWith("fact_act:")) {
        const action = data.split(":")[1];
        await this.handleAction(ctx, action);
      }
      await ctx.answerCallbackQuery().catch(() => {});
    });

    bot.catch((err) => console.error("Grammy error:", err));
  }

  private static async handleAction(ctx: FactoryContext, action: string) {
    // Basic implementation, will be expanded in Task 8
    await ctx.reply(`Acción recibida: ${action}`);
  }
}
