# Bot Registration Process

To register a new bot in the Titanium Bot Factory, follow these steps:

## 1. Add Bot Token to Cloudflare Secrets

The bot tokens are stored in a JSON object within the `BOT_TOKENS` secret.

```bash
# Get the current secret value
wrangler secret put BOT_TOKENS --env production
```
When prompted, enter the updated JSON string:
```json
{
  "EXISTING_BOT_TOKEN": "...",
  "NEW_BOT_TOKEN_VAR": "123456:ABC-DEF..."
}
```

## 2. Register Bot in D1 Database

Use the API or execute a SQL command directly via Wrangler:

```bash
wrangler d1 execute bot_factory_db --remote --command="
  INSERT INTO factory_bots (bot_id, bot_name, token_var_name, system_prompt, welcome_message, menu_json)
  VALUES (
    'my-bot-id',
    'My Bot Name',
    'NEW_BOT_TOKEN_VAR',
    'You are a helpful assistant...',
    'Welcome to My Bot!',
    '[{\"label\": \"Option 1\", \"action\": \"opt1\"}]'
  );
"
```

## 3. Configure Telegram Webhook

Use the `scripts/sync-webhooks.ts` script to automatically generate secret tokens, update the database, and set the Telegram webhooks.

```bash
# Set required environment variables
export WORKER_URL="https://your-worker.workers.dev"
export TITANIUM_API_SECRET="your-api-secret"
export NEW_BOT_TOKEN_VAR="123456:ABC-DEF..."

# Run the sync script
npx tsx scripts/sync-webhooks.ts
```

Alternatively, you can do it manually:

1. Generate a UUID for the `webhook_secret_token`.
2. Hash it with SHA-256.
3. Update `factory_bots` with the hash.
4. Call Telegram's `setWebhook` with the URL and the original UUID in the `secret_token` parameter.

## 4. (Optional) Register Sequences

If your bot uses custom actions, register the sequence steps:

```bash
curl -X POST https://your-worker.workers.dev/api/factory/sequences \
  -H "x-titanium-api-secret: your-api-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "bot_id": "my-bot-id",
    "step_number": 1,
    "title": "opt1",
    "description": "This is the first step of Option 1 sequence.",
    "payload_json": "{}"
  }'
```
