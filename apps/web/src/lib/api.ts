import type { Challenge, Input } from "@tracerun/engine";

/** Verification server. Set VITE_API_URL for a deployed server. */
export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8787").replace(/\/$/, "");

export interface RunSummary {
  id: string;
  challengeId: string;
  address: string;
  status: "running" | "dead" | "completed";
  deathCause: string | null;
  ticks: number;
  packets: number;
  moves: number;
  replayHash: string;
  finalStateHash: string;
  submittedAt: string;
  verified: boolean;
  proof: "tx" | "message";
  anchor: { txHash: string; height: string; anchoredAt: string } | null;
}

export interface LeaderEntry extends RunSummary {
  rank: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, "offline", "The verification server can't be reached.");
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(body.error ?? "error"), String(body.message ?? res.statusText), body);
  return body as T;
}

export const getChallenge = () => call<Challenge & { chainId: string }>("/api/challenge");

export const createSession = (address: string) =>
  call<{ sessionNonce: string; challenge: Challenge; chainId: string; expiresAt: string }>("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ address }),
  });

/**
 * Submit a run proven by a QoreX transaction. The tx may take a few seconds to
 * be committed, so "tx-not-found" is retried; the session stays usable meanwhile.
 */
export async function submitRunTx(args: { sessionNonce: string; address: string; inputs: Input[]; txHash: string }) {
  const deadline = Date.now() + 45_000;
  for (;;) {
    try {
      return await call<{ run: RunSummary }>("/api/runs", { method: "POST", body: JSON.stringify(args) });
    } catch (e) {
      if (e instanceof ApiError && e.code === "tx-not-found" && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2500));
        continue;
      }
      throw e;
    }
  }
}

export const getLeaderboard = (challengeId: string) =>
  call<{ challengeId: string; entries: LeaderEntry[] }>(`/api/leaderboard?challengeId=${encodeURIComponent(challengeId)}`);

export const getRun = (id: string) =>
  call<{ run: RunSummary; inputs: Input[]; seed: number; commitment: string }>(`/api/runs/${encodeURIComponent(id)}`);

/** Human wording for server refusals. */
export function describeApiError(e: unknown): { title: string; detail: string } {
  if (!(e instanceof ApiError)) return { title: "Verification failed", detail: String((e as Error)?.message ?? e) };
  const map: Record<string, [string, string]> = {
    offline: ["Server unreachable", "The run is safe in this tab. Check your connection and submit again."],
    "tx-not-found": ["Transaction not found", "The network hasn't committed it yet. Submit again in a moment."],
    "replay-rejected": ["Rejected", "The server could not replay these inputs."],
    "replay-already-claimed": ["Already claimed", "This exact replay was already submitted."],
    "memo-mismatch": ["Rejected", "The transaction memo doesn't name this run."],
    "signer-mismatch": ["Rejected", "The transaction was signed by a different account."],
    "not-hybrid": ["Rejected", "The transaction has no verified ML-DSA-87 signature."],
    "tx-failed": ["Transaction failed", "The network rejected the transaction."],
    "session-expired": ["Session expired", "Ranked runs must be submitted within 30 minutes. Start a new run."],
    "session-used": ["Already submitted", "This run's session was already used."],
  };
  const [title, detail] = map[e.code] ?? ["Rejected", e.message];
  return { title, detail };
}

export const restTxUrl = (rest: string, hash: string) => `${rest}/cosmos/tx/v1beta1/txs/${hash}`;
