import type { Challenge, RunResult } from "@tracerun/engine";
import type { RunSummary } from "./lib/api";

export type Phase = "idle" | "signing" | "confirming" | "verifying" | "verified" | "failed";

export interface Submission {
  phase: Phase;
  txHash?: string;
  run?: RunSummary;
  error?: { title: string; detail: string };
}

interface Props {
  challenge: Challenge;
  inputCount: number;
  result: RunResult | null;
  ranked: boolean;
  submission: Submission;
  /** Local self-check: the browser's own replay matched. Never shown as VERIFIED. */
  reproduced: boolean | null;
  replayCheck: boolean | null;
  best: number | null;
  txUrl: (hash: string) => string;
}

const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;

/**
 * The run receipt. Each state is claimed only after that step has succeeded:
 *   PLAYED   – the run finished in this browser.
 *   VERIFIED – the server replayed the inputs and checked the player's signed transaction.
 *   ANCHORED – that transaction, carrying the run memo and an ML-DSA-87 layer, is committed on QoreChain.
 */
export function Receipt({ challenge, inputCount, result, ranked, submission, reproduced, replayCheck, best, txUrl }: Props): JSX.Element {
  const played = result !== null;
  const { phase, run, txHash, error } = submission;
  const verified = phase === "verified" && run?.verified === true;
  const anchored = verified && run?.anchor != null;
  const busy = phase === "signing" || phase === "confirming" || phase === "verifying";

  const verifyWhy = (() => {
    if (verified) {
      return run!.status === "completed"
        ? `Server replay matched · ${run!.ticks} ticks`
        : `Server replay matched · ${run!.packets}/${challenge.rules.packetsToWin} packets`;
    }
    if (!played) return "Finish a run";
    if (!ranked) return "Practice run: connect QoreX before starting to rank";
    if (phase === "signing") return "Approve the transaction in QoreX";
    if (phase === "confirming") return "Waiting for the block";
    if (phase === "verifying") return "Server replaying your inputs";
    if (phase === "failed") return error?.title ?? "Failed";
    return "Submit proof to verify";
  })();

  const anchorWhy = (() => {
    if (anchored) return null;
    if (txHash) return `Tx sent · ${short(txHash)}`;
    if (!ranked && played) return "Not ranked";
    return "Needs your hybrid-signed QoreChain tx";
  })();

  return (
    <section className="receipt" aria-label="Run receipt" aria-busy={busy}>
      <header className="panel-head">
        <h3>Run receipt</h3>
        <span className="count">{ranked ? "Ranked" : "Practice"} · {challenge.rules.version}</span>
      </header>

      <ol className="ladder">
        <li className={played ? "reached played" : "open"}>
          <span className="mark" aria-hidden="true" />
          <span className="state">Played</span>
          <span className="why">{played ? `${inputCount} inputs recorded` : "Finish a run"}</span>
        </li>
        <li className={verified ? "reached verified" : busy ? "open working" : phase === "failed" ? "open failed" : "open"}>
          <span className="mark" aria-hidden="true" />
          <span className="state">Verified</span>
          <span className="why">{verifyWhy}</span>
        </li>
        <li className={anchored ? "reached anchored" : "open"}>
          <span className="mark" aria-hidden="true" />
          <span className="state">Anchored</span>
          <span className="why">
            {anchored ? (
              <a href={txUrl(run!.anchor!.txHash)} target="_blank" rel="noreferrer">
                Block {run!.anchor!.height} · {short(run!.anchor!.txHash)}
              </a>
            ) : (
              anchorWhy
            )}
          </span>
        </li>
      </ol>

      {phase === "failed" && error && <p className="receipt-error" role="alert">{error.detail}</p>}

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
