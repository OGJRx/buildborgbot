import type { Conversation } from "@grammyjs/conversations";
import { assertEnv } from "./guards";
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
  const botIdCtx = await conversation.waitFor("message:text", {
    maxMilliseconds: 5 * 60 * 1000,
  });
  const botId = botIdCtx.message.text.trim();

  // Validation: alpha-numeric, underscores, dashes, 1-64 chars.
  const botIdRegex = /^[a-zA-Z0-9_-]{1,64}$/;
  const reservedSlugs = ["botfather", "api", "health", "webhook"];
  if (!botIdRegex.test(botId) || reservedSlugs.includes(botId.toLowerCase())) {
    await botIdCtx.reply(
      "❌ <b>ID INVÁLIDO</b>\n\nEl ID solo puede contener letras, números, guiones y guiones bajos (máx 64 caracteres), y no puede ser una palabra reservada. Reinicia el proceso con /newbot.",
      { parse_mode: "HTML" },
    );
    return;
  }

  await botIdCtx.reply("📛 Ingresa el nombre público del bot:", {
    parse_mode: "HTML",
  });
  const botNameCtx = await conversation.waitFor("message:text", {
    maxMilliseconds: 5 * 60 * 1000,
  });
  const botName = botNameCtx.message.text;

  await botNameCtx.reply(
    "🔑 Ingresa el <b>Telegram Bot Token</b> (ej: <code>12345:ABCDE...</code>):",
    {
      parse_mode: "HTML",
    },
  );
  const tokenCtx = await conversation.waitFor("message:text", {
    maxMilliseconds: 5 * 60 * 1000,
  });
  const botToken = tokenCtx.message.text;

  await tokenCtx.reply("📜 Ingresa el System Prompt (instrucciones de IA):", {
    parse_mode: "HTML",
  });
  const promptCtx = await conversation.waitFor("message:text", {
    maxMilliseconds: 5 * 60 * 1000,
  });
  const systemPrompt = promptCtx.message.text;

  await promptCtx.reply("⏳ Procesando creación...");

  try {
    assertEnv(promptCtx);
    const result = await conversation.external(() =>
      upsertBotConfig(
        promptCtx.env.DB,
        promptCtx.env,
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
        promptCtx.host,
      ),
    );

    if (result.success) {
      if (result.webhook_ok) {
        await promptCtx.reply(
          `✅ <b>BOT CREADO</b>\n\nID: <code>${botId}</code>\nURL Webhook: <code>/webhook/${botId}</code>`,
          {
            parse_mode: "HTML",
          },
        );
      } else {
        await promptCtx.reply(
          `⚠️ <b>BOT CREADO CON ADVERTENCIA</b>\n\nID: <code>${botId}</code>\n\nEl bot se registró correctamente pero el <b>webhook NO pudo configurarse</b>.\n\nError: <code>${result.webhook_error}</code>\n\nEl bot no recibirá mensajes hasta que se resuelva este problema. Puedes intentar actualizarlo nuevamente más tarde.`,
          {
            parse_mode: "HTML",
          },
        );
      }
    } else {
      await promptCtx.reply(
        `❌ Error al crear bot: ${result.error ?? "Unknown error"}`,
      );
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        tag: "NEW_BOT_CONVO_ERROR",
        botId,
        error: String(err),
        timestamp: new Date().toISOString(),
      }),
    );
    await promptCtx.reply(`❌ Error crítico: ${String(err)}`);
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

  const feedbackCtx = await conversation.waitFor("message:text", {
    maxMilliseconds: 5 * 60 * 1000, // 5 minutos TTL
  });

  if (!feedbackCtx.message?.text) {
    await feedbackCtx.reply(
      "⚠️ Tiempo agotado. La sesión de feedback ha sido cerrada.",
    );
    return;
  }

  const feedback = feedbackCtx.message.text;

  await conversation.external(async () => {
    assertEnv(feedbackCtx);
    await feedbackCtx.env.DB.prepare(
      "INSERT INTO factory_feedback (bot_id, chat_id, user_id, content) VALUES (?, ?, ?, ?)",
    )
      .bind(
        feedbackCtx.botId,
        String(feedbackCtx.chat?.id ?? 0),
        feedbackCtx.from?.id ?? 0,
        feedback,
      )
      .run();
  });

  await feedbackCtx.reply(
    "✅ <b>REGISTRO EXITOSO</b>\n\nTu feedback ha sido almacenado en la memoria central. Gracias por contribuir a la evolución del enjambre.",
    {
      parse_mode: "HTML",
    },
  );
}
