import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  addressFromPublicKey,
  deriveCanonicalPqKey,
  deriveClassicalKey,
  signMessage,
  verifyMessage,
} from "@qorechain/qoresign";
import type { InspectedTransaction } from "@qorechain/qoresign/network";
import { LiveRun, buildAnchorMemo, buildCommitment, canTurn, type Challenge, type Dir, type Input } from "@tracerun/engine";
import { createApp } from "../src/app.js";
import type { ChainAdapter } from "../src/chain.js";
import type { Config } from "../src/config.js";
import { MemoryStore } from "../src/store.js";

// Real QoreSign keys and signatures (BIP-39 test mnemonics, never funded).
function player(mnemonic: string) {
  const classicalKey = deriveClassicalKey({ mnemonic });
  const address = addressFromPublicKey(classicalKey.publicKey, "secp256k1").bech32;
  const pqKey = deriveCanonicalPqKey({ mnemonic, address });
  return { address, classicalKey, pqKey };
}
const alice = player("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about");
const bob = player("legal winner thank year wave sausage worth useful legal winner thank yellow");
const unregistered = player("letter advice cage absurd amount doctor acoustic avoid letter advice cage above");

const CHAIN_ID = "qorechain-diana";
const config: Config = {
  port: 0,
  chainId: CHAIN_ID,
  rest: "http://unused",
  dailySecret: "test-secret-0123456789",
  allowedOrigins: ["http://localhost:5173"],
  dataFile: "unused",
  sessionTtlMs: 30 * 60 * 1000,
};

/** Offline chain: the same QoreSign verification, against keys we "registered". */
const registered = new Map([alice, bob].map((p) => [p.address, p.pqKey.publicKey]));
const txs = new Map<string, InspectedTransaction>();
const chain: ChainAdapter = {
  async verifyCommitment({ signer, data, signature }) {
    const pqPublicKey = registered.get(signer);
    if (!pqPublicKey) throw Object.assign(new Error("no key"), { code: "KEY_NOT_REGISTERED" });
    verifyMessage({ chainId: CHAIN_ID, signer, data, signature: signature as never, pqPublicKey, requirePq: true });
  },
  async inspectAnchor(hash) {
    return txs.get(hash);
  },
};

let clock = Date.parse("2026-11-26T15:00:00Z");
let server: Server;
let base = "";

before(async () => {
  const app = createApp({ config, store: new MemoryStore(), chain, now: () => clock });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as any };
}

/** Play a short legal run with a scripted pattern. */
function play(challenge: Challenge, turns: Dir[]): Input[] {
  const run = new LiveRun(challenge);
  let i = 0;
  while (run.state.status === "running" && run.state.tick < 300) {
    if (run.state.tick % 3 === 0 && i < turns.length && canTurn(run.state, turns[i])) run.queue(turns[i++]);
    run.advance();
  }
  return run.inputs;
}

async function startSession(who = alice) {
  const r = await api("POST", "/api/sessions", { address: who.address });
  assert.equal(r.status, 201);
  return r.json as { sessionNonce: string; challenge: Challenge };
}

function sign(who: typeof alice, text: string) {
  return signMessage({ chainId: CHAIN_ID, signer: who.address, data: text, classicalKey: who.classicalKey, pqKey: who.pqKey });
}

async function commitmentFor(challenge: Challenge, nonce: string, who: typeof alice, inputs: Input[]) {
  const { replayHash } = await import("@tracerun/engine");
  return buildCommitment({
    chainId: CHAIN_ID,
    challengeId: challenge.id,
    sessionNonce: nonce,
    address: who.address,
    ruleset: challenge.rules.version,
    replaySha256: replayHash(challenge, inputs),
  });
}

async function submit(who: typeof alice, turns: Dir[], opts: { signer?: typeof alice; editAfterSigning?: boolean } = {}) {
  const { sessionNonce, challenge } = await startSession(who);
  const inputs = play(challenge, turns);
  const sig = sign(opts.signer ?? who, await commitmentFor(challenge, sessionNonce, who, inputs));
  const sent = opts.editAfterSigning ? inputs.map((i, k) => (k === 0 ? { ...i, tick: i.tick + 1 } : i)) : inputs;
  return { sessionNonce, challenge, inputs, sig, res: await api("POST", "/api/runs", { sessionNonce, address: who.address, inputs: sent, signature: sig }) };
}

describe("TRACE//RUN verification server", () => {
  it("serves the same daily challenge to everyone", async () => {
    const a = await api("GET", "/api/challenge");
    const b = await api("GET", "/api/challenge");
    assert.equal(a.status, 200);
    assert.equal(a.json.id, "daily-2026-11-26");
    assert.equal(a.json.seed, b.json.seed);
  });

  it("verifies a correctly signed run by replaying it", async () => {
    const { res } = await submit(alice, ["D", "R", "U", "R"]);
    assert.equal(res.status, 201, JSON.stringify(res.json));
    assert.equal(res.json.run.verified, true);
    assert.equal(res.json.run.anchor, null);
    assert.match(res.json.anchorMemo, /^TRACE\/\/RUN v1 daily-2026-11-26 [0-9a-f]{64}$/);
  });

  it("rejects inputs edited after signing (the hash no longer matches)", async () => {
    const { res } = await submit(alice, ["U", "R", "D"], { editAfterSigning: true });
    assert.ok([401, 422].includes(res.status), JSON.stringify(res.json));
  });

  it("rejects a signature from a different key", async () => {
    const { res } = await submit(alice, ["U", "L"], { signer: bob });
    assert.equal(res.status, 401);
    assert.equal(res.json.error, "signature-invalid");
  });

  it("ignores client-supplied text: a signature over a different chain id fails", async () => {
    const { sessionNonce, challenge } = await startSession(alice);
    const inputs = play(challenge, ["D", "L"]);
    const wrong = (await commitmentFor(challenge, sessionNonce, alice, inputs)).replace(CHAIN_ID, "qorechain-vladi");
    const res = await api("POST", "/api/runs", { sessionNonce, address: alice.address, inputs, signature: sign(alice, wrong), commitment: wrong });
    assert.equal(res.status, 401);
  });

  it("tells a player with no registered post-quantum key what to do", async () => {
    const { res } = await submit(unregistered, ["U"]);
    assert.equal(res.status, 403);
    assert.equal(res.json.error, "pq-key-not-registered");
  });

  it("does not accept a session twice, or someone else's session", async () => {
    const first = await submit(alice, ["D", "D"]);
    assert.equal(first.res.status, 201);
    const again = await api("POST", "/api/runs", { sessionNonce: first.sessionNonce, address: alice.address, inputs: first.inputs, signature: first.sig });
    assert.equal(again.status, 409);
    assert.equal(again.json.error, "session-used");

    const { sessionNonce } = await startSession(alice);
    const stolen = await api("POST", "/api/runs", { sessionNonce, address: bob.address, inputs: [], signature: {} });
    assert.equal(stolen.status, 403);
  });

  it("expires sessions", async () => {
    const { sessionNonce, challenge } = await startSession(alice);
    const inputs = play(challenge, ["U"]);
    const sig = sign(alice, await commitmentFor(challenge, sessionNonce, alice, inputs));
    clock += config.sessionTtlMs + 1;
    const res = await api("POST", "/api/runs", { sessionNonce, address: alice.address, inputs, signature: sig });
    clock -= config.sessionTtlMs + 1;
    assert.equal(res.status, 410);
  });

  it("stops replay theft: the same replay re-signed by another player is refused", async () => {
    const original = await submit(alice, ["R", "D", "L", "D"]);
    assert.equal(original.res.status, 201);
    const { sessionNonce, challenge } = await startSession(bob);
    const sig = sign(bob, await commitmentFor(challenge, sessionNonce, bob, original.inputs));
    const res = await api("POST", "/api/runs", { sessionNonce, address: bob.address, inputs: original.inputs, signature: sig });
    assert.equal(res.status, 409);
    assert.equal(res.json.error, "replay-already-claimed");
  });

  it("rejects malformed and impossible input logs", async () => {
    const { sessionNonce } = await startSession(alice);
    const bad = await api("POST", "/api/runs", { sessionNonce, address: alice.address, inputs: [{ tick: 0, dir: "X" }], signature: {} });
    assert.equal(bad.status, 400);
    const reverse = await api("POST", "/api/runs", { sessionNonce, address: alice.address, inputs: [{ tick: 0, dir: "L" }], signature: {} });
    assert.equal(reverse.status, 422);
    assert.equal(reverse.json.reason, "invalid-input");
  });

  it("anchors only on a successful, hybrid-signed tx by the player with the exact memo", async () => {
    const { res } = await submit(alice, ["U", "U", "R"]);
    const run = res.json.run;
    const memo = buildAnchorMemo(run.challengeId, run.replayHash);
    const tx = (hash: string, over: Partial<InspectedTransaction> = {}): InspectedTransaction => ({
      txhash: hash,
      chainId: CHAIN_ID,
      height: 10794500n,
      code: 0,
      codespace: "",
      memo,
      messages: [],
      signer: { address: alice.address, keyType: "secp256k1", publicKey: "", sequence: 1n },
      fee: { amount: [], gasLimit: 400000n },
      pqLayer: { present: true, count: 1, algorithmId: 1, verified: true },
      tier: "pqc",
      ...over,
    });
    const H = (c: string) => c.repeat(64);
    txs.set(H("1"), tx(H("1"), { memo: memo.replace(/.$/, "0") }));
    txs.set(H("2"), tx(H("2"), { signer: { address: bob.address, keyType: "secp256k1", publicKey: "", sequence: 1n } }));
    txs.set(H("3"), tx(H("3"), { pqLayer: { present: false, count: 0 }, tier: "shake" }));
    txs.set(H("4"), tx(H("4"), { code: 5 }));
    txs.set(H("5"), tx(H("5")));

    const anchor = (h: string) => api("POST", `/api/runs/${run.id}/anchor`, { txHash: h });
    assert.equal((await anchor(H("1"))).json.error, "memo-mismatch");
    assert.equal((await anchor(H("2"))).json.error, "signer-mismatch");
    assert.equal((await anchor(H("3"))).json.error, "not-hybrid");
    assert.equal((await anchor(H("4"))).json.error, "tx-failed");
    assert.equal((await anchor(H("6"))).status, 404);
    const ok = await anchor(H("5"));
    assert.equal(ok.status, 200);
    assert.equal(ok.json.run.anchor.txHash, H("5"));
    assert.equal(ok.json.run.anchor.height, "10794500");
  });

  it("publishes the full replay, and ranks one best run per player", async () => {
    const board = await api("GET", "/api/leaderboard");
    assert.equal(board.status, 200);
    const addresses = board.json.entries.map((e: { address: string }) => e.address);
    assert.equal(new Set(addresses).size, addresses.length);
    assert.ok(addresses.includes(alice.address));

    const detail = await api("GET", `/api/runs/${board.json.entries[0].id}`);
    assert.equal(detail.status, 200);
    assert.ok(Array.isArray(detail.json.inputs));
    assert.match(detail.json.commitment, /^TRACE\/\/RUN\/v1\n/);
  });
});
