import { GoogleGenAI } from "@google/genai";
import { reportFailure, reportSuccess } from "./resilience";

/**
 * AI Agent Factory (Titanium Standard)
 */

export interface AgentRequest {
  botId: string;
  systemInstruction: string;
  contents: { role: string; parts: { text: string }[] }[];
  apiKey: string;
  modelName: string;
}

export interface AgentResponse {
  text: string;
}

/**
 * Runs the AI agent with 2 retries and exponential backoff.
 * Total wall time budget is respected.
 */
export async function runAgent(
  db: D1Database,
  request: AgentRequest,
): Promise<AgentResponse> {
  const maxRetries = 2;
  const initialDelay = 500;
  const factor = 2;
  const networkTimeout = 6000;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = initialDelay * factor ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      const ai = new GoogleGenAI({ apiKey: request.apiKey });
      const modelPromise = ai.models.generateContent({
        model: request.modelName,
        contents: request.contents,
        config: {
          systemInstruction: {
            parts: [{ text: request.systemInstruction }],
          },
        },
      });

      // Implement timeout using Promise.race
      const result = await Promise.race([
        modelPromise,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Network timeout")),
            networkTimeout,
          ),
        ),
      ]);

      const text = result.text;
      if (!text) throw new Error("No response text from Gemini");

      await reportSuccess(db, request.botId);
      return { text };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;

      let statusCode = 0;
      if (err instanceof Error && "status" in err) {
        const status = (err as Error & { status: unknown }).status;
        statusCode =
          typeof status === "number"
            ? status
            : Number.parseInt(String(status), 10);
      }

      // Errors that trigger circuit breaker: 429, 5xx, or Timeout
      const isRetryable =
        statusCode === 429 ||
        (statusCode >= 500 && statusCode <= 599) ||
        error.message === "Network timeout";

      if (!isRetryable) {
        // Permanent error, don't retry
        throw error;
      }

      if (attempt === maxRetries) {
        // Last attempt failed, report to circuit breaker
        await reportFailure(db, request.botId);
      }
    }
  }

  throw lastError || new Error("Unknown error in AgentFactory");
}
