import { FactoryBotConfig } from "../src/factory/engine";

async function hashSecret(secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(secret);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sync() {
  const { WORKER_URL, TITANIUM_API_SECRET } = process.env;
  if (!WORKER_URL || !TITANIUM_API_SECRET) {
    throw new Error("Missing WORKER_URL or TITANIUM_API_SECRET in environment variables");
  }

  console.log(`Fetching bots from ${WORKER_URL}...`);
  const response = await fetch(`${WORKER_URL}/api/factory/bots`, {
    headers: { "x-titanium-api-secret": TITANIUM_API_SECRET },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch bots: ${response.statusText}`);
  }

  const bots = (await response.json()) as FactoryBotConfig[];
  console.log(`Found ${bots.length} bots.`);

  for (const bot of bots) {
    const token = process.env[bot.token_var_name];
    if (!token) {
      console.warn(`Warning: Token environment variable '${bot.token_var_name}' not found for bot '${bot.bot_id}'`);
      continue;
    }

    const webhookSecret = crypto.randomUUID();
    const webhookSecretHash = await hashSecret(webhookSecret);

    // 1. Update secret hash in D1
    console.log(`Updating secret hash for ${bot.bot_id} in D1...`);
    const configUpdateRes = await fetch(`${WORKER_URL}/api/factory/config`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-titanium-api-secret": TITANIUM_API_SECRET,
      },
      body: JSON.stringify({
        ...bot,
        webhook_secret_hash: webhookSecretHash,
      }),
    });

    if (!configUpdateRes.ok) {
      throw new Error(`Failed to update config for ${bot.bot_id}: ${configUpdateRes.statusText}`);
    }

    // 2. Set Webhook in Telegram with the secret
    const webhookUrl = `${WORKER_URL}/webhook/factory/${bot.bot_id}`;
    const telegramUrl = `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(
      webhookUrl
    )}&secret_token=${webhookSecret}`;

    console.log(`Setting webhook for ${bot.bot_id} to ${webhookUrl} (with secret)...`);
    const res = await fetch(telegramUrl);
    const data = (await res.json()) as { ok: boolean; description?: string };

    if (!data.ok) {
      throw new Error(`Critical Error: Failed to set webhook for ${bot.bot_id}: ${data.description}`);
    }
    console.log(`Webhook set successfully for ${bot.bot_id}`);
  }
}

sync().catch((err) => {
  console.error(err);
  process.exit(1);
});
