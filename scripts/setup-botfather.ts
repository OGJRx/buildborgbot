async function setupBotFather() {
  const { WORKER_URL, TITANIUM_API_SECRET, TELEGRAM_BOT_TOKEN } = process.env;

  if (!WORKER_URL || !TITANIUM_API_SECRET || !TELEGRAM_BOT_TOKEN) {
    console.error(
      "Missing required environment variables: WORKER_URL, TITANIUM_API_SECRET, TELEGRAM_BOT_TOKEN",
    );
    process.exit(1);
  }

  const webhookUrl = `${WORKER_URL}/webhook/botfather`;
  const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}&secret_token=${TITANIUM_API_SECRET}`;

  console.log(`Setting webhook for BotFather: ${webhookUrl}`);

  try {
    const response = await fetch(telegramApiUrl);
    const data = (await response.json()) as {
      ok: boolean;
      description?: string;
    };

    if (data.ok) {
      console.log("✅ BotFather webhook configured successfully.");
    } else {
      console.error(
        `❌ Failed to configure BotFather webhook: ${data.description}`,
      );
      process.exit(1);
    }
  } catch (error) {
    console.error("❌ Error configuring BotFather webhook:", error);
    process.exit(1);
  }
}

setupBotFather();
