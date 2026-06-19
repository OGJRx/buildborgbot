import type { FactoryContext } from "./types";

/**
 * Asserts that the context has the required Titanium environment.
 * Prevents "Cannot read properties of undefined (reading 'DB')" in long-running conversations.
 */
export function assertEnv(
  ctx: FactoryContext,
): asserts ctx is FactoryContext & { env: NonNullable<FactoryContext["env"]> } {
  if (!ctx.env?.DB) {
    throw new Error(
      `[TITANIUM] Context lost 'env' property (botId: ${ctx.botId ?? "unknown"}). Use context from waitFor() instead of initial context.`,
    );
  }
}
