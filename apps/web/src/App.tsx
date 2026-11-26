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
import { Receipt } from "./Receipt";
import "./fonts";
import "./styles.css";

type Mode = "idle" | "playing" | "ended" | "replaying";

const KEYS: Record<string, Dir> = {
  ArrowUp: "U", ArrowDown: "D", ArrowLeft: "L", ArrowRight: "R",
  w: "U", s: "D", a: "L", d: "R", W: "U", S: "D", A: "L", D: "R",
};

const ARROW: Record<Dir, string> = { U: "↑", D: "↓", L: "←", R: "→" };
const DIR_NAME: Record<Dir, string> = { U: "Up", D: "Down", L: "Left", R: "Right" };

/**
 * Today's shared challenge. For now the seed is derived client-side from the
 * UTC date; the verification server will issue it (with a session nonce) later.
 */
function dailyChallenge(): Challenge {
  const day = new Date().toISOString().slice(0, 10);
  return { id: `daily-${day}`, seed: seedFromString(`tracerun-daily:${day}`), rules: RULES_V1 };
}

const pad = (n: number, w = 4) => String(n).padStart(w, "0");

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

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function App(): JSX.Element {
  const challenge = useMemo(dailyChallenge, []);
  const chainId = import.meta.env.VITE_QORE_CHAIN_ID ?? "qorechain-diana";
  const reducedMotion = usePrefersReducedMotion();

  const runRef = useRef<LiveRun | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [state, setState] = useState<GameState>(() => createGame(challenge));
  const [inputs, setInputs] = useState<Input[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [reproduced, setReproduced] = useState<boolean | null>(null);
  const [replayCheck, setReplayCheck] = useState<boolean | null>(null);
  const [best, setBest] = useState<number | null>(() => loadBest(challenge.id));
  const [announce, setAnnounce] = useState("");

  const start = useCallback(() => {
    runRef.current = new LiveRun(challenge);
    setState(runRef.current.state);
    setInputs([]);
    setResult(null);
    setReproduced(null);
    setReplayCheck(null);
    setAnnounce("Run started.");
    setMode("playing");
  }, [challenge]);

  const finish = useCallback(
    (run: LiveRun) => {
      // Check our own run the same way the server will: replay from scratch.
      // This is a LOCAL check only. It is never shown as VERIFIED.
      const out = replay(challenge, run.inputs);
      if (out.ok) {
        setResult(out.result);
        setReproduced(out.result.finalStateHash === stateHash(run.state));
        if (out.result.status === "completed" && (best === null || out.result.ticks < best)) {
          saveBest(challenge.id, out.result.ticks);
          setBest(out.result.ticks);
        }
        setAnnounce(
          out.result.status === "completed"
            ? `Run complete in ${out.result.ticks} ticks.`
            : `Run ended: ${out.result.deathCause}. ${out.result.packets} of ${challenge.rules.packetsToWin} packets.`,
        );
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
    let packets = run.state.packets;
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
        if (run.state.packets !== packets) {
          packets = run.state.packets;
          setAnnounce(
            run.state.exit
              ? "All packets collected. Extraction gate open."
              : `Packet ${packets} of ${challenge.rules.packetsToWin}.`,
          );
        }
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
    setAnnounce("Replaying recorded inputs.");
    setMode("replaying");
    const id = window.setInterval(() => {
      if (s.status !== "running") {
        window.clearInterval(id);
        const ok = result ? stateHash(s) === result.finalStateHash : false;
        setReplayCheck(ok);
        setAnnounce(ok ? "Replay reproduced the same final state." : "Replay did not match.");
        setMode("ended");
        return;
      }
      let turn: Dir | undefined;
      if (i < log.length && log[i].tick === s.tick) turn = log[i++].dir;
      s = step(s, challenge.rules, turn);
      setState(s);
    }, challenge.rules.tickMs / 2);
  }, [challenge, result]);

  const steer = useCallback(
    (dir: Dir) => {
      if (mode === "playing") runRef.current?.queue(dir);
    },
    [mode],
  );

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir = KEYS[e.key];
      if (dir) {
        if (mode === "playing") {
          e.preventDefault();
          steer(dir);
        }
        return;
      }
      const onButton = (e.target as HTMLElement | null)?.closest?.("button");
      if ((e.key === " " || e.key === "Enter") && !onButton && (mode === "idle" || mode === "ended")) {
        e.preventDefault();
        start();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, start, steer]);

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
    steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "R" : "L") : dy > 0 ? "D" : "U");
  };

  const logRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [inputs.length]);

  const { packetsToWin } = challenge.rules;
  const status =
    mode === "replaying"
      ? { text: "Replaying recorded inputs", tone: "verify" }
      : state.status === "completed"
        ? { text: "Extracted", tone: "lime" }
        : state.status === "dead"
          ? { text: `Terminated · ${state.deathCause}`, tone: "muted" }
          : state.exit
            ? { text: "Gate open · extract", tone: "lime" }
            : mode === "playing"
              ? { text: "Run in progress", tone: "text" }
              : { text: "Standby", tone: "muted" };

  return (
    <div className="shell">
      <a className="skip" href="#board">Skip to game</a>

      <header className="masthead">
        <h1 className="wordmark">
          TRACE<span aria-hidden="true">//</span><span className="sr-only"> </span>RUN
        </h1>
        <p className="tagline">Every move leaves proof.</p>
        <dl className="meta">
          <div><dt>Circuit</dt><dd>{challenge.id}</dd></div>
          <div><dt>Ruleset</dt><dd>{challenge.rules.version}</dd></div>
          <div><dt>Network</dt><dd>{chainId}</dd></div>
        </dl>
      </header>

      <main className="stage">
        <section className="arena" aria-label="Daily Circuit">
          <div className="hud">
            <div className="stat"><span className="label">Tick</span><span className="num">{pad(state.tick)}</span></div>
            <div className="stat"><span className="label">Packets</span><span className="num">{state.packets}<small>/{packetsToWin}</small></span></div>
            <div className="stat"><span className="label">Moves</span><span className="num">{pad(state.moves, 3)}</span></div>
            <p className={`status tone-${status.tone}`}>{status.text}</p>
          </div>

          <div className="board-wrap" id="board" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
            <Board state={state} rules={challenge.rules} ghost={mode === "replaying"} still={reducedMotion} />
            <span className="corner tl" aria-hidden="true" />
            <span className="corner tr" aria-hidden="true" />
            <span className="corner bl" aria-hidden="true" />
            <span className="corner br" aria-hidden="true" />

            {mode === "idle" && (
              <div className="overlay">
                <p className="kicker">Daily Circuit · {challenge.id.replace("daily-", "")}</p>
                <h2 className="headline">Collect {packetsToWin} packets.<br />Reach the gate.<br /><em>Fewest ticks wins.</em></h2>
                <p className="hint"><span className="hide-touch">Arrows / WASD to steer</span><span className="show-touch">Swipe or use the pad to steer</span></p>
                <button className="btn primary" onClick={start} autoFocus>
                  Start run <kbd className="hide-touch">Space</kbd>
                </button>
              </div>
            )}

            {mode === "ended" && result && (
              <div className="overlay">
                <p className={`kicker ${result.status === "completed" ? "tone-lime" : "tone-muted"}`}>
                  {result.status === "completed" ? "Run complete" : `Terminated · ${result.deathCause}`}
                </p>
                <h2 className="score">
                  {result.status === "completed" ? (
                    <>{result.ticks}<small>ticks</small></>
                  ) : (
                    <>{result.packets}<small>/{packetsToWin} packets</small></>
                  )}
                </h2>
                <p className="hint">
                  {result.moves} {result.moves === 1 ? "move" : "moves"}
                  {best !== null && result.status === "completed" && result.ticks === best && " · personal best"}
                </p>
                <div className="actions">
                  <button className="btn primary" onClick={start} autoFocus>
                    Run again <kbd className="hide-touch">Space</kbd>
                  </button>
                  <button className="btn" onClick={watchReplay}>Watch replay</button>
                </div>
              </div>
            )}
          </div>

          <div className="pad show-touch" aria-label="Steering controls">
            {(["U", "L", "D", "R"] as Dir[]).map((d) => (
              <button
                key={d}
                className={`pad-btn pad-${d}`}
                aria-label={`Steer ${DIR_NAME[d]}`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  steer(d);
                }}
              >
                {ARROW[d]}
              </button>
            ))}
          </div>
        </section>

        <aside className="side">
          <Receipt
            mode={mode}
            challenge={challenge}
            inputCount={inputs.length}
            result={result}
            reproduced={reproduced}
            replayCheck={replayCheck}
            best={best}
          />

          <section className="trace" aria-label="Input trace">
            <header className="panel-head">
              <h3>Input trace</h3>
              <span className="count">{pad(inputs.length, 3)}</span>
            </header>
            <p className="panel-sub">Only accepted turns are recorded. This log, not the score, is what gets signed.</p>
            <ol className="log" ref={logRef}>
              {inputs.length === 0 && <li className="empty">Awaiting first turn</li>}
              {inputs.map((i) => (
                <li key={i.tick}>
                  <span className="t">t{pad(i.tick)}</span>
                  <span className="d">{ARROW[i.dir]} {i.dir}</span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </main>

      <p className="sr-only" aria-live="polite">{announce}</p>

      <footer className="foot">
        <span>Verified means these signed inputs reproduce this score. It does not prove a human played.</span>
        <span>QoreChain · Build Before Q-Day</span>
      </footer>
    </div>
  );
}
