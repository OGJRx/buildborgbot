import type { Conversation } from "@grammyjs/conversations";
import { upsertBotConfig } from "./platform";
import type { FactoryContext } from "./types";

type Convo = Conversation<FactoryContext, FactoryContext>;

export async function newBotConversation(
  conversation: Convo,
  ctx: FactoryContext,
): Promise<void> {
  await ctx.reply(
    "🆕 <b>NUEVO BOT BORG</b>\n\nIngresa el ID único del bot (slug):",
    {
      parse_mode: "HTML",
    },
  );
  const botIdMsg = await conversation.waitFor("message:text");
  const botId = botIdMsg.message.text;

  await ctx.reply("📛 Ingresa el nombre público del bot:", {
    parse_mode: "HTML",
  });
  const botNameMsg = await conversation.waitFor("message:text");
  const botName = botNameMsg.message.text;

  await ctx.reply(
    "🔑 Ingresa el <b>Telegram Bot Token</b> (ej: <code>12345:ABCDE...</code>):",
    {
      parse_mode: "HTML",
    },
  );
  const tokenMsg = await conversation.waitFor("message:text");
  const botToken = tokenMsg.message.text;

  await ctx.reply("📜 Ingresa el System Prompt (instrucciones de IA):", {
    parse_mode: "HTML",
  });
  const promptMsg = await conversation.waitFor("message:text");
  const systemPrompt = promptMsg.message.text;

  await ctx.reply("⏳ Procesando creación...");

  try {
    const result = await conversation.external(() =>
      upsertBotConfig(
        ctx.env.DB,
        ctx.env,
        {
          bot_id: botId,
          bot_name: botName,
          token: botToken,
          token_var_name: `BOT_TOKEN_${botId
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "_")}`,
          system_prompt: systemPrompt,
          welcome_message: `¡Hola! Soy ${botName}. ¿En qué puedo ayudarte?`,
          menu_json: "[]",
        },
        ctx.host,
      ),
    );

    if (result.success) {
      await ctx.reply(
        `✅ <b>BOT CREADO</b>\n\nID: <code>${botId}</code>\nURL Webhook: <code>/webhook/${botId}</code>`,
        {
          parse_mode: "HTML",
        },
      );
    } else {
      await ctx.reply(
        `❌ Error al crear bot: ${result.error ?? "Unknown error"}`,
      );
    }
  } catch (err) {
    await ctx.reply(`❌ Error crítico: ${String(err)}`);
  }
}

export async function feedbackConversation(
  conversation: Convo,
  ctx: FactoryContext,
): Promise<void> {
  await ctx.reply(
    "<b>BUZÓN DE RETROALIMENTACIÓN BORG</b>\n\nDescribe tu problema, sugerencia o reporte de error:",
    {
      parse_mode: "HTML",
    },
  );

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
      "INSERT INTO factory_feedback (bot_id, chat_id, user_id, content) VALUES (?, ?, ?, ?)",
    )
      .bind(ctx.botId, String(ctx.chat?.id ?? 0), ctx.from?.id ?? 0, feedback)
      .run();
  });

  await ctx.reply(
    "✅ <b>REGISTRO EXITOSO</b>\n\nTu feedback ha sido almacenado en la memoria central. Gracias por contribuir a la evolución del enjambre.",
    {
      parse_mode: "HTML",
    },
  );
}
