-- Circuit Breaker
CREATE TABLE IF NOT EXISTS factory_circuit_breaker (
    bot_id TEXT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'CLOSED' CHECK(state IN ('CLOSED', 'OPEN')),
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_failure_at INTEGER NOT NULL DEFAULT 0,
    opened_at INTEGER NOT NULL DEFAULT 0
);

-- Rate Limits (Fixed Window 1min)
CREATE TABLE IF NOT EXISTS factory_rate_limits (
    bot_id TEXT NOT NULL,
    window_key TEXT NOT NULL, -- YYYYMMDDHHmm
    request_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bot_id, window_key)
);

-- Callback Tokens (Pointer Pattern)
CREATE TABLE IF NOT EXISTS factory_callback_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    action TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

-- Processed Updates (Idempotency)
CREATE TABLE IF NOT EXISTS factory_processed_updates (
    bot_id TEXT NOT NULL,
    update_id INTEGER NOT NULL,
    processed_at INTEGER NOT NULL,
    PRIMARY KEY (bot_id, update_id)
);

-- Platform Config (Admin IDs dinámicos)
CREATE TABLE IF NOT EXISTS factory_platform_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Columnas adicionales en factory_bots
ALTER TABLE factory_bots ADD COLUMN token TEXT;
ALTER TABLE factory_bots ADD COLUMN token_iv TEXT;
ALTER TABLE factory_bots ADD COLUMN slug TEXT NOT NULL DEFAULT '';
ALTER TABLE factory_bots ADD COLUMN webhook_secret TEXT NOT NULL DEFAULT '';

-- Indice único para slug (SQLite no permite UNIQUE directamente en ALTER TABLE ADD COLUMN)
CREATE UNIQUE INDEX IF NOT EXISTS idx_factory_bots_slug ON factory_bots(slug);
