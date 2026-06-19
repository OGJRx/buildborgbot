async function setupBotFather() {
  const { WORKER_URL, TITANIUM_API_SECRET, TELEGRAM_BOT_TOKEN } = process.env;

  if (!WORKER_URL || !TITANIUM_API_SECRET || !TELEGRAM_BOT_TOKEN) {
    console.error(
      "Missing required environment variables: WORKER_URL, TITANIUM_API_SECRET, TELEGRAM_BOT_TOKEN",
    );
    process.exit(1);
  }

  const webhookUrl = `${WORKER_URL}/webhook/botfather`;
  const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

  try {
    const infoResponse = await fetch(`${telegramApiUrl}/getWebhookInfo`);

    if (!infoResponse.ok) {
      throw new Error(
        `Failed to get webhook info: ${infoResponse.status} ${infoResponse.statusText}`,
      );
    }

    const infoData = (await infoResponse.json()) as {
      ok: boolean;
      result?: { url?: string; secret_token?: string };
    };

    if (!infoData.ok) {
      throw new Error(`Failed to get webhook info: Unknown error`);
    }

    const currentUrl = infoData.result?.url;
    const currentSecret = infoData.result?.secret_token;

    if (currentUrl === webhookUrl && currentSecret === TITANIUM_API_SECRET) {
      console.log(
        `✅ BotFather webhook already configured at ${webhookUrl}. Skipping.`,
      );
      return;
    }

    if (currentUrl !== webhookUrl || currentSecret !== TITANIUM_API_SECRET) {
      console.log(
        `Found different BotFather webhook: ${currentUrl || "none"}. Reconfiguring to ${webhookUrl}`,
      );
    }

    const setResponse = await fetch(
      `${telegramApiUrl}/setWebhook?url=${encodeURIComponent(webhookUrl)}&secret_token=${TITANIUM_API_SECRET}`,
    );

    if (!setResponse.ok) {
      throw new Error(
        `Failed to set webhook: ${setResponse.status} ${setResponse.statusText}`,
      );
    }

    const data = (await setResponse.json()) as {
      ok: boolean;
      description?: string;
    };

    if (data.ok) {
      console.log("✅ BotFather webhook configured successfully.");
    } else {
      throw new Error(
        `Failed to configure BotFather webhook: ${data.description || "Unknown error"}`,
      );
    }
  } catch (error) {
    console.error("❌ Error configuring BotFather webhook:", error);
    process.exit(1);
  }
}

setupBotFather();
