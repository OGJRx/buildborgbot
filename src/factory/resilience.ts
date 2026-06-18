/**
 * Resilience System (Titanium Standard)
 */

export interface CircuitBreakerStatus {
  state: "CLOSED" | "OPEN";
  failure_count: number;
  last_failure_at: number;
  opened_at: number;
}

const CB_THRESHOLD = 3;
const CB_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const CB_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

export async function getCircuitBreaker(
  db: D1Database,
  botId: string,
): Promise<CircuitBreakerStatus> {
  const row = await db
    .prepare(
      "SELECT state, failure_count, last_failure_at, opened_at FROM factory_circuit_breaker WHERE bot_id = ?",
    )
    .bind(botId)
    .first<CircuitBreakerStatus>();

  if (!row) {
    return {
      state: "CLOSED",
      failure_count: 0,
      last_failure_at: 0,
      opened_at: 0,
    };
  }
  return row;
}

export async function reportFailure(db: D1Database, botId: string) {
  const now = Date.now(); // Internal MS for calculations
  const cb = await getCircuitBreaker(db, botId);

  let newCount = cb.failure_count + 1;
  let newState: "CLOSED" | "OPEN" = cb.state;
  let openedAt = cb.opened_at;

  // Reset count if last failure was outside the window
  if (now - cb.last_failure_at > CB_WINDOW_MS) {
    newCount = 1;
  }

  if (newCount >= CB_THRESHOLD) {
    newState = "OPEN";
    openedAt = now;
  }

  await db
    .prepare(
      `INSERT INTO factory_circuit_breaker (bot_id, state, failure_count, last_failure_at, opened_at)
       VALUES (?, ?, ?, unixepoch(), ${openedAt === now ? "unixepoch()" : "?"})
       ON CONFLICT(bot_id) DO UPDATE SET state=excluded.state, failure_count=excluded.failure_count, last_failure_at=excluded.last_failure_at, opened_at=excluded.opened_at`,
    )
    .bind(
      ...(openedAt === now
        ? [botId, newState, newCount]
        : [botId, newState, newCount, Math.floor(openedAt / 1000)]),
    )
    .run();
}

export async function reportSuccess(db: D1Database, botId: string) {
  await db
    .prepare(
      "UPDATE factory_circuit_breaker SET state='CLOSED', failure_count=0 WHERE bot_id = ?",
    )
    .bind(botId)
    .run();
}

/**
 * Checks if the bot can proceed.
 * If OPEN and cooldown passed, returns true (enters test mode).
 * If OPEN and cooldown not passed, returns false.
 */
export async function canProceed(
  db: D1Database,
  botId: string,
): Promise<boolean> {
  const cb = await getCircuitBreaker(db, botId);
  if (cb.state === "CLOSED") return true;

  const now = Math.floor(Date.now() / 1000);
  const openedAt = cb.opened_at; // now stored in seconds
  if (now - openedAt > Math.floor(CB_COOLDOWN_MS / 1000)) {
    return true; // Cooldown passed, next request is a test
  }

  return false;
}

/**
 * Rate Limiting (Fixed Window 1min)
 */
export async function checkRateLimit(
  db: D1Database,
  botId: string,
  limit = 15,
): Promise<{ allowed: boolean; remainingSeconds: number }> {
  // Use UTC to avoid timezone issues in Worker environment
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hour = String(now.getUTCHours()).padStart(2, "0");
  const min = String(now.getUTCMinutes()).padStart(2, "0");

  const windowKey = `${year}${month}${day}${hour}${min}`; // YYYYMMDDHHmm
  const secondsInMinute = now.getUTCSeconds();
  const remainingSeconds = 60 - secondsInMinute;

  const result = await db
    .prepare(
      "INSERT INTO factory_rate_limits (bot_id, window_key, request_count) VALUES (?, ?, 1) ON CONFLICT(bot_id, window_key) DO UPDATE SET request_count = factory_rate_limits.request_count + 1 RETURNING request_count",
    )
    .bind(botId, windowKey)
    .first<{ request_count: number }>();

  return {
    allowed: (result?.request_count ?? 0) <= limit,
    remainingSeconds,
  };
}
