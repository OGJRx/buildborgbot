import { Bot, Context, InlineKeyboard } from "grammy";
import { Update } from "grammy/types";
import { z } from "zod";

// --- TITANIUM CORE TYPES ---

export interface CoreEnv {
  DB: D1Database;
  GEMINI_API_KEY: string;
  AI_MODEL_NAME: string;
  TITANIUM_API_SECRET: string;
  // Option A: Specific property for bot tokens to avoid 'any' indexing on CoreEnv
  BOT_TOKENS: Record<string, string | undefined>;
}

export interface BorgExecutionContext {
  traceId: string;
  waitUntil: (promise: Promise<unknown>) => void;
}

export interface FactoryBotConfig {
  bot_id: string;
  bot_name: string;
  token_var_name: string;
  system_prompt: string;
  welcome_message: string;
  menu_json: string;
  webhook_secret_hash?: string;
}

export interface FactorySequence {
  step_number: number;
  title: string;
  description: string;
  payload_json: string;
}

export type FactoryContext = Context & {
  env: CoreEnv;
  botId: string;
};

const MenuSchema = z.array(
  z.object({
    label: z.string(),
    action: z.string(),
  })
);

type Menu = z.infer<typeof MenuSchema>;

// --- TITANIUM LOGGING ---

export class BorgLogger {
  constructor(
    private scope: string,
    private traceId: string
  ) {}

  info(tag: string, message: string) {
    console.log(`[${this.scope}][${this.traceId}][INFO][${tag}] ${message}`);
  }

  error(tag: string, message: string) {
    console.error(`[${this.scope}][${this.traceId}][ERROR][${tag}] ${message}`);
  }
}

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

    // Access tokens from the dedicated BOT_TOKENS property
    const token = env.BOT_TOKENS[config.token_var_name];
    if (!token) {
      return new Response(`Secret ${config.token_var_name} not found`, { status: 500 });
    }

    const bot = new Bot<FactoryContext>(token);

    bot.use(async (ctx, next) => {
      ctx.env = env;
      ctx.botId = botId;
      await next();
    });

    this.setupBot(bot, borgCtx);

    try {
      borgCtx.waitUntil(bot.handleUpdate(update));
    } catch (err) {
      console.error(`Error initiating bot ${botId} update:`, err);
    }

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

      const header = `<b>[ TITANIUM CORE ACTIVATED ]</b>\n\n`;
      const footer = `\n\n<i>Sistema operativo. Esperando parámetros.</i>`;

      await ctx.reply(`${header}${config.welcome_message}${footer}`, {
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
        await ctx.reply("<code>INTERFACE_MENU_MAP:</code>", {
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
        if (action) await this.handleAction(ctx, action);
      } else if (data.startsWith("fact_exec:")) {
        const msgIdStr = data.split(":")[1];
        if (msgIdStr) {
          const msgId = parseInt(msgIdStr, 10);
          await this.handleConfirmAndProcess(ctx, msgId);
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
        "⚡ EJECUTAR ASIMILACIÓN",
        `fact_exec:${msgId}`
      );

      await ctx.reply(
        `<b>ANÁLISIS DE ENTRADA REQUERIDO</b>\n\n<code>BUFFER:</code> <i>"${text.substring(0, 100)}${text.length > 100 ? "..." : ""}"</i>\n\n¿Proceder con el procesamiento de alto rendimiento?`,
        { parse_mode: "HTML", reply_markup: keyboard }
      );
    });

    bot.catch((err) => console.error("Grammy error:", err));
  }

  private static async handleConfirmAndProcess(ctx: FactoryContext, msgId: number) {
    if (!ctx.chat) return;
    const db = ctx.env.DB;
    const botId = ctx.botId;
    const chatId = String(ctx.chat.id);

    const msgRecord = await db
      .prepare(
        "SELECT content FROM factory_messages WHERE bot_id = ? AND chat_id = ? AND message_id = ?"
      )
      .bind(botId, chatId, msgId)
      .first<{ content: string }>();

    if (!msgRecord) {
      return await ctx.reply("❌ FALLO CRÍTICO: Segmento de memoria no encontrado.");
    }

    const config = await db
      .prepare("SELECT system_prompt FROM factory_bots WHERE bot_id = ?")
      .bind(botId)
      .first<{ system_prompt: string }>();

    if (!config) return;

    const historyRows = await db
      .prepare(
        "SELECT role, content FROM factory_messages WHERE bot_id = ? AND chat_id = ? AND message_id < ? ORDER BY created_at DESC LIMIT 10"
      )
      .bind(botId, chatId, msgId)
      .all<{ role: string; content: string }>();

    const contents = (historyRows.results || []).reverse().map((r) => ({
      role: r.role === "model" ? ("model" as const) : ("user" as const),
      parts: [{ text: r.content }],
    }));

    contents.push({ role: "user", parts: [{ text: msgRecord.content }] });

    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: ctx.env.GEMINI_API_KEY });

    const titaniumSystemPrompt = `
${config.system_prompt}

### REGLAS DE RESPUESTA TITANIUM (ESTRICTO)
1. **Identidad:** Eres una autoridad en Automatización de Alto Rendimiento y Arquitectura Serverless.
2. **Tono:** Profesional Agresivo. Directo, eficiente, sin rellenos.
3. **Estructura de Pirámide Invertida:**
   - **CONCLUSIÓN EJECUTIVA:** Responde directamente a lo solicitado en la primera línea.
   - **PUNTOS DE APOYO:** Usa listas para desglosar la lógica técnica.
   - **CALL TO ACTION (CTA):** Define el siguiente paso lógico.
4. **Semántica:** Usa terminología avanzada (Escalabilidad, Inyección de Entidades, Latencia Cognitiva).
5. **Formato:** Usa HTML. Usa negritas para jerarquía.
    `.trim();

    try {
      const result = await ai.models.generateContent({
        model: ctx.env.AI_MODEL_NAME,
        contents: contents,
        config: {
          systemInstruction: {
            parts: [{ text: titaniumSystemPrompt }],
          },
        },
      });

      const responseText = result.text;

      if (!responseText) {
        throw new Error("No response text from Gemini");
      }

      const sentMsg = await ctx.reply(responseText, { parse_mode: "HTML" });
      if (ctx.chat) {
        await db
          .prepare(
            "INSERT INTO factory_messages (bot_id, chat_id, message_id, role, content) VALUES (?, ?, ?, ?, ?)"
          )
          .bind(botId, String(ctx.chat.id), sentMsg.message_id, "model", responseText)
          .run();
      }
    } catch (err) {
      console.error("GenAI Error:", err);
      await ctx.reply("⚠️ ERROR TÉCNICO: Interrupción en el flujo de IA.");
    }
  }

  private static async handleAction(ctx: FactoryContext, action: string) {
    const db = ctx.env.DB;
    const sequences = await db
      .prepare(
        "SELECT step_number, title, description, payload_json FROM factory_sequences WHERE bot_id = ? AND title = ? ORDER BY step_number ASC"
      )
      .bind(ctx.botId, action)
      .all<FactorySequence>();

    if (sequences.results && sequences.results.length > 0) {
      for (const step of sequences.results) {
        const header = `<b>[ SECUENCIA: ${step.title.toUpperCase()} ]</b>\n\n`;
        await ctx.reply(`${header}${step.description}`, {
          parse_mode: "HTML",
        });
      }
    } else {
      await ctx.reply("<code>ESTADO: ACCIÓN NO DEFINIDA</code>");
    }
  }
}
