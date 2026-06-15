import { describe, expect, it } from "vitest";
import { buildBudgetedHistory } from "./token-budget";

describe("token-budget utility", () => {
  it("should detect and extract summaryContext (message_id = 0)", () => {
    const raw = [
      { message_id: 0, role: "model", content: "Executive summary" },
      { message_id: 1, role: "user", content: "Hello" },
    ];
    const result = buildBudgetedHistory(raw, 0, 1000);
    expect(result.summaryContext).toBe("Executive summary");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.content).toBe("Hello");
  });

  it("should truncate history when budget is exceeded", () => {
    // Each char ~ 0.25 tokens. Hello = 5 chars = ~1.25 tokens.
    // Let's use 4 chars per token.
    const raw = [
      { message_id: 1, role: "user", content: "AAAA" }, // 1 token
      { message_id: 2, role: "model", content: "BBBB" }, // 1 token
      { message_id: 3, role: "user", content: "CCCC" }, // 1 token
    ];
    // availableBudget = 10 (max) - 0 (system) - 0 (summary) - 500 (margin) -> this would be negative
    // Let's test with a larger max budget but low available space

    // In buildBudgetedHistory: availableBudget = maxBudget - systemPromptTokens - summaryTokens - 500
    // We need maxBudget > 500 to have any space.

    const result = buildBudgetedHistory(raw, 0, 502); // availableBudget = 2 tokens

    expect(result.requiresSummarization).toBe(true);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]?.content).toBe("BBBB");
    expect(result.messages[1]?.content).toBe("CCCC");
    expect(result.truncatedCount).toBe(1);
  });

  it("should respect system prompt tokens", () => {
    const raw = [
      { message_id: 1, role: "user", content: "AAAA" }, // 1 token
    ];
    const result = buildBudgetedHistory(raw, 1, 501); // availableBudget = 501 - 1 - 500 = 0
    expect(result.messages).toHaveLength(0);
    expect(result.requiresSummarization).toBe(true);
  });
});
