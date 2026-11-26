import { useEffect, useRef } from "react";
import type { Cell, GameState, Ruleset } from "@tracerun/engine";

// Forensic Arcade palette. Lime is reserved for the player and the goal;
// teal means "being verified"; deaths stay neutral (losing is not an error).
const C = {
  bg: "#090d0c",
  grid: "rgba(232, 238, 233, 0.05)",
  gridMajor: "rgba(232, 238, 233, 0.09)",
  text: "#e8eee9",
  muted: "#89978d",
  lime: "#d6ff5f",
  teal: "#55d9c2",
  hazard: "#151d19",
  hazardEdge: "rgba(137, 151, 141, 0.45)",
};

interface Props {
  state: GameState;
  rules: Ruleset;
  /** Draw the snake in "replay" (verification) tone. */
  ghost?: boolean;
  /** Disable pulsing animation. */
  still?: boolean;
}

/**
 * Canvas renderer. Reads the latest state from a ref inside its own
 * animation loop, so pulses animate smoothly between game ticks.
 * Rendering never touches game logic.
 */
export function Board({ state, rules, ghost = false, still = false }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const ghostRef = useRef(ghost);
  ghostRef.current = ghost;
  const stillRef = useRef(still);
  stillRef.current = still;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;

    const draw = (t: number) => {
      const size = canvas.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(size * dpr)) {
        canvas.width = Math.round(size * dpr);
        canvas.height = Math.round(size * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cell = size / rules.width;
      const s = stateRef.current;
      const pulse = stillRef.current ? 0.6 : 0.5 + 0.5 * Math.sin(t / 260);

      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, size, size);

      // Hairline grid, with a slightly stronger line every 6 cells.
      for (const major of [false, true]) {
        ctx.strokeStyle = major ? C.gridMajor : C.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 1; i < rules.width; i++) {
          if ((i % 6 === 0) !== major) continue;
          const p = Math.round(i * cell) + 0.5;
          ctx.moveTo(p, 0);
          ctx.lineTo(p, size);
          ctx.moveTo(0, p);
          ctx.lineTo(size, p);
        }
        ctx.stroke();
      }

      const rect = (c: Cell, inset: number) =>
        [c.x * cell + inset, c.y * cell + inset, cell - inset * 2, cell - inset * 2] as const;

      // Obstacles: hatched blocks.
      for (const o of s.obstacles) {
        const [x, y, w, h] = rect(o, 1);
        ctx.fillStyle = C.hazard;
        ctx.fillRect(x, y, w, h);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.strokeStyle = C.hazardEdge;
        ctx.lineWidth = 1;
        for (let k = -h; k < w; k += 5) {
          ctx.moveTo(x + k, y + h);
          ctx.lineTo(x + k + h, y);
        }
        ctx.stroke();
        ctx.restore();
      }

      // Data packet: a bright square inside a thin bracket.
      if (s.food) {
        const [x, y, w] = rect(s.food, cell * 0.28);
        ctx.fillStyle = C.text;
        ctx.fillRect(x, y, w, w);
        const [bx, by, bw] = rect(s.food, cell * 0.1);
        ctx.strokeStyle = `rgba(232, 238, 233, ${0.25 + 0.45 * pulse})`;
        ctx.lineWidth = 1;
        ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bw - 1);
      }

      // Extraction gate.
      if (s.exit) {
        const cx = (s.exit.x + 0.5) * cell;
        const cy = (s.exit.y + 0.5) * cell;
        ctx.strokeStyle = C.lime;
        ctx.lineWidth = 1.5;
        for (let r = 0; r < 3; r++) {
          const rr = ((pulse + r / 3) % 1) * cell * 1.4 + cell * 0.2;
          ctx.globalAlpha = 1 - ((pulse + r / 3) % 1);
          ctx.strokeRect(cx - rr / 2, cy - rr / 2, rr, rr);
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = C.lime;
        const [x, y, w] = rect(s.exit, cell * 0.3);
        ctx.fillRect(x, y, w, w);
      }

      // Snake: body fades toward the tail.
      const n = s.snake.length;
      for (let i = n - 1; i >= 0; i--) {
        const seg = s.snake[i];
        const head = i === 0;
        const fade = n > 1 ? 1 - (i / (n - 1)) * 0.6 : 1;
        const [x, y, w, h] = rect(seg, head ? 1 : 2.5);
        const dead = s.status === "dead";
        if (head) {
          ctx.fillStyle = dead ? C.muted : ghostRef.current ? C.teal : C.lime;
        } else {
          ctx.fillStyle = ghostRef.current
            ? `rgba(85, 217, 194, ${0.2 + 0.55 * fade})`
            : dead
              ? `rgba(137, 151, 141, ${0.18 + 0.4 * fade})`
              : `rgba(232, 238, 233, ${0.2 + 0.62 * fade})`;
        }
        ctx.fillRect(x, y, w, h);
        if (head && dead) {
          // Neutral "x" on the head where the run ended.
          ctx.strokeStyle = C.bg;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + w * 0.25, y + h * 0.25);
          ctx.lineTo(x + w * 0.75, y + h * 0.75);
          ctx.moveTo(x + w * 0.75, y + h * 0.25);
          ctx.lineTo(x + w * 0.25, y + h * 0.75);
          ctx.stroke();
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [rules]);

  return <canvas ref={canvasRef} className="board" aria-label="Game board" />;
}
