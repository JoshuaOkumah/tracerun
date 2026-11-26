/** Direction of travel. Single letters keep replay logs compact. */
export type Dir = "U" | "D" | "L" | "R";

export interface Cell {
  x: number;
  y: number;
}

/**
 * Versioned rules. If any mechanic changes, bump `version` so old replays
 * are never re-evaluated under new rules.
 */
export interface Ruleset {
  version: string;
  width: number;
  height: number;
  /** Real-time length of one tick in the client. Not used by the simulation. */
  tickMs: number;
  startLength: number;
  /** Packets to collect before the extraction gate appears. */
  packetsToWin: number;
  obstacleCount: number;
  /** Hard cap: a run still going at this tick ends as a timeout. */
  maxTicks: number;
}

export interface Challenge {
  /** e.g. "daily-2026-11-26". Must not contain newlines. */
  id: string;
  /** Unsigned 32-bit seed. */
  seed: number;
  rules: Ruleset;
}

export type Status = "running" | "dead" | "completed";
export type DeathCause = "wall" | "self" | "obstacle" | "timeout" | null;

export interface GameState {
  tick: number;
  /** Head first. */
  snake: Cell[];
  /** Direction of the most recent move. */
  dir: Dir;
  /** PRNG state. Kept in the game state so it is fully serialisable. */
  rng: number;
  obstacles: Cell[];
  food: Cell | null;
  exit: Cell | null;
  packets: number;
  /** Accepted direction changes. Tie-breaker on the leaderboard. */
  moves: number;
  status: Status;
  deathCause: DeathCause;
}

/** One accepted direction change, applied before the move from `tick` to `tick + 1`. */
export interface Input {
  tick: number;
  dir: Dir;
}
