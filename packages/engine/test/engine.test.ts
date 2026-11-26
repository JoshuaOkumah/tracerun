import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RULES_V1,
  LiveRun,
  buildCommitment,
  canTurn,
  compareRuns,
  createGame,
  replay,
  replayHash,
  serializeState,
  step,
  type Cell,
  type Challenge,
  type Dir,
  type GameState,
  type Input,
} from "../src/index.js";

const challenge = (seed: number, rules = RULES_V1): Challenge => ({
  id: "daily-2026-11-26",
  seed,
  rules,
});

const DELTA: Record<Dir, Cell> = { U: { x: 0, y: -1 }, D: { x: 0, y: 1 }, L: { x: -1, y: 0 }, R: { x: 1, y: 0 } };

/** BFS bot used only to generate realistic runs for testing. */
function botDir(s: GameState, w: number, h: number): Dir | undefined {
  const target = s.exit ?? s.food;
  if (!target) return undefined;
  const blocked = new Set<number>();
  for (const c of s.obstacles) blocked.add(c.y * w + c.x);
  for (const c of s.snake.slice(0, -1)) blocked.add(c.y * w + c.x);
  const head = s.snake[0];
  const prev = new Map<number, [number, Dir]>();
  const start = head.y * w + head.x;
  const q = [start];
  prev.set(start, [-1, s.dir]);
  while (q.length) {
    const cur = q.shift()!;
    const cx = cur % w, cy = Math.floor(cur / w);
    if (cx === target.x && cy === target.y) {
      let n = cur, first: Dir = s.dir;
      while (prev.get(n)![0] !== -1) { first = prev.get(n)![1]; n = prev.get(n)![0]; }
      return first === s.dir ? undefined : first;
    }
    for (const d of ["U", "D", "L", "R"] as Dir[]) {
      if (cur === start && !(d === s.dir || canTurn(s, d))) continue;
      const nx = cx + DELTA[d].x, ny = cy + DELTA[d].y, k = ny * w + nx;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || blocked.has(k) || prev.has(k)) continue;
      prev.set(k, [cur, d]);
      q.push(k);
    }
  }
  // No path: take any safe turn.
  for (const d of ["U", "D", "L", "R"] as Dir[]) {
    const n = { x: head.x + DELTA[d].x, y: head.y + DELTA[d].y };
    if (n.x >= 0 && n.y >= 0 && n.x < w && n.y < h && !blocked.has(n.y * w + n.x) && (d === s.dir || canTurn(s, d)))
      return d === s.dir ? undefined : d;
  }
  return undefined;
}

function playWithBot(ch: Challenge): LiveRun {
  const run = new LiveRun(ch);
  while (run.state.status === "running") {
    const d = botDir(run.state, ch.rules.width, ch.rules.height);
    if (d) run.queue(d);
    run.advance();
  }
  return run;
}

test("same seed + same inputs -> identical game states", () => {
  const ch = challenge(12345);
  const run = playWithBot(ch);
  const a = replay(ch, run.inputs);
  const b = replay(ch, run.inputs);
  assert.ok(a.ok && b.ok);
  assert.equal(serializeState(a.finalState), serializeState(b.finalState));
  assert.equal(serializeState(a.finalState), serializeState(run.state)); // matches live play
  assert.equal(a.result.finalStateHash, b.result.finalStateHash);
});

test("replaying a run reproduces its final score", () => {
  const ch = challenge(2026);
  const run = playWithBot(ch);
  assert.equal(run.state.status, "completed", "bot should finish the circuit");
  const r = replay(ch, run.inputs);
  assert.ok(r.ok);
  assert.equal(r.result.status, "completed");
  assert.equal(r.result.ticks, run.state.tick);
  assert.equal(r.result.packets, ch.rules.packetsToWin);
  assert.equal(r.result.moves, run.state.moves);
});

test("changing one input changes the replay result", () => {
  const ch = challenge(2026);
  const run = playWithBot(ch);
  const original = replay(ch, run.inputs);
  assert.ok(original.ok);

  const tampered: Input[] = run.inputs.map((i) => ({ ...i }));
  const mid = Math.floor(tampered.length / 2);
  tampered[mid] = { ...tampered[mid], tick: tampered[mid].tick + 1 };
  if (mid + 1 < tampered.length && tampered[mid + 1].tick <= tampered[mid].tick) tampered[mid].tick -= 2;

  assert.notEqual(replayHash(ch, tampered), original.result.replayHash);
  const t = replay(ch, tampered);
  if (t.ok) assert.notEqual(t.result.finalStateHash, original.result.finalStateHash);
});

test("reverse and no-op direction inputs are rejected", () => {
  const ch = challenge(1);
  const s = createGame(ch); // moving R
  assert.equal(canTurn(s, "L"), false);
  assert.equal(canTurn(s, "R"), false);
  assert.equal(canTurn(s, "U"), true);
  assert.throws(() => step(s, ch.rules, "L"), /cannot turn/);
  const r = replay(ch, [{ tick: 0, dir: "L" }]);
  assert.deepEqual(r, { ok: false, error: "invalid-input", atIndex: 0 });
});

test("wall and self collisions are detected consistently", () => {
  const open = { ...RULES_V1, version: "test-open", obstacleCount: 0 };
  const ch = challenge(7, open);

  // Wall: never turn, run straight into the right wall.
  const a = replay(ch, []);
  const b = replay(ch, []);
  assert.ok(a.ok && b.ok);
  assert.equal(a.result.deathCause, "wall");
  assert.equal(a.result.ticks, open.width - open.startLength); // head starts at x = startLength
  assert.equal(a.result.finalStateHash, b.result.finalStateHash);

  // Self: hand-built hook shape, turning into own body.
  const base = createGame(ch);
  const hooked: GameState = {
    ...base,
    snake: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 4, y: 6 }, { x: 4, y: 5 }, { x: 4, y: 4 }],
    dir: "U",
    food: { x: 20, y: 20 },
  };
  const dead = step(hooked, open, "L");
  assert.equal(dead.status, "dead");
  assert.equal(dead.deathCause, "self");

  // Chasing your own tail is legal: the tail moves away this tick.
  const loop: GameState = {
    ...base,
    snake: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 4, y: 6 }, { x: 4, y: 5 }],
    dir: "U",
    food: { x: 20, y: 20 },
  };
  assert.equal(step(loop, open, "L").status, "running");
});

test("different seeds produce different challenges", () => {
  const a = serializeState(createGame(challenge(1)));
  const b = serializeState(createGame(challenge(2)));
  assert.notEqual(a, b);
  assert.equal(a, serializeState(createGame(challenge(1))));
});

test("malformed logs are rejected", () => {
  const ch = challenge(1);
  assert.equal(replay(ch, [{ tick: 3, dir: "U" }, { tick: 3, dir: "L" }]).ok, false);
  assert.equal(replay(ch, [{ tick: -1, dir: "U" }]).ok, false);
  assert.equal(replay(ch, [{ tick: 1, dir: "X" as Dir }]).ok, false);
  const r = replay(ch, [{ tick: 99999, dir: "U" }]);
  assert.ok(!r.ok && r.error === "input-after-end");
});

test("leaderboard order and commitment message", () => {
  const ch = challenge(2026);
  const r = replay(ch, playWithBot(ch).inputs);
  const dead = replay(ch, []);
  assert.ok(r.ok && dead.ok);
  assert.ok(compareRuns(r.result, dead.result) < 0);

  const msg = buildCommitment({
    chainId: "qorechain-diana",
    challengeId: ch.id,
    sessionNonce: "n-123",
    address: "qor1example",
    ruleset: ch.rules.version,
    replaySha256: r.result.replayHash,
  });
  assert.match(msg, /^TRACE\/\/RUN\/v1\n/);
  assert.throws(() => buildCommitment({ chainId: "x\ny", challengeId: "a", sessionNonce: "b", address: "c", ruleset: "d", replaySha256: r.result.replayHash }));
});

test("anchor memo round-trips and fits the 256-byte memo limit", async () => {
  const { buildAnchorMemo, parseAnchorMemo } = await import("../src/index.js");
  const h = "ab".repeat(32);
  const memo = buildAnchorMemo("daily-2026-11-26", h);
  assert.equal(memo, `TRACE//RUN v1 daily-2026-11-26 ${h}`);
  assert.ok(new TextEncoder().encode(memo).length <= 256);
  assert.deepEqual(parseAnchorMemo(memo), { challengeId: "daily-2026-11-26", replaySha256: h });
  assert.equal(parseAnchorMemo(memo + " extra"), null);
  assert.throws(() => buildAnchorMemo("daily 2026", h));
  assert.throws(() => buildAnchorMemo("daily-2026-11-26", "XYZ"));
});
