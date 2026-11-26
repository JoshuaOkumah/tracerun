export interface Config {
  port: number;
  /** QoreChain network the server verifies against. */
  chainId: string;
  /** QoreChain REST endpoint (signatures and transactions are checked here). */
  rest: string;
  /** Secret mixed into each day's seed, so future circuits can't be precomputed. */
  dailySecret: string;
  /** Browser origins allowed to call the API. */
  allowedOrigins: string[];
  /** JSON file the runs and sessions are stored in. */
  dataFile: string;
  /** How long a run session (nonce) stays valid. */
  sessionTtlMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production";
  const dailySecret = env.DAILY_SECRET ?? "";
  if (production && dailySecret.length < 16) {
    throw new Error("DAILY_SECRET must be set (16+ characters) in production");
  }
  return {
    port: Number(env.PORT ?? 8787),
    chainId: env.QORE_CHAIN_ID ?? "qorechain-diana",
    rest: env.QORE_REST_URL ?? "https://api-testnet.qore.host",
    dailySecret: dailySecret || "dev-only-secret-change-me",
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "http://localhost:5173,http://localhost:4173")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    dataFile: env.DATA_FILE ?? "data/tracerun.json",
    sessionTtlMs: Number(env.SESSION_TTL_MS ?? 30 * 60 * 1000),
  };
}
