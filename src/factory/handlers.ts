import { InlineKeyboard } from "grammy";
import { runAgent } from "./agent";
import { buildCallback } from "./callback";
import { canProceed, checkRateLimit } from "./resilience";
import { summarizeConversation } from "./summarize";
import { buildBudgetedHistory, estimateTokens } from "./token-budget";
import type { FactoryContext, FactorySequence } from "./types";

/**
 * Smart HTML Splitting (Titanium Standard)
 */
export function smartSplitHtml(text: string, maxLength = 4000): string[] {
  if (text.length <= maxLength) return [text];

  const blocks: string[] = [];
  let currentPos = 0;

  while (currentPos < text.length) {
    let endPos = currentPos + maxLength;
    if (endPos > text.length) endPos = text.length;

    // Try to split by paragraph first
    let splitPos = text.lastIndexOf("\n\n", endPos);
    if (splitPos <= currentPos) {
      splitPos = text.lastIndexOf("\n", endPos);
    }
    if (splitPos <= currentPos) {
      splitPos = endPos;
    }

    let block = text.substring(currentPos, splitPos);

    // Track open tags and close them
    const tags = ["b", "i", "code", "pre", "em", "strong", "blockquote", "a"];
    const openTags: string[] = [];
    // Enhanced regex to capture full opening tag including attributes for <a>
    const tagRegex = /<(\/)?([a-z1-6]+)([^>]*)>/gi;
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(block)) !== null) {
      const isClosing = !!match[1];
      const tagName = match[2].toLowerCase();
      const attributes = match[3];

      if (tags.includes(tagName)) {
        if (isClosing) {
          openTags.pop();
        } else {
          openTags.push(tagName + (attributes || ""));
        }
      }
    }

    // Close open tags at the end of block
    for (let i = openTags.length - 1; i >= 0; i--) {
      const tagNameOnly = openTags[i].split(" ")[0];
      block += `</${tagNameOnly}>`;
    }

    blocks.push(block);

    // Reopen tags at the beginning of next block
    let prefix = "";
    for (const tagFull of openTags) {
      prefix += `<${tagFull}>`;
    }

    currentPos = splitPos;
    if (currentPos < text.length) {
      text = text.substring(0, currentPos) + prefix + text.substring(currentPos);
      currentPos += prefix.length;
    }
  }

  return blocks;
}

export async function handleConfirmAndProcess(
  ctx: FactoryContext,
  msgId: number,
) {
  if (!ctx.chat) return;
  const db = ctx.env.DB;
  const botId = ctx.botId;
  const chatId = String(ctx.chat.id);

  // 1. Rate Limit Check
  const rateLimit = await checkRateLimit(db, botId);
  if (!rateLimit.allowed) {
    return await ctx.reply(
      `⏳ <b>Demasiadas solicitudes.</b>\n\nIntenta de nuevo en ${rateLimit.remainingSeconds}s.`,
      { parse_mode: "HTML" },
    );
  }

  // 2. Circuit Breaker Check
  const allowed = await canProceed(db, botId);
  if (!allowed) {
    return await ctx.reply(
      "🔧 <b>El bot está en mantenimiento.</b>\n\nIntenta de nuevo más tarde.",
      { parse_mode: "HTML" },
    );
  }

  const msgRecord = await db
    .prepare(
      "SELECT content FROM factory_messages WHERE bot_id = ? AND chat_id = ? AND message_id = ?",
    )
    .bind(botId, chatId, msgId)
    .first<{ content: string }>();

  if (!msgRecord) {
    return await ctx.reply(
      "❌ FALLO CRÍTICO: Segmento de memoria no encontrado.",
    );
  }

  const config = await db
    .prepare("SELECT system_prompt FROM factory_bots WHERE bot_id = ?")
    .bind(botId)
    .first<{ system_prompt: string }>();

  if (!config) return;

  const historyRows = await db
    .prepare(
      "SELECT message_id, role, content FROM factory_messages WHERE bot_id = ? AND chat_id = ? AND message_id < ? ORDER BY message_id ASC",
    )
    .bind(botId, chatId, msgId)
    .all<{ message_id: number; role: string; content: string }>();

  const budget = buildBudgetedHistory(
    historyRows.results ?? [],
    estimateTokens(config.system_prompt),
  );

  if (budget.requiresSummarization) {
    const cb = await buildCallback(db, ctx.env.TITANIUM_API_SECRET, {
      bot_id: botId,
      action: "fact_summarize",
      payload: "",
    });
    const keyboard = new InlineKeyboard().text("⚡ Resumir memoria", cb);
    return await ctx.reply(
      "⚠️ <b>ALERTA DE CAPACIDAD</b>\n\nEl historial de esta conversación excede el presupuesto de memoria permitido. Para mantener la coherencia y el control de costos, es necesario comprimir el contexto antes de continuar.",
      { parse_mode: "HTML", reply_markup: keyboard },
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

  try {
    const result = await runAgent(db, {
      botId: botId,
      systemInstruction: systemInstruction,
      contents: contents,
      apiKey: ctx.env.GEMINI_API_KEY,
      modelName: ctx.env.AI_MODEL_NAME,
    });

    const responseBlocks = smartSplitHtml(result.text);

    for (const block of responseBlocks) {
      const sentMsg = await ctx.reply(block, { parse_mode: "HTML" });
      await db
        .prepare(
          "INSERT INTO factory_messages (bot_id, chat_id, message_id, role, content) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(botId, chatId, sentMsg.message_id, "model", block)
        .run();
    }
  } catch (err) {
    console.error("Agent Error:", err);
    await ctx.reply("❌ Error de procesamiento. Intenta de nuevo.");
  }
}

export async function handleSummarize(ctx: FactoryContext) {
  if (!ctx.chat) return;
  const db = ctx.env.DB;
  const botId = ctx.botId;
  const chatId = String(ctx.chat.id);

  await ctx.reply("<code>Procesando resumen de memoria...</code>", {
    parse_mode: "HTML",
  });

  try {
    await summarizeConversation(db, botId, chatId, ctx.env);

    await ctx.reply(
      "✅ <b>MEMORIA OPTIMIZADA</b>\n\nEl historial ha sido comprimido. El asistente ahora tiene un resumen ejecutivo del contexto anterior.",
      { parse_mode: "HTML" },
    );
  } catch (err) {
    console.error("Summarize Error:", err);
    await ctx.reply("⚠️ ERROR: No se pudo comprimir la memoria.");
  }
}

export async function handleAction(ctx: FactoryContext, action: string) {
  if (action === "feedback") {
    return await ctx.conversation.enter("feedbackConversation");
  }

  const db = ctx.env.DB;
  const sequences = await db
    .prepare(
      "SELECT step_number, title, description, payload_json FROM factory_sequences WHERE bot_id = ? AND title = ? ORDER BY step_number ASC",
    )
    .bind(ctx.botId, action)
    .all<FactorySequence>();

  if (sequences.results && sequences.results.length > 0) {
    for (const step of sequences.results) {
      await ctx.reply(step.description, { parse_mode: "HTML" });
    }
  } else {
    await ctx.reply("<code>Acción no definida.</code>");
  }
}
