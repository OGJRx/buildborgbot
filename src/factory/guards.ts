import type { CoreEnv, FactoryContext } from "./types";

export function assertEnv(
  ctx: FactoryContext,
): asserts ctx is FactoryContext & { env: NonNullable<FactoryContext["env"]> } {
  // Propagate env/botId from update when middleware skipped (conversation waitFor)
  if (!ctx.env && ctx.update) {
    const ext = ctx.update as unknown as { env?: CoreEnv; botId?: string };
    if (ext.env) ctx.env = ext.env;
    if (ext.botId) ctx.botId = ext.botId;
  }
  if (!ctx.env?.DB) {
    throw new Error(
      `[TITANIUM] Context lost 'env' property (botId: ${ctx.botId ?? "unknown"}).`,
    );
  }
}
