-- Add webhook tracking columns to factory_bots
ALTER TABLE factory_bots ADD COLUMN webhook_configured_at DATETIME;
ALTER TABLE factory_bots ADD COLUMN webhook_last_error TEXT;
