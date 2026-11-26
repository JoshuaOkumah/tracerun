import { randInt } from "./rng.js";
import type { Cell, Challenge, Dir, GameState, Ruleset } from "./types.js";

export const RULES_V1: Ruleset = Object.freeze({
  version: "snake-v1",
  width: 24,
  height: 24,
  tickMs: 110,
  startLength: 3,
  packetsToWin: 12,
  obstacleCount: 20,
  maxTicks: 5000,
});

export class EngineError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
    this.name = "EngineError";
  }
}

const DELTA: Record<Dir, Cell> = {
  U: { x: 0, y: -1 },
  D: { x: 0, y: 1 },
  L: { x: -1, y: 0 },
  R: { x: 1, y: 0 },
};

const OPPOSITE: Record<Dir, Dir> = { U: "D", D: "U", L: "R", R: "L" };

export const DIRS: readonly Dir[] = ["U", "D", "L", "R"];

export function isDir(v: unknown): v is Dir {
  return v === "U" || v === "D" || v === "L" || v === "R";
}

const same = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;
const key = (c: Cell, w: number) => c.y * w + c.x;

/** Pick a random cell not in `blocked`. Deterministic given rng state. */
function spawnFree(
  rng: number,
  rules: Ruleset,
  blocked: Set<number>,
): [rng: number, cell: Cell | null] {
  const { width: w, height: h } = rules;
  const total = w * h;
  if (blocked.size >= total) return [rng, null];

  // Fast path: a few random tries.
  for (let i = 0; i < 64; i++) {
    let idx: number;
    [rng, idx] = randInt(rng, total);
    if (!blocked.has(idx)) return [rng, { x: idx % w, y: Math.floor(idx / w) }];
  }
  // Slow path: scan from a random offset so we always terminate.
  let start: number;
  [rng, start] = randInt(rng, total);
  for (let i = 0; i < total; i++) {
    const idx = (start + i) % total;
    if (!blocked.has(idx)) return [rng, { x: idx % w, y: Math.floor(idx / w) }];
  }
  return [rng, null];
}

function occupied(state: GameState, w: number, includeItems: boolean): Set<number> {
  const s = new Set<number>();
  for (const c of state.snake) s.add(key(c, w));
  for (const c of state.obstacles) s.add(key(c, w));
  if (includeItems) {
    if (state.food) s.add(key(state.food, w));
    if (state.exit) s.add(key(state.exit, w));
  }
  return s;
}

/** Build the starting state for a challenge. Same challenge -> same state, always. */
export function createGame(challenge: Challenge): GameState {
  const { rules } = challenge;
  if (!Number.isInteger(challenge.seed) || challenge.seed < 0 || challenge.seed > 0xffffffff) {
    throw new EngineError("bad-seed", "seed must be an unsigned 32-bit integer");
  }
  const { width: w, height: h, startLength } = rules;
  const midY = Math.floor(h / 2);
  const headX = startLength; // body extends left to x = 1

  const snake: Cell[] = [];
  for (let i = 0; i < startLength; i++) snake.push({ x: headX - i, y: midY });

  let rng = challenge.seed >>> 0;

  // Obstacles: avoid a safe corridor in front of the starting snake.
  const blocked = new Set<number>(snake.map((c) => key(c, w)));
  for (let y = midY - 1; y <= midY + 1; y++) {
    for (let x = 0; x <= headX + 5; x++) {
      if (y >= 0 && y < h && x < w) blocked.add(key({ x, y }, w));
    }
  }
  const obstacles: Cell[] = [];
  for (let i = 0; i < rules.obstacleCount; i++) {
    let cell: Cell | null;
    [rng, cell] = spawnFree(rng, rules, blocked);
    if (!cell) break;
    obstacles.push(cell);
    blocked.add(key(cell, w));
  }

  const state: GameState = {
    tick: 0,
    snake,
    dir: "R",
    rng,
    obstacles,
    food: null,
    exit: null,
    packets: 0,
    moves: 0,
    status: "running",
    deathCause: null,
  };

  let food: Cell | null;
  [state.rng, food] = spawnFree(state.rng, rules, occupied(state, w, true));
  state.food = food;
  return state;
}

/** A turn is valid only while running, and never a reverse or a no-op. */
export function canTurn(state: GameState, dir: Dir): boolean {
  return state.status === "running" && dir !== state.dir && dir !== OPPOSITE[state.dir];
}

/**
 * Advance exactly one tick. Pure: returns a new state, never mutates.
 * `turn` (optional) is applied before moving. Invalid turns throw.
 */
export function step(state: GameState, rules: Ruleset, turn?: Dir): GameState {
  if (state.status !== "running") throw new EngineError("not-running");
  if (turn !== undefined && !canTurn(state, turn)) {
    throw new EngineError("invalid-input", `cannot turn ${turn} while moving ${state.dir}`);
  }

  const { width: w, height: h } = rules;
  const dir = turn ?? state.dir;
  const moves = state.moves + (turn ? 1 : 0);
  const head = state.snake[0];
  const next: Cell = { x: head.x + DELTA[dir].x, y: head.y + DELTA[dir].y };
  const tick = state.tick + 1;

  const base: GameState = { ...state, tick, dir, moves };
  const die = (deathCause: GameState["deathCause"]): GameState => ({
    ...base,
    status: "dead",
    deathCause,
  });

  if (next.x < 0 || next.y < 0 || next.x >= w || next.y >= h) return die("wall");
  if (state.obstacles.some((o) => same(o, next))) return die("obstacle");

  const growing = state.food !== null && same(state.food, next);
  // The tail moves away this tick unless we grow, so it is safe to enter.
  const body = growing ? state.snake : state.snake.slice(0, -1);
  if (body.some((c) => same(c, next))) return die("self");

  const snake = [next, ...body];

  if (state.exit && same(state.exit, next)) {
    return { ...base, snake, status: "completed" };
  }

  let s: GameState = { ...base, snake };
  if (growing) {
    s = { ...s, packets: state.packets + 1, food: null };
    let cell: Cell | null;
    if (s.packets >= rules.packetsToWin) {
      [s.rng, cell] = spawnFree(s.rng, rules, occupied(s, w, true));
      s.exit = cell;
    } else {
      [s.rng, cell] = spawnFree(s.rng, rules, occupied(s, w, true));
      s.food = cell;
    }
  }

  if (s.status === "running" && tick >= rules.maxTicks) {
    return { ...s, status: "dead", deathCause: "timeout" };
  }
  return s;
}

/** Canonical, order-fixed serialisation of a state (for hashing and comparison). */
export function serializeState(s: GameState): string {
  const cells = (cs: Cell[]) => cs.map((c) => `${c.x}.${c.y}`).join(" ");
  const one = (c: Cell | null) => (c ? `${c.x}.${c.y}` : "-");
  return [
    `tick:${s.tick}`,
    `status:${s.status}`,
    `death:${s.deathCause ?? "-"}`,
    `dir:${s.dir}`,
    `rng:${s.rng}`,
    `packets:${s.packets}`,
    `moves:${s.moves}`,
    `food:${one(s.food)}`,
    `exit:${one(s.exit)}`,
    `snake:${cells(s.snake)}`,
    `obstacles:${cells(s.obstacles)}`,
  ].join("\n");
}
