import { canTurn, createGame, step } from "./engine.js";
import type { Challenge, Dir, GameState, Input } from "./types.js";

/**
 * Client-side driver: the UI calls `queue()` on key press and `advance()`
 * once per tick (every rules.tickMs). Only accepted turns are recorded.
 * A 2-deep buffer lets quick double-taps (e.g. up-then-left) both land.
 */
export class LiveRun {
  state: GameState;
  readonly inputs: Input[] = [];
  private buffer: Dir[] = [];

  constructor(readonly challenge: Challenge) {
    this.state = createGame(challenge);
  }

  queue(dir: Dir): void {
    if (this.buffer.length < 2 && this.buffer[this.buffer.length - 1] !== dir) this.buffer.push(dir);
  }

  advance(): GameState {
    if (this.state.status !== "running") return this.state;
    let turn: Dir | undefined;
    while (this.buffer.length) {
      const d = this.buffer.shift()!;
      if (canTurn(this.state, d)) {
        turn = d;
        break;
      }
    }
    if (turn) this.inputs.push({ tick: this.state.tick, dir: turn });
    this.state = step(this.state, this.challenge.rules, turn);
    return this.state;
  }
}
