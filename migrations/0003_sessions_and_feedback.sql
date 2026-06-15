-- Tabla para D1Adapter de @grammyjs/storage-cloudflare
-- Esquema requerido por el adapter oficial (key TEXT PRIMARY KEY, value TEXT)
CREATE TABLE IF NOT EXISTS factory_sessions (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_key ON factory_sessions(key);

-- Tabla para evidencia atomica de feedback
CREATE TABLE IF NOT EXISTS factory_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_feedback_bot ON factory_feedback(bot_id, created_at DESC);
