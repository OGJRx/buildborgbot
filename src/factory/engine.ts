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
    // Basic setup, will be expanded in next tasks
    bot.catch((err) => console.error("Grammy error:", err));
  }
}
