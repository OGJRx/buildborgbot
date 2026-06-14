import { describe, it, expect, vi } from "vitest";
import worker from "./index";
import { FactoryEngine, CoreEnv } from "./factory/engine";

vi.mock("./factory/engine", () => ({
  FactoryEngine: {
    handleUpdate: vi.fn(async () => new Response("OK")),
  },
}));

async function hashSecret(secret: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(secret);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("Worker Entry Point", () => {
  const mockDb = {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
    all: vi.fn(),
    run: vi.fn(),
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

  it("should return 404 for unknown routes", async () => {
    const request = new Request("http://localhost/unknown");
    const response = await worker.fetch(request, mockEnv, mockCtx);
    expect(response.status).toBe(404);
  });

  it("should return 403 if secret header is missing in webhook", async () => {
    const request = new Request("http://localhost/webhook/factory/bot1", {
      method: "POST",
      body: JSON.stringify({ update_id: 1 }),
    });
    const response = await worker.fetch(request, mockEnv, mockCtx);
    expect(response.status).toBe(403);
  });

  it("should route webhooks to FactoryEngine if secret matches", async () => {
    const secret = "tg-secret";
    const secretHash = await hashSecret(secret);

    mockDb.first.mockResolvedValueOnce({ webhook_secret_hash: secretHash });

    const request = new Request("http://localhost/webhook/factory/bot1", {
      method: "POST",
      headers: {
        "X-Telegram-Bot-Api-Secret-Token": secret,
      },
      body: JSON.stringify({ update_id: 1 }),
    });

    const response = await worker.fetch(request, mockEnv, mockCtx);
    expect(response.status).toBe(200);
    expect(FactoryEngine.handleUpdate).toHaveBeenCalled();
  });

  it("should persist webhook_secret_hash during config update", async () => {
    const config = {
      bot_id: "bot1",
      bot_name: "Bot One",
      token_var_name: "BOT1_TOKEN",
      system_prompt: "Be a bot",
      welcome_message: "Hi",
      menu_json: "[]",
      webhook_secret_hash: "new-hash",
    };

    const request = new Request("http://localhost/api/factory/config", {
      method: "POST",
      headers: {
        "x-titanium-api-secret": "test-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(config),
    });

    mockDb.run.mockResolvedValueOnce({ success: true });

    const response = await worker.fetch(request, mockEnv, mockCtx);
    expect(response.status).toBe(200);
    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("webhook_secret_hash"));
    expect(mockDb.bind).toHaveBeenCalledWith(
      config.bot_id,
      config.bot_name,
      config.token_var_name,
      config.system_prompt,
      config.welcome_message,
      config.menu_json,
      config.webhook_secret_hash
    );
  });
});
