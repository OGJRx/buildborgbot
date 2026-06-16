import type { Conversation } from "@grammyjs/conversations";
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
    "🔑 Ingresa el nombre de la variable de entorno del token (ej: <code>MY_BOT_TOKEN</code>):",
    {
      parse_mode: "HTML",
    },
  );
  const tokenVarMsg = await conversation.waitFor("message:text");
  const tokenVarName = tokenVarMsg.message.text;

  await ctx.reply("📜 Ingresa el System Prompt (instrucciones de IA):", {
    parse_mode: "HTML",
  });
  const promptMsg = await conversation.waitFor("message:text");
  const systemPrompt = promptMsg.message.text;

  await ctx.reply("⏳ Procesando creación...");

  try {
    const response = await conversation.external(() =>
      fetch(`https://${ctx.host}/api/factory/config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-titanium-api-secret": ctx.env.TITANIUM_API_SECRET,
        },
        body: JSON.stringify({
          bot_id: botId,
          bot_name: botName,
          token_var_name: tokenVarName,
          system_prompt: systemPrompt,
          welcome_message: `¡Hola! Soy ${botName}. ¿En qué puedo ayudarte?`,
          menu_json: "[]",
        }),
      }),
    );

    if (response.ok) {
      await ctx.reply(
        `✅ <b>BOT CREADO</b>\n\nID: <code>${botId}</code>\nURL Webhook: <code>/webhook/${botId}</code>`,
        {
          parse_mode: "HTML",
        },
      );
    } else {
      await ctx.reply(`❌ Error al crear bot: ${response.statusText}`);
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
