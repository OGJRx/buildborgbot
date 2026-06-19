#!/usr/bin/env tsx
/**
 * Script: Setup BotFather Webhook
 * Configures the webhook for the administrative BotFather bot.
 * Must be run after each deployment if the worker domain changes.
 */

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TITANIUM_API_SECRET: string;
  CF_WORKER_DOMAIN: string;
}

function loadEnv(): Env {
  const env = process.env as unknown as Env;
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN not set");
  if (!env.TITANIUM_API_SECRET) throw new Error("TITANIUM_API_SECRET not set");
  if (!env.CF_WORKER_DOMAIN) throw new Error("CF_WORKER_DOMAIN not set");
  return env;
}
async function main() {
  const env = loadEnv();
  const webhookUrl = `https://${env.CF_WORKER_DOMAIN}/webhook/botfather`;

  console.log(`Configuring BotFather webhook: ${webhookUrl}`);

  const apiUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`;
  const params = new URLSearchParams({
    url: webhookUrl,
    secret_token: env.TITANIUM_API_SECRET,
  });

  const response = await fetch(`${apiUrl}?${params.toString()}`);
  const data = (await response.json()) as { ok: boolean; description?: string };

  if (!data.ok) {
    console.error(
      `Failed to set BotFather webhook: ${data.description ?? "Unknown error"}`,
    );
    process.exit(1);
  }

  console.log(`✅ BotFather webhook configured successfully at ${webhookUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
