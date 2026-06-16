import { createConversation } from "@grammyjs/conversations";
import { type Bot, InlineKeyboard } from "grammy";
import { newBotConversation } from "./conversations";
import type { FactoryContext } from "./types";

/**
 * BotFather Administrative Handlers
 */

export function setupBotFather(bot: Bot<FactoryContext>) {
  bot.use(createConversation(newBotConversation));

  bot.command("start", async (ctx) => {
    const keyboard = new InlineKeyboard()
      .text("🆕 Crear Bot", "bf_newbot")
      .row()
      .text("📋 Mis Bots", "bf_mybots")
      .row()
      .text("❓ Ayuda", "bf_help");

    await ctx.reply(
      "🤖 <b>Bienvenido a BuildBorg Factory</b>\n\nSoy tu BotFather 2.0. Puedo crear y gestionar bots de IA personalizados para ti.\n\nUsa los botones del menú para comenzar.",
      { parse_mode: "HTML", reply_markup: keyboard },
    );
  });

  bot.callbackQuery("bf_help", async (ctx) => {
    await ctx.reply(
      "<b>Guía de Comandos</b>\n\n" +
        "/start - Menú principal\n" +
        "/newbot - Crear un nuevo bot\n" +
        "/mybots - Listar tus bots\n" +
        "/deletebot {slug} - Eliminar un bot",
      { parse_mode: "HTML" },
    );
    await ctx.answerCallbackQuery();
  });

  bot.command("newbot", async (ctx) => {
    await ctx.conversation.enter("newBotConversation");
  });

  bot.callbackQuery("bf_newbot", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("newBotConversation");
  });

  bot.command("mybots", async (ctx) => {
    const env = ctx.env;
    const response = await fetch(`https://${ctx.host}/api/factory/bots`, {
      headers: { "x-titanium-api-secret": env.TITANIUM_API_SECRET },
    });

    if (!response.ok) {
      return await ctx.reply("❌ Error al obtener la lista de bots.");
    }

    const bots = (await response.json()) as {
      bot_name: string;
      slug: string;
    }[];
    if (bots.length === 0) {
      return await ctx.reply("No tienes bots registrados.");
    }

    let list = "<b>Tus Bots:</b>\n\n";
    for (const bot of bots) {
      list += `• ${bot.bot_name} (<code>${bot.slug}</code>)\n`;
    }

    await ctx.reply(list, { parse_mode: "HTML" });
  });

  bot.callbackQuery("bf_mybots", async (ctx) => {
    // Trigger the command
    await ctx.answerCallbackQuery();
    return ctx.reply("Usa el comando /mybots para ver la lista.");
  });

  bot.command("deletebot", async (ctx) => {
    const slug = ctx.match;
    if (!slug) {
      return await ctx.reply("Usa: /deletebot {slug}");
    }

    const env = ctx.env;
    const response = await fetch(
      `https://${ctx.host}/api/factory/bots/${slug}`,
      {
        method: "DELETE",
        headers: { "x-titanium-api-secret": env.TITANIUM_API_SECRET },
      },
    );

    if (response.ok) {
      await ctx.reply(`✅ Bot <code>${slug}</code> eliminado con éxito.`, {
        parse_mode: "HTML",
      });
    } else {
      await ctx.reply("❌ Error al eliminar el bot.");
    }
  });
}
