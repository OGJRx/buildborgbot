CREATE TABLE IF NOT EXISTS factory_messages (
    bot_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    message_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'model')),
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (bot_id, chat_id, message_id)
);

CREATE INDEX idx_messages_bot_chat ON factory_messages(bot_id, chat_id, created_at DESC);

CREATE TABLE IF NOT EXISTS factory_sequences (
    bot_id TEXT NOT NULL,
    step_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (bot_id, title, step_number)
);
