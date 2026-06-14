CREATE TABLE IF NOT EXISTS factory_bots (
    bot_id TEXT PRIMARY KEY,
    bot_name TEXT NOT NULL,
    token_var_name TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    welcome_message TEXT NOT NULL,
    menu_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
