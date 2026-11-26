import { test } from "node:test";
import assert from "node:assert/strict";
import { RULES_V1, LiveRun, replay, replayHash, canTurn, type Challenge, type Dir, type Input } from "../src/index.js";

/**
 * Tamper-detection fuzz test. Records real runs, then applies thousands of
 * random single edits to their input logs (shift a tick, change a direction,
 * delete, insert or duplicate an input). Every edit must be caught: either the
 * replay is rejected, or its replay hash differs from the original's, so it
 * can no longer match the signed commitment.
 */
const DIRS: Dir[] = ["U", "D", "L", "R"];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random-but-legal player: turns at random moments, avoids instant death when it can. */
function randomRun(ch: Challenge, r: () => number): Input[] {
  const run = new LiveRun(ch);
  while (run.state.status === "running" && run.state.tick < 400) {
    if (r() < 0.25) {
      const d = DIRS[Math.floor(r() * 4)];
      if (canTurn(run.state, d)) run.queue(d);
    }
    run.advance();
  }
  return run.inputs;
}

function tamper(inputs: Input[], r: () => number): Input[] {
  const out = inputs.map((i) => ({ ...i }));
  const k = Math.floor(r() * 5);
  const at = Math.floor(r() * Math.max(out.length, 1));
  if (k === 0 && out.length) out[at].tick += r() < 0.5 ? 1 : -1;
  else if (k === 1 && out.length) out[at].dir = DIRS[(DIRS.indexOf(out[at].dir) + 1 + Math.floor(r() * 3)) % 4];
  else if (k === 2 && out.length) out.splice(at, 1);
  else if (k === 3) out.splice(at, 0, { tick: (out[at]?.tick ?? 1) - 1, dir: DIRS[Math.floor(r() * 4)] });
  else if (out.length) out.splice(at, 0, { ...out[at] });
  else out.push({ tick: 0, dir: "U" });
  return out;
}

test("fuzz: 2,000 random tamperings are all detected", () => {
  const r = rng(42);
  let detected = 0;
  let rejected = 0;
  const N = 2000;
  for (let n = 0; n < N; n++) {
    const ch: Challenge = { id: `fuzz-${n % 20}`, seed: n % 20, rules: RULES_V1 };
    const original = randomRun(ch, r);
    const origHash = replayHash(ch, original);
    const edited = tamper(original, r);
    const out = replay(ch, edited);
    if (!out.ok) {
      rejected++;
      detected++;
    } else if (out.result.replayHash !== origHash) {
      detected++;
    }
  }
  assert.equal(detected, N, `undetected tamperings: ${N - detected}`);
  // Most edits break the run outright; the rest change the hash.
  assert.ok(rejected > 0);
});
