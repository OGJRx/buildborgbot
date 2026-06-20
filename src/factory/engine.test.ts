import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleAction,
  handleConfirmAndProcess,
  handleSummarize,
} from "./handlers";
import type { CoreEnv, FactoryContext } from "./types";

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

describe("Engine Handlers Business Logic", () => {
  function createMockDb() {
    const mock = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(),
      all: vi.fn(),
      run: vi.fn(),
      batch: vi.fn(),
      exec: vi.fn(),
      dump: vi.fn(),
    };
    return mock as unknown as D1Database & {
      prepare: (sql: string) => D1PreparedStatement;
      batch: <T = unknown>(
        statements: D1PreparedStatement[],
      ) => Promise<D1Result<T>[]>;
      run: (sql: string, ...params: unknown[]) => Promise<D1Result<unknown>>;
      first: (sql: string, ...params: unknown[]) => Promise<unknown>;
      all: (sql: string, ...params: unknown[]) => Promise<D1Result<unknown>>;
      bind: (...params: unknown[]) => unknown;
    };
  }

  function createMockEnv(db: D1Database): CoreEnv {
    return {
      DB: db,
      GEMINI_API_KEY: "test-ai-key",
      AI_MODEL_NAME: "test-model",
      TITANIUM_API_SECRET: "test-api-secret",
      TELEGRAM_BOT_TOKEN: "123:abc",
      BOT_TOKENS: {},
    };
  }

  function createMockContext(env: CoreEnv): FactoryContext {
    const ctx = {
      env,
      botId: "bot123",
      chat: { id: 456, type: "private" },
      from: {
        id: 123,
        first_name: "Test",
        is_bot: false,
        username: "testuser",
      },
      reply: vi.fn().mockResolvedValue({ message_id: 789 }),
      conversation: {
        enter: vi.fn().mockResolvedValue(undefined),
      },
      waitUntil: vi.fn().mockImplementation(async (p) => {
        await p;
      }),
      // Minimum properties to satisfy FactoryContext (Partial)
    };
    return ctx as unknown as FactoryContext;
  }

  const mockDbRaw = createMockDb();
  const mockDb = mockDbRaw as unknown as D1Database;
  const mockEnv = createMockEnv(mockDb);
  const mockCtx = createMockContext(mockEnv);

  const defaultMeta = {
    last_row_id: 0,
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: 0,
    changed_db: false,
    changes: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockDbRaw.run).mockResolvedValue({
      success: true,
      meta: { ...defaultMeta, last_row_id: 1 },
      results: [],
    });
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
      vi.mocked(mockDbRaw.all).mockResolvedValueOnce({
        results: sequences,
        success: true,
        meta: defaultMeta,
      });

      await handleAction(mockCtx, "ACT");

      expect(mockDbRaw.prepare).toHaveBeenCalledWith(
        expect.stringContaining("FROM factory_sequences"),
      );
      expect(mockDbRaw.bind).toHaveBeenCalledWith("bot123", "ACT");
      expect(mockCtx.reply).toHaveBeenCalledTimes(2);
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Step 1"),
        expect.objectContaining({ parse_mode: "HTML" }),
      );
    });

    it("should reply with undefined state if no sequences found", async () => {
      vi.mocked(mockDbRaw.all).mockResolvedValueOnce({
        results: [],
        success: true,
        meta: defaultMeta,
      });

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
      expect(mockDbRaw.prepare).not.toHaveBeenCalled();
    });
  });

  describe("handleConfirmAndProcess", () => {
    it("should process user message and reply with AI response", async () => {
      // 1. Rate Limit Check
      vi.mocked(mockDbRaw.first).mockResolvedValueOnce({ request_count: 1 });
      // 2. Circuit Breaker Check
      vi.mocked(mockDbRaw.first).mockResolvedValueOnce({ state: "CLOSED" });

      // Mock message record retrieval
      vi.mocked(mockDbRaw.first).mockResolvedValueOnce({
        content: "User Input",
      });
      // Mock system prompt retrieval
      vi.mocked(mockDbRaw.first).mockResolvedValueOnce({
        system_prompt: "Be helpful",
      });
      // Mock history retrieval
      vi.mocked(mockDbRaw.all).mockResolvedValueOnce({
        results: [{ role: "user", content: "Prev msg" }],
        success: true,
        meta: defaultMeta,
      });
      // Mock D1 run for saving model response
      vi.mocked(mockDbRaw.run).mockResolvedValue({
        success: true,
        meta: { ...defaultMeta, last_row_id: 1 },
        results: [],
      });

      await handleConfirmAndProcess(mockCtx, 123);
      // Wait for the async processAgent() to finish
      const promise = vi.mocked(mockCtx.waitUntil).mock.calls[0]?.[0];
      await promise;

      expect(mockCtx.reply).toHaveBeenCalledWith(
        "MOCKED_AI_RESPONSE",
        expect.objectContaining({ parse_mode: "HTML" }),
      );
      expect(mockDbRaw.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO factory_messages"),
      );
    });

    it("should handle missing message record", async () => {
      // Mock resilience checks
      vi.mocked(mockDbRaw.first).mockResolvedValueOnce({ request_count: 1 }); // RL
      vi.mocked(mockDbRaw.first).mockResolvedValueOnce({ state: "CLOSED" }); // CB

      vi.mocked(mockDbRaw.first).mockResolvedValueOnce(null);

      await handleConfirmAndProcess(mockCtx, 999);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Segmento de memoria no encontrado."),
      );
    });

    it("should not call AI if budget is exceeded", async () => {
      // Mock resilience checks
      vi.mocked(mockDbRaw.first).mockResolvedValueOnce({ request_count: 1 }); // RL
      vi.mocked(mockDbRaw.first).mockResolvedValueOnce({ state: "CLOSED" }); // CB

      vi.mocked(mockDbRaw.first).mockResolvedValueOnce({
        content: "User Input",
      });
      vi.mocked(mockDbRaw.first).mockResolvedValueOnce({
        system_prompt: "Be helpful",
      });

      // Simulate heavy history to exceed budget
      const heavyHistory = Array.from({ length: 50 }, (_, i) => ({
        message_id: i + 1,
        role: "user",
        content: "A".repeat(1000),
      }));
      vi.mocked(mockDbRaw.all).mockResolvedValueOnce({
        results: heavyHistory,
        success: true,
        meta: defaultMeta,
      });

      // Mock D1 run for buildCallback (fact_summarize)
      vi.mocked(mockDbRaw.run).mockResolvedValue({
        success: true,
        meta: { ...defaultMeta, last_row_id: 1 },
        results: [],
      });

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
      vi.mocked(mockDbRaw.all).mockResolvedValueOnce({
        results: [
          { role: "user", content: "Hello" },
          { role: "model", content: "Hi" },
        ],
        success: true,
        meta: defaultMeta,
      });
      mockGenerateContent.mockResolvedValueOnce({
        text: "SUMMARY_TEXT",
      });
      vi.mocked(mockDbRaw.batch).mockResolvedValueOnce([]);

      await handleSummarize(mockCtx);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Procesando resumen"),
        expect.anything(),
      );
      expect(mockGenerateContent).toHaveBeenCalled();
      expect(mockDbRaw.batch).toHaveBeenCalledWith([
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
