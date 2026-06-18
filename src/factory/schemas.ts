import { z } from "zod";

export const ConfigSchema = z.object({
  bot_id: z.string(),
  bot_name: z.string(),
  token_var_name: z.string(),
  system_prompt: z.string(),
  welcome_message: z.string(),
  menu_json: z.string(),
  webhook_secret_hash: z.string().optional(),
  token: z.string().optional(),
});

export const PatchConfigSchema = ConfigSchema.partial().omit({ bot_id: true });

export const SummarizeSchema = z.object({
  bot_id: z.string(),
  chat_id: z.string(),
  mode: z.enum(["ai", "manual"]),
  manual_summary: z.string().optional(),
});

export const MemoryQuerySchema = z.object({
  bot_id: z.string(),
  chat_id: z.string(),
  cursor: z.coerce.number().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
});

export const SequenceSchema = z.object({
  bot_id: z.string(),
  step_number: z.number(),
  title: z.string(),
  description: z.string(),
  payload_json: z.string(),
});

export const MenuSchema = z.array(
  z.object({
    label: z.string(),
    action: z.string(),
  }),
);

export const TelegramUpdateSchema = z
  .object({
    update_id: z.number(),
  })
  .passthrough();

export const GenericSuccessSchema = z.object({
  success: z.boolean(),
});
