import { randomBytes } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import {
  RULES_V1,
  buildAnchorMemo,
  buildCommitment,
  compareRuns,
  isDir,
  replay,
  seedFromString,
  type Challenge,
  type Input,
} from "@tracerun/engine";
import type { ChainAdapter } from "./chain.js";
import type { Config } from "./config.js";
import { DuplicateReplayError, type RunRecord, type Store } from "./store.js";

export interface Deps {
  config: Config;
  store: Store;
  chain: ChainAdapter;
  now?: () => number;
}

/** bech32 data charset after the `qor1` prefix. */
const ADDRESS_RE = /^qor1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38,58}$/;
const NONCE_RE = /^[0-9a-f]{32}$/;
const TXHASH_RE = /^[0-9A-Fa-f]{64}$/;
const DAY_RE = /^daily-(\d{4}-\d{2}-\d{2})$/;

export function challengeFor(day: string, secret: string): Challenge {
  const id = `daily-${day}`;
  return { id, seed: seedFromString(`${secret}:${id}`), rules: RULES_V1 };
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const fail = (status: number, code: string, message: string, extra?: Record<string, unknown>): never => {
  throw new HttpError(status, code, message, extra);
};

/** Public summary of a run (no input log). */
function summary(run: RunRecord) {
  return {
    id: run.id,
    challengeId: run.challengeId,
    ruleset: run.ruleset,
    address: run.address,
    status: run.result.status,
    deathCause: run.result.deathCause,
    ticks: run.result.ticks,
    packets: run.result.packets,
    moves: run.result.moves,
    replayHash: run.result.replayHash,
    finalStateHash: run.result.finalStateHash,
    submittedAt: new Date(run.submittedAt).toISOString(),
    verified: true,
    anchor: run.anchor ? { ...run.anchor, anchoredAt: new Date(run.anchor.anchoredAt).toISOString() } : null,
  };
}

function parseInputs(raw: unknown, maxTicks: number): Input[] {
  if (!Array.isArray(raw)) fail(400, "bad-inputs", "inputs must be an array");
  const arr = raw as unknown[];
  if (arr.length > maxTicks) fail(400, "bad-inputs", "too many inputs");
  return arr.map((v, i) => {
    const o = v as { tick?: unknown; dir?: unknown };
    if (!o || !Number.isInteger(o.tick) || !isDir(o.dir)) fail(400, "bad-inputs", `input ${i} is malformed`);
    return { tick: o.tick as number, dir: o.dir as Input["dir"] };
  });
}

export function createApp({ config, store, chain, now = Date.now }: Deps) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: config.allowedOrigins }));
  app.use(express.json({ limit: "256kb" }));

  const writes = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });

  const wrap =
    (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) =>
      fn(req, res).catch(next);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, chainId: config.chainId });
  });

  /** Today's circuit (UTC). Everyone gets the same one. */
  app.get("/api/challenge", (_req, res) => {
    const c = challengeFor(utcDay(now()), config.dailySecret);
    res.json({ id: c.id, seed: c.seed, rules: c.rules, chainId: config.chainId });
  });

  /** A single-use nonce, bound to one address and today's circuit. */
  app.post(
    "/api/sessions",
    writes,
    wrap(async (req, res) => {
      const address = String(req.body?.address ?? "");
      if (!ADDRESS_RE.test(address)) fail(400, "bad-address", "address must be a qor1… address");
      const t = now();
      const challenge = challengeFor(utcDay(t), config.dailySecret);
      const nonce = randomBytes(16).toString("hex");
      await store.createSession({
        nonce,
        address,
        challengeId: challenge.id,
        createdAt: t,
        expiresAt: t + config.sessionTtlMs,
      });
      res.status(201).json({
        sessionNonce: nonce,
        challenge: { id: challenge.id, seed: challenge.seed, rules: challenge.rules },
        chainId: config.chainId,
        expiresAt: new Date(t + config.sessionTtlMs).toISOString(),
      });
    }),
  );

  /**
   * Submit a signed run. The server trusts nothing the client says about the
   * result: it rebuilds the commitment text from the raw fields, checks the
   * QoreX signature over that text, and replays the inputs itself.
   */
  app.post(
    "/api/runs",
    writes,
    wrap(async (req, res) => {
      const body = req.body ?? {};
      const nonce = String(body.sessionNonce ?? "");
      const address = String(body.address ?? "");
      if (!NONCE_RE.test(nonce)) fail(400, "bad-session", "sessionNonce is missing or malformed");
      if (!ADDRESS_RE.test(address)) fail(400, "bad-address", "address must be a qor1… address");
      if (!body.signature || typeof body.signature !== "object") fail(400, "bad-signature", "signature is missing");

      const session = await store.getSession(nonce);
      if (!session) fail(404, "unknown-session", "no such session");
      if (session!.address !== address) fail(403, "session-address-mismatch", "session belongs to another address");
      if (session!.usedAt) fail(409, "session-used", "this session already submitted a run");
      if (now() > session!.expiresAt) fail(410, "session-expired", "session expired; start a new run");

      const day = DAY_RE.exec(session!.challengeId)?.[1] ?? fail(500, "bad-challenge", "corrupt session");
      const challenge = challengeFor(day as string, config.dailySecret);

      const inputs = parseInputs(body.inputs, challenge.rules.maxTicks);
      const out = replay(challenge, inputs);
      if (!out.ok) fail(422, "replay-rejected", "the inputs do not replay", { reason: out.error, atIndex: out.atIndex });
      const result = (out as Extract<typeof out, { ok: true }>).result;

      // Rebuild the message the player must have signed. Never use client-supplied text.
      const commitment = buildCommitment({
        chainId: config.chainId,
        challengeId: challenge.id,
        sessionNonce: nonce,
        address,
        ruleset: challenge.rules.version,
        replaySha256: result.replayHash,
      });

      try {
        await chain.verifyCommitment({ signer: address, data: commitment, signature: body.signature });
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === "KEY_NOT_REGISTERED") {
          fail(403, "pq-key-not-registered", "send one transaction from QoreX first to register your post-quantum key");
        }
        fail(401, "signature-invalid", "the signature does not match this run", { reason: code ?? "invalid" });
      }

      const run: RunRecord = {
        id: result.replayHash.slice(0, 16),
        challengeId: challenge.id,
        ruleset: challenge.rules.version,
        address,
        sessionNonce: nonce,
        inputs,
        result,
        commitment,
        signature: body.signature,
        submittedAt: now(),
      };
      try {
        await store.insertRun(run);
      } catch (e) {
        if (e instanceof DuplicateReplayError) {
          fail(409, "replay-already-claimed", "this exact replay was already submitted", { runId: e.existingId });
        }
        throw e;
      }
      await store.markSessionUsed(nonce, now());

      res.status(201).json({ run: summary(run), anchorMemo: buildAnchorMemo(run.challengeId, result.replayHash) });
    }),
  );

  /**
   * Mark a verified run as anchored. The player sends a hybrid-signed native
   * tx from QoreX with the run's anchor memo; the server reads it back from
   * the chain and checks it before saying ANCHORED.
   */
  app.post(
    "/api/runs/:id/anchor",
    writes,
    wrap(async (req, res) => {
      const run = await store.getRun(String(req.params.id));
      if (!run) fail(404, "unknown-run", "no such run");
      if (run!.anchor) {
        res.json({ run: summary(run!) });
        return;
      }
      const txHash = String(req.body?.txHash ?? "");
      if (!TXHASH_RE.test(txHash)) fail(400, "bad-txhash", "txHash must be 64 hex characters");

      const tx = await chain.inspectAnchor(txHash.toUpperCase());
      if (!tx) fail(404, "tx-not-found", "the network does not know this transaction yet; retry in a few seconds");
      const expectedMemo = buildAnchorMemo(run!.challengeId, run!.result.replayHash);
      if (tx!.code !== 0) fail(422, "tx-failed", "the transaction did not succeed", { code: tx!.code });
      if (tx!.memo !== expectedMemo) fail(422, "memo-mismatch", "the transaction memo does not name this run");
      if (tx!.signer?.address !== run!.address) fail(422, "signer-mismatch", "the transaction was not signed by this run's player");
      if (!tx!.pqLayer.present || tx!.pqLayer.verified !== true) {
        fail(422, "not-hybrid", "the transaction has no verified ML-DSA-87 layer", { tier: tx!.tier, reason: tx!.pqLayer.reason });
      }

      const anchor = { txHash: tx!.txhash, height: tx!.height.toString(), anchoredAt: now() };
      await store.setAnchor(run!.id, anchor);
      res.json({ run: summary({ ...run!, anchor }) });
    }),
  );

  /** Full public record of a run, including the input log anyone can replay. */
  app.get(
    "/api/runs/:id",
    wrap(async (req, res) => {
      const run = await store.getRun(String(req.params.id));
      if (!run) fail(404, "unknown-run", "no such run");
      res.json({
        run: summary(run!),
        inputs: run!.inputs,
        commitment: run!.commitment,
        signature: run!.signature,
        seed: challengeFor(DAY_RE.exec(run!.challengeId)![1], config.dailySecret).seed,
      });
    }),
  );

  /** Best verified run per player for a circuit. */
  app.get(
    "/api/leaderboard",
    wrap(async (req, res) => {
      const challengeId = String(req.query.challengeId ?? challengeFor(utcDay(now()), config.dailySecret).id);
      if (!DAY_RE.test(challengeId)) fail(400, "bad-challenge", "challengeId must look like daily-YYYY-MM-DD");
      const order = (a: RunRecord, b: RunRecord) => compareRuns(a.result, b.result) || a.submittedAt - b.submittedAt;
      const best = new Map<string, RunRecord>();
      for (const r of (await store.listRuns(challengeId)).sort(order)) {
        if (!best.has(r.address)) best.set(r.address, r);
      }
      const entries = [...best.values()].sort(order).slice(0, 50).map((r, i) => ({ rank: i + 1, ...summary(r) }));
      res.json({ challengeId, entries });
    }),
  );

  app.use((_req, res) => {
    res.status(404).json({ error: "not-found" });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.code, message: err.message, ...err.extra });
      return;
    }
    if ((err as { type?: string }).type === "entity.too.large") {
      res.status(413).json({ error: "too-large" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "internal" });
  });

  return app;
}
