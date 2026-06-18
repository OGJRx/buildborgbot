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

  const bots = (await response.json()) as Array<
    FactoryBotConfig & { slug: string; webhook_secret?: string }
  >;
  console.log(`Found ${bots.length} bots.`);

  for (const bot of bots) {
    const { bot_id, slug, webhook_secret, token_var_name } = bot;

    if (!slug) {
      console.warn(`Skipping ${bot_id}: no slug configured`);
      continue;
    }

    // Get the bot's token from environment
    const token = process.env[token_var_name];
    if (!token) {
      console.warn(`Skipping ${bot_id}: token env ${token_var_name} not found`);
      continue;
    }

    // Use existing webhook_secret or create one
    const webhookSecret = webhook_secret || crypto.randomUUID();
    const webhookUrl = `${WORKER_URL}/webhook/${slug}`;

    console.log(`Syncing webhook for ${bot_id} -> ${webhookUrl}`);

    const telegramUrl = `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}&secret_token=${webhookSecret}`;

    try {
      const res = await fetch(telegramUrl);
      const data = (await res.json()) as { ok: boolean; description?: string };

      if (!data.ok) {
        console.error(`FAILED ${bot_id}: ${data.description}`);
        continue;
      }

      // If we generated a new secret, persist it in D1
      if (!webhook_secret) {
        await fetch(`${WORKER_URL}/api/factory/bots/${bot_id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-titanium-api-secret": TITANIUM_API_SECRET,
          },
          body: JSON.stringify({ webhook_secret: webhookSecret }),
        });
      }

      console.log(`✅ ${bot_id} webhook synced successfully`);
    } catch (err) {
      console.error(`ERROR syncing ${bot_id}:`, err);
    }
  }
}

sync().catch((err) => {
  console.error(err);
  process.exit(1);
});
