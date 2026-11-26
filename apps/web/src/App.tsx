import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LiveRun,
  RULES_V1,
  createGame,
  replay,
  seedFromString,
  stateHash,
  step,
  type Challenge,
  type Dir,
  type GameState,
  type Input,
  type RunResult,
} from "@tracerun/engine";
import { Board } from "./Board";
import "./styles.css";

type Mode = "idle" | "playing" | "ended" | "replaying";

const KEYS: Record<string, Dir> = {
  ArrowUp: "U", ArrowDown: "D", ArrowLeft: "L", ArrowRight: "R",
  w: "U", s: "D", a: "L", d: "R", W: "U", S: "D", A: "L", D: "R",
};

const ARROW: Record<Dir, string> = { U: "↑", D: "↓", L: "←", R: "→" };

/**
 * Today's shared challenge. For now the seed is derived client-side from the
 * UTC date; the verification server will issue it (with a session nonce) later.
 */
function dailyChallenge(): Challenge {
  const day = new Date().toISOString().slice(0, 10);
  return { id: `daily-${day}`, seed: seedFromString(`tracerun-daily:${day}`), rules: RULES_V1 };
}

const pad = (n: number, w = 4) => String(n).padStart(w, "0");
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

function loadBest(id: string): number | null {
  try {
    const v = localStorage.getItem(`tracerun:best:${id}`);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}
function saveBest(id: string, ticks: number): void {
  try {
    localStorage.setItem(`tracerun:best:${id}`, String(ticks));
  } catch {
    /* storage unavailable: personal best just isn't remembered */
  }
}

export function App(): JSX.Element {
  const challenge = useMemo(dailyChallenge, []);
  const chainId = import.meta.env.VITE_QORE_CHAIN_ID ?? "qorechain-diana";

  const runRef = useRef<LiveRun | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [state, setState] = useState<GameState>(() => createGame(challenge));
  const [inputs, setInputs] = useState<Input[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [reproduced, setReproduced] = useState<boolean | null>(null);
  const [replayCheck, setReplayCheck] = useState<boolean | null>(null);
  const [best, setBest] = useState<number | null>(() => loadBest(challenge.id));

  const start = useCallback(() => {
    runRef.current = new LiveRun(challenge);
    setState(runRef.current.state);
    setInputs([]);
    setResult(null);
    setReproduced(null);
    setReplayCheck(null);
    setMode("playing");
  }, [challenge]);

  const finish = useCallback(
    (run: LiveRun) => {
      // Verify our own run the same way the server will: replay from scratch.
      const out = replay(challenge, run.inputs);
      if (out.ok) {
        setResult(out.result);
        setReproduced(out.result.finalStateHash === stateHash(run.state));
        if (out.result.status === "completed" && (best === null || out.result.ticks < best)) {
          saveBest(challenge.id, out.result.ticks);
          setBest(out.result.ticks);
        }
      } else {
        setReproduced(false);
      }
      setMode("ended");
    },
    [challenge, best],
  );

  // Fixed-timestep game loop: render as often as you like, simulate every tickMs.
  useEffect(() => {
    if (mode !== "playing") return;
    const run = runRef.current!;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      acc += Math.min(now - last, 250);
      last = now;
      let changed = false;
      while (acc >= challenge.rules.tickMs && run.state.status === "running") {
        run.advance();
        acc -= challenge.rules.tickMs;
        changed = true;
      }
      if (changed) {
        setState(run.state);
        setInputs([...run.inputs]);
      }
      if (run.state.status !== "running") {
        finish(run);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mode, challenge, finish]);

  // Watch Replay: re-simulate the recorded inputs at 2x and check the result.
  const watchReplay = useCallback(() => {
    const log = runRef.current?.inputs ?? [];
    let s = createGame(challenge);
    let i = 0;
    setState(s);
    setReplayCheck(null);
    setMode("replaying");
    const id = window.setInterval(() => {
      if (s.status !== "running") {
        window.clearInterval(id);
        setReplayCheck(result ? stateHash(s) === result.finalStateHash : false);
        setMode("ended");
        return;
      }
      let turn: Dir | undefined;
      if (i < log.length && log[i].tick === s.tick) turn = log[i++].dir;
      s = step(s, challenge.rules, turn);
      setState(s);
    }, challenge.rules.tickMs / 2);
  }, [challenge, result]);

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir = KEYS[e.key];
      if (dir) {
        e.preventDefault();
        if (mode === "playing") runRef.current?.queue(dir);
        return;
      }
      if ((e.key === " " || e.key === "Enter") && (mode === "idle" || mode === "ended")) {
        e.preventDefault();
        start();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, start]);

  // Swipe (mobile).
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    // Buttons on the overlays handle their own clicks.
    if ((e.target as HTMLElement).closest("button")) {
      touch.current = null;
      return;
    }
    touch.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const t = touch.current;
    touch.current = null;
    if (!t) return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) {
      if (mode === "idle" || mode === "ended") start();
      return;
    }
    if (mode !== "playing") return;
    runRef.current?.queue(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "R" : "L") : dy > 0 ? "D" : "U");
  };

  const logRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [inputs.length]);

  const { packetsToWin } = challenge.rules;
  const statusLine =
    mode === "replaying"
      ? "REPLAYING SIGNED INPUTS"
      : state.status === "completed"
        ? "EXTRACTED"
        : state.status === "dead"
          ? `TERMINATED · ${state.deathCause?.toUpperCase()}`
          : state.exit
            ? "GATE OPEN · EXTRACT"
            : mode === "playing"
              ? "RUN IN PROGRESS"
              : "STANDBY";

  return (
    <div className="shell">
      <header className="masthead">
        <h1 className="wordmark">
          TRACE<span>//</span>RUN
        </h1>
        <p className="tagline">Every move leaves proof.</p>
        <dl className="meta">
          <div><dt>Circuit</dt><dd>{challenge.id}</dd></div>
          <div><dt>Ruleset</dt><dd>{challenge.rules.version}</dd></div>
          <div><dt>Network</dt><dd>{chainId}</dd></div>
        </dl>
      </header>

      <main className="stage">
        <section className="arena">
          <div className="hud">
            <span className="stat"><em>Tick</em>{pad(state.tick)}</span>
            <span className="stat"><em>Packets</em>{state.packets}/{packetsToWin}</span>
            <span className="stat"><em>Moves</em>{pad(state.moves, 3)}</span>
            <span className={`status ${state.status}`}>{statusLine}</span>
          </div>

          <div className="board-wrap" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
            <Board state={state} rules={challenge.rules} ghost={mode === "replaying"} />

            {mode === "idle" && (
              <div className="overlay">
                <p className="kicker">Daily Circuit</p>
                <h2>Collect {packetsToWin} packets. Reach the gate. Fewest ticks wins.</h2>
                <p className="hint">Arrows / WASD · swipe on mobile</p>
                <button className="primary" onClick={start}>Start run <kbd>Space</kbd></button>
              </div>
            )}

            {mode === "ended" && result && (
              <div className="overlay">
                <p className="kicker">{result.status === "completed" ? "Run complete" : "Run terminated"}</p>
                <h2 className="big">
                  {result.status === "completed" ? `${result.ticks} ticks` : `${result.packets}/${packetsToWin} packets`}
                </h2>
                <ul className="checks">
                  <li className={reproduced ? "ok" : "bad"}>
                    {reproduced ? "Inputs reproduce this result" : "Replay mismatch"}
                  </li>
                  {replayCheck !== null && (
                    <li className={replayCheck ? "ok" : "bad"}>
                      {replayCheck ? "Replay re-verified" : "Replay check failed"}
                    </li>
                  )}
                  <li className="pending">Wallet signature: connect QoreX (next milestone)</li>
                </ul>
                <div className="actions">
                  <button className="primary" onClick={start}>Run again <kbd>Space</kbd></button>
                  <button onClick={watchReplay}>Watch replay</button>
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="trace">
          <h3>Input trace</h3>
          <p className="trace-sub">Only accepted turns are recorded. This log, not the score, is what gets signed.</p>
          <ol className="log" ref={logRef}>
            {inputs.length === 0 && <li className="empty">— awaiting first turn —</li>}
            {inputs.map((i) => (
              <li key={i.tick}>
                <span className="t">t{pad(i.tick)}</span>
                <span className="d">{ARROW[i.dir]} {i.dir}</span>
              </li>
            ))}
          </ol>
          <dl className="proof">
            <div><dt>Replay SHA-256</dt><dd>{result ? short(result.replayHash) : "—"}</dd></div>
            <div><dt>Final state</dt><dd>{result ? short(result.finalStateHash) : "—"}</dd></div>
            <div><dt>Personal best</dt><dd>{best !== null ? `${best} ticks` : "—"}</dd></div>
          </dl>
        </aside>
      </main>

      <footer className="foot">
        <span>Verified = these signed inputs reproduce this score. Not proof that a human played.</span>
        <span>QoreChain · Build Before Q-Day</span>
      </footer>
    </div>
  );
}
