import { describe, it, expect, vi, beforeEach } from "vitest";
import { FactoryEngine, CoreEnv, FactoryContext } from "./engine";
import { GoogleGenAI } from "@google/genai";

const mockGenerateContent = vi.fn().mockResolvedValue({
  text: "MOCKED_AI_RESPONSE",
});

vi.mock("@google/genai", () => {
  class GoogleGenAI {
    models = {
      generateContent: mockGenerateContent,
    };
  }
  return {
    GoogleGenAI: GoogleGenAI,
  };
});

describe("FactoryEngine Business Logic", () => {
  const mockDb = {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
    all: vi.fn(),
    run: vi.fn(),
  };

  const mockEnv = {
    DB: mockDb as unknown as D1Database,
    GEMINI_API_KEY: "test-ai-key",
    AI_MODEL_NAME: "test-model",
    BOT_TOKENS: {},
  } as unknown as CoreEnv;

  const mockCtx = {
    env: mockEnv,
    botId: "bot123",
    chat: { id: 456 },
    reply: vi.fn().mockResolvedValue({ message_id: 789 }),
  } as unknown as FactoryContext;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleAction", () => {
    it("should reply with sequence steps if they exist", async () => {
      const sequences = [
        { step_number: 1, title: "ACT", description: "Step 1", payload_json: "{}" },
        { step_number: 2, title: "ACT", description: "Step 2", payload_json: "{}" },
      ];
      mockDb.all.mockResolvedValueOnce({ results: sequences });

      await (FactoryEngine as any).handleAction(mockCtx, "ACT");

      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("FROM factory_sequences"));
      expect(mockDb.bind).toHaveBeenCalledWith("bot123", "ACT");
      expect(mockCtx.reply).toHaveBeenCalledTimes(2);
      expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining("Step 1"), expect.anything());
    });

    it("should reply with undefined state if no sequences found", async () => {
      mockDb.all.mockResolvedValueOnce({ results: [] });

      await (FactoryEngine as any).handleAction(mockCtx, "UNKNOWN");

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining("ACCIÓN NO DEFINIDA")
      );
    });
  });

  describe("handleConfirmAndProcess", () => {
    it("should process user message and reply with AI response", async () => {
      // Mock message record retrieval
      mockDb.first.mockResolvedValueOnce({ content: "User Input" });
      // Mock system prompt retrieval
      mockDb.first.mockResolvedValueOnce({ system_prompt: "Be helpful" });
      // Mock history retrieval
      mockDb.all.mockResolvedValueOnce({ results: [{ role: "user", content: "Prev msg" }] });
      // Mock D1 run for saving model response
      mockDb.run.mockResolvedValueOnce({ success: true });

      await (FactoryEngine as any).handleConfirmAndProcess(mockCtx, 123);

      expect(mockCtx.reply).toHaveBeenCalledWith("MOCKED_AI_RESPONSE", expect.anything());
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO factory_messages"));
    });

    it("should handle missing message record", async () => {
      mockDb.first.mockResolvedValueOnce(null);

      await (FactoryEngine as any).handleConfirmAndProcess(mockCtx, 999);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Segmento de memoria no encontrado.")
      );
    });
  });
});
