import { Conversation } from "@grammyjs/conversations";
import { FactoryContext } from "./types";

type Convo = Conversation<FactoryContext, FactoryContext>;

export async function feedbackConversation(conversation: Convo, ctx: FactoryContext): Promise<void> {
  await ctx.reply("<b>BUZÓN DE RETROALIMENTACIÓN BORG</b>\n\nDescribe tu problema, sugerencia o reporte de error:", {
    parse_mode: "HTML",
  });

  const { message } = await conversation.waitFor("message:text", {
    maxMilliseconds: 5 * 60 * 1000, // 5 minutos TTL
  });

  if (!message?.text) {
    await ctx.reply("⚠️ Tiempo agotado. La sesión de feedback ha sido cerrada.");
    return;
  }

  const feedback = message.text;

  await conversation.external(async () => {
    await ctx.env.DB.prepare(
      "INSERT INTO factory_feedback (bot_id, chat_id, user_id, content) VALUES (?, ?, ?, ?)"
    )
      .bind(ctx.botId, String(ctx.chat?.id ?? 0), ctx.from?.id ?? 0, feedback)
      .run();
  });

  await ctx.reply("✅ <b>REGISTRO EXITOSO</b>\n\nTu feedback ha sido almacenado en la memoria central. Gracias por contribuir a la evolución del enjambre.", {
    parse_mode: "HTML",
  });
}
