import { beforeEach, describe, expect, it, vi } from "vitest";
import { deriveKey, encrypt } from "./factory/security";
import type { CoreEnv } from "./factory/types";
import worker from "./index";

vi.mock("./factory/engine", () => ({
  handleUpdate: vi.fn(async () => new Response("OK")),
}));

describe("Worker Entry Point", () => {
  const mockDb = {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
    all: vi.fn(),
    run: vi.fn(),
    batch: vi.fn(),
  };

  const mockEnv = {
    DB: mockDb as unknown as D1Database,
    TITANIUM_API_SECRET: "test-secret",
    GEMINI_API_KEY: "test-ai-key",
    AI_MODEL_NAME: "test-model",
    BOT_TOKENS: {
      BOT1_TOKEN: "token123",
    },
  } as unknown as CoreEnv;

  const mockCtx = {
    waitUntil: vi.fn(),
  } as unknown as ExecutionContext;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 404 for unknown routes", async () => {
    const request = new Request("http://localhost/unknown");
    const response = await worker.fetch(request, mockEnv, mockCtx);
    expect(response.status).toBe(404);
  });

  it("should return 403 if secret header is missing in webhook", async () => {
    const request = new Request("http://localhost/webhook/bot-slug", {
      method: "POST",
      body: JSON.stringify({ update_id: 1 }),
    });
    const response = await worker.fetch(request, mockEnv, mockCtx);
    expect(response.status).toBe(403);
  });

  it("should route webhooks to FactoryEngine if secret matches", async () => {
    const secret = "tg-secret";
    const key = await deriveKey(mockEnv.TITANIUM_API_SECRET);
    const { ciphertext, iv } = await encrypt("token123", key);

    mockDb.first.mockResolvedValueOnce({
      bot_id: "bot1",
      token: ciphertext,
      token_iv: iv,
      webhook_secret: secret,
    });

    // Mock idempotency check
    mockDb.first.mockResolvedValueOnce(null);

    const request = new Request("http://localhost/webhook/bot-slug", {
      method: "POST",
      headers: {
        "X-Telegram-Bot-Api-Secret-Token": secret,
      },
      body: JSON.stringify({ update_id: 1 }),
    });

    const response = await worker.fetch(request, mockEnv, mockCtx);
    expect(response.status).toBe(200);
  });

  it("should handle config update and include slug and webhook_secret", async () => {
    const config = {
      bot_id: "bot1",
      bot_name: "Bot One",
      token_var_name: "BOT1_TOKEN",
      system_prompt: "Be a bot",
      welcome_message: "Hi",
      menu_json: "[]",
    };

    const request = new Request("http://localhost/api/factory/config", {
      method: "POST",
      headers: {
        "x-titanium-api-secret": "test-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(config),
    });

    mockDb.first.mockResolvedValueOnce({
      slug: "bot1-slug",
      webhook_secret: "uuid-secret",
    });
    mockDb.run.mockResolvedValueOnce({ success: true });

    const response = await worker.fetch(request, mockEnv, mockCtx);
    expect(response.status).toBe(200);
    expect(mockDb.prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO factory_bots"),
    );
    expect(mockDb.bind).toHaveBeenNthCalledWith(
      2,
      config.bot_id,
      config.bot_name,
      config.token_var_name,
      config.system_prompt,
      config.welcome_message,
      config.menu_json,
      "bot1-slug",
      "uuid-secret",
      null,
      null,
    );
  });
});
