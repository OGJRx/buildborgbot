import { GoogleGenAI } from "@google/genai";
import { InlineKeyboard } from "grammy";
import { FactoryContext, FactorySequence } from "./types";
import { buildBudgetedHistory, estimateTokens } from "./token-budget";

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
      "SELECT message_id, role, content FROM factory_messages WHERE bot_id = ? AND chat_id = ? AND message_id < ? ORDER BY message_id ASC"
    )
    .bind(botId, chatId, msgId)
    .all<{ message_id: number; role: string; content: string }>();

  const budget = buildBudgetedHistory(
    historyRows.results ?? [],
    estimateTokens(config.system_prompt)
  );

  if (budget.requiresSummarization) {
    const keyboard = new InlineKeyboard().text("⚡ Resumir memoria", "fact_summarize");
    return await ctx.reply(
      "⚠️ <b>ALERTA DE CAPACIDAD</b>\n\nEl historial de esta conversación excede el presupuesto de memoria permitido. Para mantener la coherencia y el control de costos, es necesario comprimir el contexto antes de continuar.",
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  }

  const contents = budget.messages.map((m) => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));

  contents.push({ role: "user", parts: [{ text: msgRecord.content }] });

  let systemInstruction = config.system_prompt.trim();
  if (budget.summaryContext) {
    systemInstruction += `\n\n[CONTEXTO PREVIO]:\n${budget.summaryContext}`;
  }

  const ai = new GoogleGenAI({ apiKey: ctx.env.GEMINI_API_KEY });

  try {
    const result = await ai.models.generateContent({
      model: ctx.env.AI_MODEL_NAME,
      contents: contents,
      config: {
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
      },
    });

    const responseText = result.text;
    if (!responseText) throw new Error("No response text from Gemini");

    const sentMsg = await ctx.reply(responseText, { parse_mode: "HTML" });
    await db
      .prepare(
        "INSERT INTO factory_messages (bot_id, chat_id, message_id, role, content) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(botId, chatId, sentMsg.message_id, "model", responseText)
      .run();
  } catch (err) {
    console.error("GenAI Error:", err);
    await ctx.reply("⚠️ ERROR TÉCNICO: Interrupción en el flujo de IA.");
  }
}

export async function handleSummarize(ctx: FactoryContext) {
  if (!ctx.chat) return;
  const db = ctx.env.DB;
  const botId = ctx.botId;
  const chatId = String(ctx.chat.id);

  await ctx.reply("<code>Procesando resumen de memoria...</code>", { parse_mode: "HTML" });

  const historyRows = await db
    .prepare(
      "SELECT role, content FROM factory_messages WHERE bot_id = ? AND chat_id = ? ORDER BY message_id ASC"
    )
    .bind(botId, chatId)
    .all<{ role: string; content: string }>();

  const fullText = (historyRows.results ?? [])
    .map((r: { role: string; content: string }) => `${r.role === "model" ? "Asistente" : "Usuario"}: ${r.content}`)
    .join("\n\n");

  const ai = new GoogleGenAI({ apiKey: ctx.env.GEMINI_API_KEY });
  try {
    const result = await ai.models.generateContent({
      model: ctx.env.AI_MODEL_NAME,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Resume la siguiente conversación en máximo 500 palabras, preservando datos críticos, decisiones tomadas y contexto relevante. Formato: texto plano.\n\nCONVERSACIÓN:\n${fullText}`,
            },
          ],
        },
      ],
    });

    const summary = result.text;
    if (!summary) throw new Error("Summary failed");

    await db.batch([
      db.prepare("DELETE FROM factory_messages WHERE bot_id = ? AND chat_id = ?").bind(botId, chatId),
      db
        .prepare(
          "INSERT INTO factory_messages (bot_id, chat_id, message_id, role, content) VALUES (?, ?, 0, 'model', ?)"
        )
        .bind(botId, chatId, summary),
    ]);

    await ctx.reply("✅ <b>MEMORIA OPTIMIZADA</b>\n\nEl historial ha sido comprimido. El asistente ahora tiene un resumen ejecutivo del contexto anterior.", { parse_mode: "HTML" });
  } catch (err) {
    console.error("Summarize Error:", err);
    await ctx.reply("⚠️ ERROR: No se pudo comprimir la memoria.");
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

  if (action === "feedback") {
    return await ctx.conversation.enter("feedbackConversation");
  }

  if (sequences.results && sequences.results.length > 0) {
    for (const step of sequences.results) {
      await ctx.reply(step.description, { parse_mode: "HTML" });
    }
  } else {
    await ctx.reply("<code>Acción no definida.</code>");
  }
}
