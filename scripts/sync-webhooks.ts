import type { FactoryBotConfig } from "../src/factory/types";

interface SyncResult {
  bot_id: string;
  success: boolean;
  error?: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 3,
  retryDelay: number = 1000,
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const delay = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : retryDelay * attempt;
        console.log(`Rate limited, retrying after ${delay}ms`);
        await sleep(delay);
        continue;
      }

      if (!response.ok && attempt < maxRetries) {
        console.log(
          `Attempt ${attempt} failed for ${url}, retrying in ${retryDelay * attempt}ms`,
        );
        await sleep(retryDelay * attempt);
        continue;
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        console.log(
          `Attempt ${attempt} failed for ${url}, retrying in ${retryDelay * attempt}ms: ${lastError.message}`,
        );
        await sleep(retryDelay * attempt);
      }
    }
  }

  throw lastError || new Error("Max retries exceeded");
}

async function syncBot(
  bot: FactoryBotConfig & { slug: string; webhook_secret?: string },
  WORKER_URL: string,
  TITANIUM_API_SECRET: string,
  _concurrencyLimit: number = 5,
): Promise<SyncResult> {
  const { bot_id, slug, webhook_secret, token_var_name } = bot;

  if (!slug) {
    return { bot_id, success: false, error: "No slug configured" };
  }

  const token = process.env[token_var_name];
  if (!token) {
    return {
      bot_id,
      success: false,
      error: `Token env ${token_var_name} not found for bot ${bot_id}`,
    };
  }

  const webhookSecret = webhook_secret || crypto.randomUUID();
  const webhookUrl = `${WORKER_URL}/webhook/${slug}`;

  console.log(`Syncing webhook for ${bot_id} -> ${webhookUrl}`);

  try {
    const telegramUrl = `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}&secret_token=${webhookSecret}`;
    const res = await fetchWithRetry(telegramUrl, {});
    const data = (await res.json()) as { ok: boolean; description?: string };

    if (!data.ok) {
      return {
        bot_id,
        success: false,
        error: data.description || "Unknown error",
      };
    }

    if (!webhook_secret) {
      const patchResponse = await fetchWithRetry(
        `${WORKER_URL}/api/factory/bots/${bot_id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-titanium-api-secret": TITANIUM_API_SECRET,
          },
          body: JSON.stringify({ webhook_secret: webhookSecret }),
        },
      );

      if (!patchResponse.ok) {
        console.warn(`Failed to persist webhook secret for ${bot_id}`);
      }
    }

    console.log(`✅ ${bot_id} webhook synced successfully`);
    return { bot_id, success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`ERROR syncing ${bot_id}: ${error}`);
    return { bot_id, success: false, error };
  }
}

/**
 * TODO: REFACTOR REQUIRED FOR TITANIUM COMPLIANCE
 * 1. Remove reliance on process.env[token_var_name].
 *    The script should fetch decrypted tokens from a secure internal Worker endpoint
 *    or use a local decryption utility if running with MIGRATION_KEY.
 * 2. Integrate with D1 directly (via wrangler d1 execute) or via the Management API
 *    to get the list of all active bots and their configurations.
 * 3. Ensure idempotency by checking getWebhookInfo before calling setWebhook.
 */

async function sync() {
  const env = process.env as unknown as {
    WORKER_URL: string;
    TITANIUM_API_SECRET: string;
    SYNC_CONCURRENCY_LIMIT?: string;
  };
  const { WORKER_URL, TITANIUM_API_SECRET, SYNC_CONCURRENCY_LIMIT } = env;

  if (!WORKER_URL) {
    console.error("Missing WORKER_URL");
    process.exit(1);
  }

  if (!TITANIUM_API_SECRET) {
    console.error("Missing TITANIUM_API_SECRET");
    process.exit(1);
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

  if (bots.length === 0) {
    console.log("No bots found.");
    return;
  }

  console.log(`Found ${bots.length} bots. Starting sync...`);

  const results: SyncResult[] = [];
  const concurrencyLimit = parseInt(SYNC_CONCURRENCY_LIMIT || "5", 10);
  const batchSize = Math.min(concurrencyLimit, bots.length);

  for (let i = 0; i < bots.length; i += batchSize) {
    const batch = bots.slice(i, i + batchSize);
    console.log(
      `Processing batch ${Math.floor(i / batchSize) + 1} (${batch.length} bots)...`,
    );

    const batchPromises = batch.map((bot) =>
      syncBot(bot, WORKER_URL, TITANIUM_API_SECRET, concurrencyLimit),
    );
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    if (i + batchSize < bots.length) {
      console.log("Waiting before next batch...");
      await sleep(2000);
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.filter((r) => !r.success).length;

  console.log(
    `\nSync completed: ${successCount} successful, ${failureCount} failed`,
  );

  if (failureCount > 0) {
    console.log("\nFailed bots:");
    results
      .filter((r) => !r.success)
      .forEach((r) => {
        console.log(`  - ${r.bot_id}: ${r.error}`);
      });
  }
}

sync().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
