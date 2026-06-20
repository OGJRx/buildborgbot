import type { ConversationFlavor } from "@grammyjs/conversations";
import type { Context, SessionFlavor } from "grammy";
import type { z } from "zod";
import type { MenuSchema } from "./schemas";

export interface CoreEnv {
  DB: D1Database;
  GEMINI_API_KEY: string;
  AI_MODEL_NAME: string;
  TITANIUM_API_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  MIGRATION_KEY?: string;
  ADMIN_TELEGRAM_IDS?: string;
  BOT_TOKENS: Record<string, string | undefined>;
}

export interface FactoryBotConfig {
  bot_id: string;
  bot_name: string;
  token_var_name: string;
  system_prompt: string;
  welcome_message: string;
  menu_json: string;
  webhook_secret_hash?: string;
}

export interface FactorySequence {
  step_number: number;
  title: string;
  description: string;
  payload_json: string;
}

export interface TitaniumSession extends Record<string, unknown> {
  _titaniumEnv?: CoreEnv;
  _titaniumBotId?: string;
  _titaniumHost?: string;
}

export type FactoryContext = Context &
  SessionFlavor<TitaniumSession> & {
    conversation: ConversationFlavor<Context>["conversation"];
    env: CoreEnv;
    botId: string;
    host: string;
    waitUntil: (promise: Promise<unknown>) => void;
  };

export type Menu = z.infer<typeof MenuSchema>;
