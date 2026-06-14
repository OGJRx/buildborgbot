import { Context } from "grammy";
import { z } from "zod";

export interface CoreEnv {
  DB: D1Database;
  GEMINI_API_KEY: string;
  AI_MODEL_NAME: string;
  TITANIUM_API_SECRET: string;
  BOT_TOKENS: Record<string, string | undefined>;
}

export interface BorgExecutionContext {
  traceId: string;
  waitUntil: (promise: Promise<unknown>) => void;
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

export type FactoryContext = Context & {
  env: CoreEnv;
  botId: string;
};

export const MenuSchema = z.array(
  z.object({
    label: z.string(),
    action: z.string(),
  })
);

export type Menu = z.infer<typeof MenuSchema>;
