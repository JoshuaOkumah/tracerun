import { canTurn, createGame, EngineError, isDir, step } from "./engine.js";
import { replayHash, stateHash } from "./hash.js";
import type { Challenge, DeathCause, Dir, GameState, Input, Status } from "./types.js";

export interface RunResult {
  status: Status;
  deathCause: DeathCause;
  ticks: number;
  packets: number;
  moves: number;
  replayHash: string;
  finalStateHash: string;
}

export type ReplayOutcome =
  | { ok: true; result: RunResult; finalState: GameState }
  | { ok: false; error: string; atIndex?: number };

/**
 * Re-run a recorded game from scratch. The server trusts ONLY this:
 * never the score or time the client reports.
 */
export function replay(challenge: Challenge, inputs: readonly Input[]): ReplayOutcome {
  // Structural checks first.
  for (let i = 0; i < inputs.length; i++) {
    const inp = inputs[i];
    if (!inp || !Number.isInteger(inp.tick) || inp.tick < 0 || !isDir(inp.dir)) {
      return { ok: false, error: "malformed-input", atIndex: i };
    }
    if (i > 0 && inp.tick <= inputs[i - 1].tick) {
      return { ok: false, error: "ticks-not-increasing", atIndex: i };
    }
  }

  let state: GameState;
  try {
    state = createGame(challenge);
  } catch (e) {
    return { ok: false, error: e instanceof EngineError ? e.code : "bad-challenge" };
  }

  let i = 0;
  while (state.status === "running") {
    let turn: Dir | undefined;
    if (i < inputs.length && inputs[i].tick === state.tick) {
      if (!canTurn(state, inputs[i].dir)) return { ok: false, error: "invalid-input", atIndex: i };
      turn = inputs[i].dir;
      i++;
    }
    state = step(state, challenge.rules, turn);
  }
  if (i < inputs.length) return { ok: false, error: "input-after-end", atIndex: i };

  return {
    ok: true,
    finalState: state,
    result: {
      status: state.status,
      deathCause: state.deathCause,
      ticks: state.tick,
      packets: state.packets,
      moves: state.moves,
      replayHash: replayHash(challenge, inputs),
      finalStateHash: stateHash(state),
    },
  };
}

/**
 * Leaderboard order for Daily Circuit: completed runs first, then fewest
 * ticks, then fewest moves. (Earliest verified submission is the server's
 * final tie-breaker.) Negative = a ranks above b.
 */
export function compareRuns(a: RunResult, b: RunResult): number {
  const ac = a.status === "completed" ? 0 : 1;
  const bc = b.status === "completed" ? 0 : 1;
  if (ac !== bc) return ac - bc;
  if (ac === 1) return b.packets - a.packets || a.ticks - b.ticks; // unfinished: most packets
  return a.ticks - b.ticks || a.moves - b.moves;
}
