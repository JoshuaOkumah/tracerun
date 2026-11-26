import { useEffect, useRef } from "react";
import type { Cell, GameState, Ruleset } from "@tracerun/engine";

const C = {
  bg: "#0b0b0c",
  grid: "rgba(237, 232, 220, 0.045)",
  bone: "#ede8dc",
  dim: "#77736b",
  signal: "#ff5a1f",
  hazard: "#26262a",
  hazardEdge: "rgba(237, 232, 220, 0.16)",
  dead: "#e5484d",
};

interface Props {
  state: GameState;
  rules: Ruleset;
  /** Draw the snake in "replay" tone. */
  ghost?: boolean;
}

/**
 * Canvas renderer. Reads the latest state from a ref inside its own
 * animation loop, so pulses animate smoothly between game ticks.
 * Rendering never touches game logic.
 */
export function Board({ state, rules, ghost = false }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const ghostRef = useRef(ghost);
  ghostRef.current = ghost;

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
      const pulse = 0.5 + 0.5 * Math.sin(t / 260);

      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, size, size);

      // Hairline grid.
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < rules.width; i++) {
        const p = Math.round(i * cell) + 0.5;
        ctx.moveTo(p, 0);
        ctx.lineTo(p, size);
        ctx.moveTo(0, p);
        ctx.lineTo(size, p);
      }
      ctx.stroke();

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

      // Data packet.
      if (s.food) {
        const [x, y, w] = rect(s.food, cell * 0.22);
        ctx.fillStyle = C.signal;
        ctx.shadowColor = C.signal;
        ctx.shadowBlur = 8 + 8 * pulse;
        ctx.fillRect(x, y, w, w);
        ctx.shadowBlur = 0;
      }

      // Extraction gate.
      if (s.exit) {
        const cx = (s.exit.x + 0.5) * cell;
        const cy = (s.exit.y + 0.5) * cell;
        ctx.strokeStyle = C.signal;
        ctx.lineWidth = 2;
        for (let r = 0; r < 3; r++) {
          const rr = ((pulse + r / 3) % 1) * cell * 1.4 + cell * 0.2;
          ctx.globalAlpha = 1 - ((pulse + r / 3) % 1);
          ctx.strokeRect(cx - rr / 2, cy - rr / 2, rr, rr);
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = C.bone;
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
        if (head) {
          ctx.fillStyle = s.status === "dead" ? C.dead : ghostRef.current ? C.signal : C.bone;
          ctx.shadowColor = ctx.fillStyle;
          ctx.shadowBlur = 10;
        } else {
          ctx.fillStyle = ghostRef.current
            ? `rgba(255, 90, 31, ${0.25 + 0.5 * fade})`
            : `rgba(237, 232, 220, ${0.22 + 0.6 * fade})`;
        }
        ctx.fillRect(x, y, w, h);
        ctx.shadowBlur = 0;
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [rules]);

  return <canvas ref={canvasRef} className="board" aria-label="Game board" />;
}
