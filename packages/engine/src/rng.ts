/**
 * mulberry32: a small, fast, deterministic 32-bit PRNG.
 * Uses only integer ops and Math.imul, so it gives identical results in
 * every JS engine (browser and Node). Never use Math.random() in the engine.
 */
export function nextRandom(state: number): [nextState: number, value: number] {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [s, (t ^ (t >>> 14)) >>> 0];
}

/** Integer in [0, n). */
export function randInt(state: number, n: number): [nextState: number, value: number] {
  const [s, v] = nextRandom(state);
  return [s, v % n];
}
