import type { CoreEnv, FactoryContext } from "./types";

export function assertEnv(
  ctx: FactoryContext,
): asserts ctx is FactoryContext & { env: NonNullable<FactoryContext["env"]> } {
  // Propagate env/botId from session or update when middleware skipped (conversation waitFor)
  if (!ctx.env) {
    if (ctx.session?._titaniumEnv) {
      ctx.env = ctx.session._titaniumEnv;
      if (ctx.session._titaniumBotId) ctx.botId = ctx.session._titaniumBotId;
      if (ctx.session._titaniumHost) ctx.host = ctx.session._titaniumHost;
    } else if (ctx.update) {
      const ext = ctx.update as unknown as { env?: CoreEnv; botId?: string };
      if (ext.env) ctx.env = ext.env;
      if (ext.botId) ctx.botId = ext.botId;
    }
  }

  if (!ctx.env?.DB) {
    throw new Error(
      `[TITANIUM] Context lost 'env' property (botId: ${ctx.botId ?? "unknown"}).`,
    );
  }
}
