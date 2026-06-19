-- Optimización de índices para búsqueda de mensajes e historial
CREATE INDEX IF NOT EXISTS idx_messages_bot_chat_id ON factory_messages(bot_id, chat_id, message_id);

-- Indice compuesto para feedback (bot_id, created_at ya están en 0003, agregamos chat_id para búsquedas)
CREATE INDEX IF NOT EXISTS idx_feedback_chat ON factory_feedback(chat_id);
