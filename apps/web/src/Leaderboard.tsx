import type { LeaderEntry } from "./lib/api";
import { shortAddress } from "./lib/wallet";

interface Props {
  entries: LeaderEntry[] | null;
  online: boolean;
  me: string | null;
  packetsToWin: number;
  onWatch: (entry: LeaderEntry) => void;
  watchingId: string | null;
}

/** Top verified runs for today's circuit. Every row can be replayed and re-checked in the browser. */
export function Leaderboard({ entries, online, me, packetsToWin, onWatch, watchingId }: Props): JSX.Element {
  return (
    <section className="board-list" aria-label="Verified leaderboard">
      <header className="panel-head">
        <h3>Verified runs</h3>
        <span className="count">{entries ? `${entries.length} today` : online ? "loading" : "offline"}</span>
      </header>
      {!online && <p className="panel-sub">Server offline. Practice runs still work; ranked runs need the server.</p>}
      {online && entries && entries.length === 0 && <p className="panel-sub">No verified runs yet today. Be first.</p>}
      {entries && entries.length > 0 && (
        <ol className="ranks">
          {entries.slice(0, 10).map((e) => (
            <li key={e.id} className={e.address === me ? "me" : ""}>
              <span className="rank">{String(e.rank).padStart(2, "0")}</span>
              <span className="who">
                {shortAddress(e.address)}
                {e.address === me && <em> · you</em>}
              </span>
              <span className="score">
                {e.status === "completed" ? `${e.ticks}t` : `${e.packets}/${packetsToWin}`}
              </span>
              <span className={`seal ${e.anchor ? "anchored" : "verified"}`} title={e.anchor ? "Verified and anchored on QoreChain" : "Verified"}>
                {e.anchor ? "Anchored" : "Verified"}
              </span>
              <button className="watch" onClick={() => onWatch(e)} disabled={watchingId !== null} aria-label={`Watch replay of rank ${e.rank}`}>
                {watchingId === e.id ? "…" : "Watch"}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
