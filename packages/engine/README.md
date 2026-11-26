# @tracerun/engine

Deterministic Snake engine and replay verifier for **TRACE//RUN**. No React, wallet or server dependencies. The same code runs in the browser (live play) and on the server (verification).

## Guarantees

- Same challenge (id, seed, ruleset) + same inputs → byte-identical game state, in any JS runtime.
- No `Math.random()`, `Date.now()` or frame-rate dependence. Randomness comes from a seeded mulberry32 PRNG whose state is stored in `GameState`.
- The server never trusts client-reported score or time. It calls `replay()` and uses that result only.
- Replay format is versioned (`TRACE-RUN-REPLAY-V1`) and the ruleset is versioned (`snake-v1`), so old runs are never judged under new rules.

**What it does not prove:** a verified run means "these signed inputs reproduce this score". It does not prove a human pressed the keys.

## Rules (snake-v1)

24×24 grid, no wrap-around, 20 seeded obstacles, start length 3 heading right. Collect 12 packets, then an extraction gate appears; entering it completes the run. Walls, obstacles and your own body kill you (moving into the tail cell is allowed, since it moves away). Hard cap of 5,000 ticks. Ranking: completed first → fewest ticks → fewest moves.

## API

```ts
import { RULES_V1, LiveRun, replay, buildCommitment } from "@tracerun/engine";

const challenge = { id: "daily-2026-11-26", seed: 123456789, rules: RULES_V1 };

// Client: call queue() on key press, advance() every rules.tickMs ms.
const run = new LiveRun(challenge);
run.queue("U");
run.advance();            // returns the new GameState to render
run.inputs;               // [{ tick: 0, dir: "U" }]: accepted turns only

// Server: re-run from scratch and trust only this result.
const out = replay(challenge, run.inputs);
if (out.ok) out.result;   // { status, ticks, packets, moves, replayHash, finalStateHash }
else out.error;           // "invalid-input" | "ticks-not-increasing" | "input-after-end" | ...

// Message for QoreX signArbitrary (1–4096 bytes; checked).
buildCommitment({ chainId: "qorechain-diana", challengeId: challenge.id,
  sessionNonce, address, ruleset: RULES_V1.version, replaySha256: out.result.replayHash });
```

Other exports: `createGame`, `step`, `canTurn`, `compareRuns`, `encodeReplay`, `replayHash`, `stateHash`, `seedFromString`, `serializeState`.

## Scripts

```bash
npm install
npm test        # 8 tests
npm run build   # emits dist/
```
