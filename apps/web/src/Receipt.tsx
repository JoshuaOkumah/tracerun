import type { Challenge, RunResult } from "@tracerun/engine";

type Mode = "idle" | "playing" | "ended" | "replaying";

interface Props {
  mode: Mode;
  challenge: Challenge;
  inputCount: number;
  result: RunResult | null;
  /** Local self-check: the browser's own replay matched. Never shown as VERIFIED. */
  reproduced: boolean | null;
  replayCheck: boolean | null;
  best: number | null;
}

const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;

/**
 * The run receipt. Its three states are only ever claimed when the
 * corresponding operation has actually succeeded:
 *   PLAYED   – the run finished in this browser.
 *   VERIFIED – the server replayed the inputs and checked the QoreX signature.
 *   ANCHORED – the proof receipt was recorded on QoreChain.
 * VERIFIED and ANCHORED need the server and QoreX, which are not wired yet,
 * so they are shown as not reached, with the reason.
 */
export function Receipt({ mode, challenge, inputCount, result, reproduced, replayCheck, best }: Props): JSX.Element {
  const played = result !== null && (mode === "ended" || mode === "replaying");

  return (
    <section className="receipt" aria-label="Run receipt">
      <header className="panel-head">
        <h3>Run receipt</h3>
        <span className="count">{challenge.rules.version}</span>
      </header>

      <ol className="ladder">
        <li className={played ? "reached played" : "open"}>
          <span className="mark" aria-hidden="true" />
          <span className="state">Played</span>
          <span className="why">{played ? `${inputCount} inputs recorded` : "Finish a run"}</span>
        </li>
        <li className="open">
          <span className="mark" aria-hidden="true" />
          <span className="state">Verified</span>
          <span className="why">Needs QoreX signature + server replay</span>
        </li>
        <li className="open">
          <span className="mark" aria-hidden="true" />
          <span className="state">Anchored</span>
          <span className="why">Needs a hybrid-signed QoreChain tx</span>
        </li>
      </ol>

      <dl className="fields">
        <div><dt>Replay SHA-256</dt><dd>{result ? short(result.replayHash) : "—"}</dd></div>
        <div><dt>Final state</dt><dd>{result ? short(result.finalStateHash) : "—"}</dd></div>
        <div>
          <dt>Local replay</dt>
          <dd className={reproduced === null ? "" : reproduced ? "tone-text" : "tone-warn"}>
            {reproduced === null ? "—" : reproduced ? "Matches" : "Mismatch"}
            {replayCheck !== null && (replayCheck ? " · re-checked" : " · re-check failed")}
          </dd>
        </div>
        <div><dt>Personal best</dt><dd>{best !== null ? `${best} ticks` : "—"}</dd></div>
      </dl>
    </section>
  );
}
