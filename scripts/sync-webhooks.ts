import type { FactoryBotConfig } from "../src/factory/types";

async function sync() {
  const { WORKER_URL, TITANIUM_API_SECRET } = process.env;
  if (!WORKER_URL || !TITANIUM_API_SECRET) {
    throw new Error("Missing WORKER_URL or TITANIUM_API_SECRET");
  }

  console.log(`Fetching bots from ${WORKER_URL}...`);
  const response = await fetch(`${WORKER_URL}/api/factory/bots`, {
    headers: { "x-titanium-api-secret": TITANIUM_API_SECRET },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch bots: ${response.statusText}`);
  }

  const bots = (await response.json()) as Array<FactoryBotConfig & { slug: string }>;
  console.log(`Found ${bots.length} bots.`);

  for (const bot of bots) {
    if (!bot.slug) {
      console.warn(`Skipping ${bot.bot_id}: no slug configured`);
      continue;
    }

    // Fetch webhook_secret from D1 (stored as plaintext UUID)
    const secretResponse = await fetch(
      `${WORKER_URL}/api/factory/config`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-titanium-api-secret": TITANIUM_API_SECRET,
        },
        body: JSON.stringify(bot),
      }
    );

    // Get the bot's token (from env for now, migration endpoint handles D1 storage)
    const token = process.env[bot.token_var_name];
    if (!token) {
      console.warn(`Skipping ${bot.bot_id}: token env ${bot.token_var_name} not found`);
      continue;
    }

    // We need the webhook_secret from the bot record
    // The /api/factory/bots endpoint doesn't expose webhook_secret for security
    // So we use the migration endpoint's pattern: fetch bot details
    const botDetailResponse = await fetch(
      `${WORKER_URL}/api/factory/bots/${bot.bot_id}`,
      {
        headers: { "x-titanium-api-secret": TITANIUM_API_SECRET },
      }
    );

    // For now, generate a new webhook secret and update via migrate endpoint
    // This is a bootstrap script — after migration, tokens live in D1
    const webhookSecret = crypto.randomUUID();
    const webhookUrl = `${WORKER_URL}/webhook/${bot.slug}`;

    console.log(`Setting webhook for ${bot.bot_id} -> ${webhookUrl}`);

    const telegramUrl = `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}&secret_token=${webhookSecret}`;

    const res = await fetch(telegramUrl);
    const data = (await res.json()) as { ok: boolean; description?: string };

    if (!data.ok) {
      console.error(`FAILED ${bot.bot_id}: ${data.description}`);
      continue;
    }

    // Update webhook_secret in D1
    await fetch(`${WORKER_URL}/api/factory/bots/${bot.bot_id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-titanium-api-secret": TITANIUM_API_SECRET,
      },
      body: JSON.stringify({ webhook_secret: webhookSecret }),
    });

    console.log(`✅ ${bot.bot_id} webhook set successfully`);
  }
}

sync().catch((err) => {
  console.error(err);
  process.exit(1);
});
