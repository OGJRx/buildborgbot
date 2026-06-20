-- Migration: 0005_titanium_maintenance
-- Consolidates indices for messages and feedback tables to optimize performance.

-- Message Search Optimization
CREATE INDEX IF NOT EXISTS idx_messages_bot_chat_id ON factory_messages(bot_id, chat_id, message_id);

-- Feedback Search Optimization
-- (factory_feedback table was created in 0003_sessions_and_feedback)
CREATE INDEX IF NOT EXISTS idx_factory_feedback_bot_chat ON factory_feedback(bot_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_factory_feedback_chat ON factory_feedback(chat_id);
CREATE INDEX IF NOT EXISTS idx_factory_feedback_created_at ON factory_feedback(created_at);
