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
      const header = `<b>[ SECUENCIA: ${step.title.toUpperCase()} ]</b>\n\n`;
      await ctx.reply(`${header}${step.description}`, {
        parse_mode: "HTML",
      });
    }
  } else {
    await ctx.reply("<code>ESTADO: ACCIÓN NO DEFINIDA</code>");
  }
}
