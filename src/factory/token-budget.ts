// Heuristica: ~4 caracteres por token (ratio aproximado Gemini multilingue)
export const MAX_TOKEN_BUDGET = 10_000;
export const SUMMARIZE_THRESHOLD = 8_000;
export const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface BudgetResult {
  messages: Array<{ role: "user" | "model"; content: string }>;
  totalTokens: number;
  requiresSummarization: boolean;
  truncatedCount: number;
  summaryContext: string | null;
}

/**
 * Construye un historial de mensajes respetando un presupuesto de tokens.
 * Detecta el mensaje con message_id = 0 (resumen) como contexto base.
 */
export function buildBudgetedHistory(
  rawMessages: Array<{ message_id: number; role: string; content: string }>,
  systemPromptTokens: number,
  maxBudget: number = MAX_TOKEN_BUDGET,
): BudgetResult {
  let summaryContext: string | null = null;
  const filteredMessages = rawMessages.filter((m) => {
    if (m.message_id === 0) {
      summaryContext = m.content;
      return false;
    }
    return true;
  });

  const summaryTokens = summaryContext ? estimateTokens(summaryContext) : 0;
  const availableBudget = maxBudget - systemPromptTokens - summaryTokens - 500; // 500 de margen para la respuesta

  const resultMessages: Array<{ role: "user" | "model"; content: string }> = [];
  let currentTokens = 0;
  let truncatedCount = 0;
  let requiresSummarization = false;

  // Iterar del más reciente al más viejo
  const reversed = [...filteredMessages].sort(
    (a, b) => b.message_id - a.message_id,
  );

  for (const msg of reversed) {
    const tokens = estimateTokens(msg.content);
    if (currentTokens + tokens <= availableBudget) {
      resultMessages.unshift({
        role: msg.role === "model" ? "model" : "user",
        content: msg.content,
      });
      currentTokens += tokens;
    } else {
      truncatedCount++;
      requiresSummarization = true;
    }
  }

  return {
    messages: resultMessages,
    totalTokens: currentTokens + summaryTokens + systemPromptTokens,
    requiresSummarization,
    truncatedCount,
    summaryContext,
  };
}
