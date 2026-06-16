import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleAction,
  handleConfirmAndProcess,
  handleSummarize,
} from "./handlers";
import type { CoreEnv, FactoryContext } from "./types";

const mockGenerateContent = vi.fn().mockResolvedValue({
  text: "MOCKED_AI_RESPONSE"
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

describe("Engine Handlers Business Logic", () => {
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
    GEMINI_API_KEY: "test-ai-key",
    AI_MODEL_NAME: "test-model",
    TITANIUM_API_SECRET: "test-api-secret",
    BOT_TOKENS: {},
  } as unknown as CoreEnv;

  const mockCtx = {
    env: mockEnv,
    botId: "bot123",
    chat: { id: 456 },
    reply: vi.fn().mockResolvedValue({ message_id: 789 }),
    conversation: {
      enter: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as FactoryContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.run.mockResolvedValue({ success: true, meta: { last_row_id: 1 } });
  });

  describe("handleAction", () => {
    it("should reply with sequence steps if they exist", async () => {
      const sequences = [
        {
          step_number: 1,
          title: "ACT",
          description: "Step 1",
          payload_json: "{}",
        },
        {
          step_number: 2,
          title: "ACT",
          description: "Step 2",
          payload_json: "{}",
        },
      ];
      mockDb.all.mockResolvedValueOnce({ results: sequences });

      await handleAction(mockCtx, "ACT");

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("FROM factory_sequences"),
      );
      expect(mockDb.bind).toHaveBeenCalledWith("bot123", "ACT");
      expect(mockCtx.reply).toHaveBeenCalledTimes(2);
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Step 1"),
        expect.objectContaining({ parse_mode: "HTML" }),
      );
    });

    it("should reply with undefined state if no sequences found", async () => {
      mockDb.all.mockResolvedValueOnce({ results: [] });

      await handleAction(mockCtx, "UNKNOWN");

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Acción no definida."),
      );
    });

    it("should enter feedback conversation directly for 'feedback' action", async () => {
      await handleAction(mockCtx, "feedback");

      expect(mockCtx.conversation.enter).toHaveBeenCalledWith(
        "feedbackConversation",
      );
      expect(mockDb.prepare).not.toHaveBeenCalled();
    });
  });

  describe("handleConfirmAndProcess", () => {
    it("should process user message and reply with AI response", async () => {
      // 1. Rate Limit Check
      mockDb.first.mockResolvedValueOnce({ request_count: 1 });
      // 2. Circuit Breaker Check
      mockDb.first.mockResolvedValueOnce({ state: "CLOSED" });

      // Mock message record retrieval
      mockDb.first.mockResolvedValueOnce({ content: "User Input" });
      // Mock system prompt retrieval
      mockDb.first.mockResolvedValueOnce({ system_prompt: "Be helpful" });
      // Mock history retrieval
      mockDb.all.mockResolvedValueOnce({
        results: [{ role: "user", content: "Prev msg" }],
      });
      // Mock D1 run for saving model response
      mockDb.run.mockResolvedValue({ success: true, meta: { last_row_id: 1 } });

      await handleConfirmAndProcess(mockCtx, 123);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        "MOCKED_AI_RESPONSE",
        expect.objectContaining({ parse_mode: "HTML" }),
      );
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO factory_messages"),
      );
    });

    it("should handle missing message record", async () => {
       // Mock resilience checks
       mockDb.first.mockResolvedValueOnce({ request_count: 1 }); // RL
       mockDb.first.mockResolvedValueOnce({ state: "CLOSED" }); // CB

      mockDb.first.mockResolvedValueOnce(null);

      await handleConfirmAndProcess(mockCtx, 999);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Segmento de memoria no encontrado."),
      );
    });

    it("should not call AI if budget is exceeded", async () => {
        // Mock resilience checks
        mockDb.first.mockResolvedValueOnce({ request_count: 1 }); // RL
        mockDb.first.mockResolvedValueOnce({ state: "CLOSED" }); // CB

      mockDb.first.mockResolvedValueOnce({ content: "User Input" });
      mockDb.first.mockResolvedValueOnce({ system_prompt: "Be helpful" });

      // Simulate heavy history to exceed budget
      const heavyHistory = Array.from({ length: 50 }, (_, i) => ({
        message_id: i + 1,
        role: "user",
        content: "A".repeat(1000),
      }));
      mockDb.all.mockResolvedValueOnce({ results: heavyHistory });

      // Mock D1 run for buildCallback (fact_summarize)
      mockDb.run.mockResolvedValue({ success: true, meta: { last_row_id: 1 } });

      await handleConfirmAndProcess(mockCtx, 123);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining("ALERTA DE CAPACIDAD"),
        expect.objectContaining({ reply_markup: expect.anything() }),
      );
      expect(mockGenerateContent).toHaveBeenCalledTimes(0);
    });
  });

  describe("handleSummarize", () => {
    it("should perform atomic batch operations for summarization", async () => {
      mockDb.all.mockResolvedValueOnce({
        results: [
          { role: "user", content: "Hello" },
          { role: "model", content: "Hi" },
        ],
      });
      mockGenerateContent.mockResolvedValueOnce({
        text: "SUMMARY_TEXT"
      });
      mockDb.batch.mockResolvedValueOnce([]);

      await handleSummarize(mockCtx);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Procesando resumen"),
        expect.anything(),
      );
      expect(mockGenerateContent).toHaveBeenCalled();
      expect(mockDb.batch).toHaveBeenCalledWith([
        expect.anything(), // DELETE
        expect.anything(), // INSERT message_id 0
      ]);
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining("MEMORIA OPTIMIZADA"),
        expect.anything(),
      );
    });
  });
});
