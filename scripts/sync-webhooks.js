async function sync() {
  const { WORKER_URL, TITANIUM_API_SECRET } = process.env;
  if (!WORKER_URL || !TITANIUM_API_SECRET) {
    throw new Error("Missing WORKER_URL or TITANIUM_API_SECRET in environment variables");
  }

  console.log(`Fetching bots from ${WORKER_URL}...`);
  const response = await fetch(`${WORKER_URL}/api/factory/bots`, {
    headers: { 'x-titanium-api-secret': TITANIUM_API_SECRET }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch bots: ${response.statusText}`);
  }

  const bots = await response.json();
  console.log(`Found ${bots.length} bots.`);

  for (const bot of bots) {
    const token = process.env[bot.token_var_name];
    if (!token) {
      throw new Error(`Critical Error: Token environment variable '${bot.token_var_name}' not found for bot '${bot.bot_id}'`);
    }

    const webhookUrl = `${WORKER_URL}/webhook/factory/${bot.bot_id}`;
    const telegramUrl = `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
    
    console.log(`Setting webhook for ${bot.bot_id} to ${webhookUrl}...`);
    const res = await fetch(telegramUrl);
    const data = await res.json();
    
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
