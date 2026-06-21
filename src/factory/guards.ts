import type { CoreEnv, FactoryContext } from "./types";

export function assertEnv(
  ctx: FactoryContext,
): asserts ctx is FactoryContext & { env: NonNullable<FactoryContext["env"]> } {
  // Propagate env/botId/host/waitUntil from session or update when middleware skipped (conversation waitFor)
  if (ctx.session) {
    if (!ctx.env && ctx.session._titaniumEnv)
      ctx.env = ctx.session._titaniumEnv;
    if (!ctx.botId && ctx.session._titaniumBotId)
      ctx.botId = ctx.session._titaniumBotId;
    if (!ctx.host && ctx.session._titaniumHost)
      ctx.host = ctx.session._titaniumHost;
  }

  if (ctx.update) {
    const ext = ctx.update as unknown as {
      env?: CoreEnv;
      botId?: string;
      host?: string;
      waitUntil?: (promise: Promise<unknown>) => void;
    };
    if (!ctx.env && ext.env) ctx.env = ext.env;
    if (!ctx.botId && ext.botId) ctx.botId = ext.botId;
    if (!ctx.host && ext.host) ctx.host = ext.host;
    if (!ctx.waitUntil && ext.waitUntil) ctx.waitUntil = ext.waitUntil;
  }

  if (!ctx.env?.DB) {
    throw new Error(
      `[TITANIUM] Context lost 'env' property (botId: ${ctx.botId ?? "unknown"}).`,
    );
  }
}
