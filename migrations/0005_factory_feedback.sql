-- Migration: Create factory_feedback table
-- This table stores user feedback entries linked to bots.

CREATE TABLE IF NOT EXISTS factory_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_factory_feedback_bot_chat ON factory_feedback(bot_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_factory_feedback_created_at ON factory_feedback(created_at);
