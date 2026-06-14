CREATE TABLE factory_bots (
  bot_id TEXT PRIMARY KEY,
  bot_name TEXT NOT NULL,
  token_var_name TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  welcome_message TEXT NOT NULL,
  menu_json TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE factory_sequences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT NOT NULL,
  step_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  payload_json TEXT,
  FOREIGN KEY(bot_id) REFERENCES factory_bots(bot_id)
);

CREATE TABLE factory_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  role TEXT CHECK(role IN ('user', 'model')) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
