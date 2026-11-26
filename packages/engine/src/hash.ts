import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { serializeState } from "./engine.js";
import type { Challenge, GameState, Input } from "./types.js";

export const REPLAY_FORMAT = "TRACE-RUN-REPLAY-V1";

export const sha256Hex = (text: string): string => bytesToHex(sha256(utf8ToBytes(text)));

/** Derive a 32-bit seed from any string (e.g. a server secret + challenge id). */
export function seedFromString(text: string): number {
  const h = sha256(utf8ToBytes(text));
  return ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
}

/**
 * Canonical replay encoding. Same challenge + same inputs -> same bytes,
 * on every machine. This is what gets hashed and committed.
 */
export function encodeReplay(challenge: Challenge, inputs: readonly Input[]): string {
  if (/[\r\n]/.test(challenge.id)) throw new Error("challenge id must not contain newlines");
  return [
    REPLAY_FORMAT,
    `challenge:${challenge.id}`,
    `ruleset:${challenge.rules.version}`,
    `seed:${challenge.seed >>> 0}`,
    `inputs:${inputs.map((i) => `${i.tick}${i.dir}`).join(",")}`,
  ].join("\n");
}

export const replayHash = (challenge: Challenge, inputs: readonly Input[]): string =>
  sha256Hex(encodeReplay(challenge, inputs));

export const stateHash = (state: GameState): string => sha256Hex(serializeState(state));
