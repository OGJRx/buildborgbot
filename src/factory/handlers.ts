import { GoogleGenAI } from "@google/genai";
import { FactoryContext, FactorySequence } from "./types";

export async function handleConfirmAndProcess(ctx: FactoryContext, msgId: number) {
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

  const ai = new GoogleGenAI({ apiKey: ctx.env.GEMINI_API_KEY });

  try {
    const result = await ai.models.generateContent({
      model: ctx.env.AI_MODEL_NAME,
      contents: contents,
      config: {
        systemInstruction: {
          parts: [{ text: config.system_prompt.trim() }],
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

export async function handleAction(ctx: FactoryContext, action: string) {
  const db = ctx.env.DB;
  const sequences = await db
    .prepare(
      "SELECT step_number, title, description, payload_json FROM factory_sequences WHERE bot_id = ? AND title = ? ORDER BY step_number ASC"
    )
    .bind(ctx.botId, action)
    .all<FactorySequence>();

  if (sequences.results && sequences.results.length > 0) {
    for (const step of sequences.results) {
      await ctx.reply(step.description, {
        parse_mode: "HTML",
      });
    }
  } else {
    await ctx.reply("<code>Acción no definida.</code>");
  }
}
