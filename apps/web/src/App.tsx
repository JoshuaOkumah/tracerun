import { useCallback, useEffect, useRef, useState } from "react";
import {
  LiveRun,
  RULES_V1,
  buildRunMemo,
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
import { Leaderboard } from "./Leaderboard";
import { Receipt, type Submission } from "./Receipt";
import {
  createSession,
  describeApiError,
  getChallenge,
  getLeaderboard,
  getRun,
  restTxUrl,
  submitRunTx,
  type LeaderEntry,
} from "./lib/api";
import {
  DOWNLOAD_URL,
  WalletError,
  connect,
  describeIssue,
  shortAddress,
  signRunTx,
  waitForQorex,
  type WalletIssue,
} from "./lib/wallet";
import "./fonts";
import "./styles.css";

type Mode = "idle" | "playing" | "ended" | "replaying" | "viewed";

const KEYS: Record<string, Dir> = {
  ArrowUp: "U", ArrowDown: "D", ArrowLeft: "L", ArrowRight: "R",
  w: "U", s: "D", a: "L", d: "R", W: "U", S: "D", A: "L", D: "R",
};
const ARROW: Record<Dir, string> = { U: "↑", D: "↓", L: "←", R: "→" };
const DIR_NAME: Record<Dir, string> = { U: "Up", D: "Down", L: "Left", R: "Right" };

const CHAIN_ID = import.meta.env.VITE_QORE_CHAIN_ID ?? "qorechain-diana";
const PUBLIC_REST = import.meta.env.VITE_QORE_PUBLIC_REST ?? "https://api-testnet.qore.host";

/** Offline fallback: practice on a locally seeded circuit (never ranked). */
function localChallenge(): Challenge {
  const day = new Date().toISOString().slice(0, 10);
  return { id: `daily-${day}`, seed: seedFromString(`tracerun-practice:${day}`), rules: RULES_V1 };
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

type Server = "checking" | "online" | "offline";
type Wallet =
  | { status: "checking" }
  | { status: "absent" }
  | { status: "ready" }
  | { status: "connecting" }
  | { status: "connected"; address: string }
  | { status: "error"; issue: WalletIssue };

interface Ranked {
  address: string;
  sessionNonce: string;
}

interface Viewing {
  entry: LeaderEntry;
  check: boolean | null;
}

export function App(): JSX.Element {
  const reducedMotion = usePrefersReducedMotion();

  const [server, setServer] = useState<Server>("checking");
  const [challenge, setChallenge] = useState<Challenge>(localChallenge);
  const [wallet, setWallet] = useState<Wallet>({ status: "checking" });
  const [leaders, setLeaders] = useState<LeaderEntry[] | null>(null);

  const runRef = useRef<LiveRun | null>(null);
  const rankedRef = useRef<Ranked | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [state, setState] = useState<GameState>(() => createGame(challenge));
  const [inputs, setInputs] = useState<Input[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [reproduced, setReproduced] = useState<boolean | null>(null);
  const [replayCheck, setReplayCheck] = useState<boolean | null>(null);
  const [best, setBest] = useState<number | null>(() => loadBest(challenge.id));
  const [announce, setAnnounce] = useState("");
  const [ranked, setRanked] = useState(false);
  const [submission, setSubmission] = useState<Submission>({ phase: "idle" });
  const [notice, setNotice] = useState<{ title: string; detail: string } | null>(null);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [starting, setStarting] = useState(false);

  const address = wallet.status === "connected" ? wallet.address : null;

  // ── Boot: server challenge, wallet presence ───────────────────────────
  useEffect(() => {
    getChallenge()
      .then((c) => {
        const ch: Challenge = { id: c.id, seed: c.seed, rules: c.rules };
        setChallenge(ch);
        setState(createGame(ch));
        setBest(loadBest(ch.id));
        setServer("online");
      })
      .catch(() => setServer("offline"));
    waitForQorex().then((found) => setWallet(found ? { status: "ready" } : { status: "absent" }));
  }, []);

  const refreshLeaders = useCallback(() => {
    if (server !== "online") return;
    getLeaderboard(challenge.id)
      .then((r) => setLeaders(r.entries))
      .catch(() => setLeaders([]));
  }, [server, challenge.id]);
  useEffect(refreshLeaders, [refreshLeaders]);

  const connectWallet = useCallback(async () => {
    setWallet({ status: "connecting" });
    try {
      const addr = await connect(CHAIN_ID);
      setWallet({ status: "connected", address: addr });
      setNotice(null);
    } catch (e) {
      const issue = e instanceof WalletError ? e.issue : ({ kind: "unknown", detail: String(e) } as WalletIssue);
      setWallet(issue.kind === "not-installed" ? { status: "absent" } : { status: "error", issue });
      setNotice(describeIssue(issue));
    }
  }, []);

  // ── Runs ────────────────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    setNotice(null);
    let isRanked = false;
    rankedRef.current = null;
    if (address && server === "online") {
      try {
        const s = await createSession(address);
        rankedRef.current = { address, sessionNonce: s.sessionNonce };
        isRanked = true;
      } catch (e) {
        setNotice({ title: "Starting as practice", detail: describeApiError(e).detail });
      }
    }
    runRef.current = new LiveRun(challenge);
    setRanked(isRanked);
    setState(runRef.current.state);
    setInputs([]);
    setResult(null);
    setReproduced(null);
    setReplayCheck(null);
    setSubmission({ phase: "idle" });
    setViewing(null);
    setAnnounce(isRanked ? "Ranked run started." : "Practice run started.");
    setMode("playing");
    setStarting(false);
  }, [address, server, challenge, starting]);

  const finish = useCallback(
    (run: LiveRun) => {
      // The browser checks its own run first. This is a LOCAL check; it is never shown as VERIFIED.
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

  // ── Submit: one hybrid-signed QoreX tx proves and anchors the run ─────
  const submit = useCallback(async () => {
    const r = rankedRef.current;
    const run = runRef.current;
    if (!r || !run || !result) return;
    const memo = buildRunMemo(challenge.id, r.sessionNonce, result.replayHash);
    setSubmission({ phase: "signing" });
    setAnnounce("Approve the transaction in QoreX.");
    let txHash: string;
    try {
      const tx = await signRunTx(CHAIN_ID, r.address, memo);
      txHash = tx.txHash;
    } catch (e) {
      const issue = e instanceof WalletError ? e.issue : ({ kind: "unknown", detail: String(e) } as WalletIssue);
      setSubmission({ phase: "failed", error: describeIssue(issue) });
      setAnnounce(describeIssue(issue).title);
      return;
    }
    setSubmission({ phase: "confirming", txHash });
    setAnnounce("Transaction sent. Waiting for the block.");
    try {
      // The server retries while the tx is not committed yet, then replays the inputs and reads the tx back.
      const timer = setTimeout(() => setSubmission((s) => (s.phase === "confirming" ? { ...s, phase: "verifying" } : s)), 3000);
      const res = await submitRunTx({ sessionNonce: r.sessionNonce, address: r.address, inputs: run.inputs, txHash });
      clearTimeout(timer);
      setSubmission({ phase: "verified", txHash, run: res.run });
      setAnnounce(`Verified and anchored at block ${res.run.anchor?.height ?? ""}.`);
      refreshLeaders();
    } catch (e) {
      const d = describeApiError(e);
      setSubmission({ phase: "failed", txHash, error: d });
      setAnnounce(d.title);
    }
  }, [challenge.id, result, refreshLeaders]);

  // ── Replays: your own, or any verified run from the leaderboard ───────
  const playback = useCallback(
    (ch: Challenge, log: readonly Input[], expected: string, done: (ok: boolean) => void) => {
      let s = createGame(ch);
      let i = 0;
      setState(s);
      setMode("replaying");
      const id = window.setInterval(() => {
        if (s.status !== "running") {
          window.clearInterval(id);
          done(stateHash(s) === expected);
          return;
        }
        let turn: Dir | undefined;
        if (i < log.length && log[i].tick === s.tick) turn = log[i++].dir;
        s = step(s, ch.rules, turn);
        setState(s);
      }, ch.rules.tickMs / 2);
    },
    [],
  );

  const watchOwn = useCallback(() => {
    if (!result) return;
    setReplayCheck(null);
    setAnnounce("Replaying recorded inputs.");
    playback(challenge, runRef.current?.inputs ?? [], result.finalStateHash, (ok) => {
      setReplayCheck(ok);
      setAnnounce(ok ? "Replay reproduced the same final state." : "Replay did not match.");
      setMode("ended");
    });
  }, [challenge, result, playback]);

  const watchEntry = useCallback(
    async (entry: LeaderEntry) => {
      setViewing({ entry, check: null });
      try {
        const detail = await getRun(entry.id);
        const ch: Challenge = { id: entry.challengeId, seed: detail.seed, rules: RULES_V1 };
        setAnnounce(`Replaying rank ${entry.rank}.`);
        playback(ch, detail.inputs, entry.finalStateHash, (ok) => {
          setViewing({ entry, check: ok });
          setAnnounce(ok ? "Replay re-verified in your browser." : "Replay did not match the published result.");
          setMode("viewed");
        });
      } catch (e) {
        setViewing(null);
        setNotice(describeApiError(e));
      }
    },
    [playback],
  );

  const closeViewing = useCallback(() => {
    setViewing(null);
    setState(result && runRef.current ? runRef.current.state : createGame(challenge));
    setMode(result ? "ended" : "idle");
  }, [result, challenge]);

  // ── Input ──────────────────────────────────────────────────────────────────────
  const steer = useCallback(
    (dir: Dir) => {
      if (mode === "playing") runRef.current?.queue(dir);
    },
    [mode],
  );

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
      const onButton = (e.target as HTMLElement | null)?.closest?.("button, a");
      const busy = submission.phase === "signing" || submission.phase === "confirming" || submission.phase === "verifying";
      if ((e.key === " " || e.key === "Enter") && !onButton && !busy && (mode === "idle" || mode === "ended")) {
        e.preventDefault();
        void start();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, start, steer, submission.phase]);

  const touch = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, a")) {
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
      if (mode === "idle") void start();
      return;
    }
    steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "R" : "L") : dy > 0 ? "D" : "U");
  };

  const logRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [inputs.length]);

  // ── View ───────────────────────────────────────────────────────────────────────
  const { packetsToWin } = challenge.rules;
  const busy = submission.phase === "signing" || submission.phase === "confirming" || submission.phase === "verifying";
  const myRank = submission.run && leaders ? leaders.find((l) => l.id === submission.run!.id)?.rank : undefined;

  const status =
    mode === "replaying"
      ? { text: viewing ? `Replaying rank ${viewing.entry.rank}` : "Replaying recorded inputs", tone: "verify" }
      : state.status === "completed"
        ? { text: "Extracted", tone: "lime" }
        : state.status === "dead"
          ? { text: `Terminated · ${state.deathCause}`, tone: "muted" }
          : state.exit
            ? { text: "Gate open · extract", tone: "lime" }
            : mode === "playing"
              ? { text: ranked ? "Ranked run" : "Practice run", tone: "text" }
              : { text: "Standby", tone: "muted" };

  const willRank = address !== null && server === "online";

  const walletControl = (() => {
    switch (wallet.status) {
      case "checking":
        return <span className="wallet-state">Looking for QoreX…</span>;
      case "absent":
        return (
          <a className="btn small" href={DOWNLOAD_URL} target="_blank" rel="noreferrer">
            Get QoreX
          </a>
        );
      case "connecting":
        return <span className="wallet-state">Approve in QoreX…</span>;
      case "connected":
        return (
          <span className="wallet-chip" title={wallet.address}>
            <span className="dot" aria-hidden="true" />
            {shortAddress(wallet.address)}
          </span>
        );
      default:
        return (
          <button className="btn small" onClick={connectWallet} disabled={mode === "playing"}>
            {wallet.status === "error" ? "Retry QoreX" : "Connect QoreX"}
          </button>
        );
    }
  })();

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
          <div><dt>Network</dt><dd>{CHAIN_ID}</dd></div>
          <div>
            <dt>Verifier</dt>
            <dd className={server === "online" ? "" : server === "offline" ? "tone-warn" : "tone-muted"}>
              {server === "online" ? "Online" : server === "offline" ? "Offline" : "…"}
            </dd>
          </div>
        </dl>
        <div className="wallet">{walletControl}</div>
      </header>

      {notice && (
        <div className="notice" role="status">
          <strong>{notice.title}</strong> {notice.detail}
          <button className="notice-x" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}

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
                <p className="hint">
                  {willRank
                    ? "Ranked: you'll sign one QoreX transaction to prove the run."
                    : server === "offline"
                      ? "Verifier offline: practice only."
                      : "Practice run. Connect QoreX first to play ranked."}
                  <span className="hide-touch"> Arrows / WASD to steer.</span>
                  <span className="show-touch"> Swipe or use the pad.</span>
                </p>
                <button className="btn primary" onClick={() => void start()} disabled={starting} autoFocus>
                  {starting ? "Starting…" : willRank ? "Start ranked run" : "Start practice run"}
                  <kbd className="hide-touch">Space</kbd>
                </button>
              </div>
            )}

            {mode === "ended" && result && (
              <div className="overlay">
                <p className={`kicker ${result.status === "completed" ? "tone-lime" : "tone-muted"}`}>
                  {result.status === "completed" ? "Run complete" : `Terminated · ${result.deathCause}`}
                  {" · "}
                  {ranked ? "Ranked" : "Practice"}
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
                  {submission.phase === "verified" && (myRank ? ` · verified rank #${myRank}` : " · verified")}
                  {best !== null && result.status === "completed" && result.ticks === best && " · personal best"}
                </p>
                <div className="actions">
                  {ranked && submission.phase !== "verified" ? (
                    <>
                      <button className="btn primary" onClick={() => void submit()} disabled={busy} autoFocus>
                        {submission.phase === "signing"
                          ? "Approve in QoreX…"
                          : submission.phase === "confirming"
                            ? "Waiting for block…"
                            : submission.phase === "verifying"
                              ? "Verifying…"
                              : submission.phase === "failed"
                                ? "Submit again"
                                : "Submit proof"}
                      </button>
                      <button className="btn" onClick={() => void start()} disabled={busy}>Run again</button>
                    </>
                  ) : (
                    <button className="btn primary" onClick={() => void start()} autoFocus>
                      Run again <kbd className="hide-touch">Space</kbd>
                    </button>
                  )}
                  <button className="btn" onClick={watchOwn} disabled={busy}>Watch replay</button>
                </div>
                {submission.phase === "failed" && submission.error && (
                  <p className="overlay-error" role="alert"><strong>{submission.error.title}.</strong> {submission.error.detail}</p>
                )}
              </div>
            )}

            {mode === "viewed" && viewing && (
              <div className="overlay">
                <p className="kicker tone-verify">Replay of rank #{viewing.entry.rank} · {shortAddress(viewing.entry.address)}</p>
                <h2 className="score">
                  {viewing.entry.status === "completed" ? (
                    <>{viewing.entry.ticks}<small>ticks</small></>
                  ) : (
                    <>{viewing.entry.packets}<small>/{packetsToWin} packets</small></>
                  )}
                </h2>
                <ul className="checks">
                  <li className={viewing.check ? "ok" : "bad"}>
                    {viewing.check ? "Re-verified in your browser: inputs reproduce this result" : "Did not reproduce the published result"}
                  </li>
                  {viewing.entry.anchor && (
                    <li className="ok">
                      <a href={restTxUrl(PUBLIC_REST, viewing.entry.anchor.txHash)} target="_blank" rel="noreferrer">
                        Anchored at block {viewing.entry.anchor.height}
                      </a>
                    </li>
                  )}
                </ul>
                <div className="actions">
                  <button className="btn primary" onClick={closeViewing} autoFocus>Back</button>
                  <button className="btn" onClick={() => void watchEntry(viewing.entry)}>Watch again</button>
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
            challenge={challenge}
            inputCount={inputs.length}
            result={result}
            ranked={ranked}
            submission={submission}
            reproduced={reproduced}
            replayCheck={replayCheck}
            best={best}
            txUrl={(h) => restTxUrl(PUBLIC_REST, h)}
          />

          <Leaderboard
            entries={leaders}
            online={server === "online"}
            me={address}
            packetsToWin={packetsToWin}
            onWatch={(e) => void watchEntry(e)}
            watchingId={mode === "replaying" && viewing ? viewing.entry.id : null}
          />

          <section className="trace" aria-label="Input trace">
            <header className="panel-head">
              <h3>Input trace</h3>
              <span className="count">{pad(inputs.length, 3)}</span>
            </header>
            <p className="panel-sub">Only accepted turns are recorded. This log, not the score, is what you sign.</p>
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
        <span>Verified means the server reproduced this score from your signed inputs. It does not prove a human played.</span>
        <span>QoreChain · Build Before Q-Day</span>
      </footer>
    </div>
  );
}
