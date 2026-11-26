import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Input, RunResult } from "@tracerun/engine";

export interface Session {
  nonce: string;
  address: string;
  challengeId: string;
  createdAt: number;
  expiresAt: number;
  usedAt?: number;
}

export interface Anchor {
  txHash: string;
  height: string;
  anchoredAt: number;
}

export interface RunRecord {
  id: string;
  challengeId: string;
  ruleset: string;
  address: string;
  sessionNonce: string;
  inputs: Input[];
  result: RunResult;
  /** The exact commitment text the server rebuilt and verified the signature against. */
  commitment: string;
  /** The QoreX signArbitrary result, kept so anyone can re-check it. */
  signature: unknown;
  submittedAt: number;
  anchor?: Anchor;
}

export class DuplicateReplayError extends Error {
  constructor(readonly existingId: string) {
    super("replay already claimed");
  }
}

/** Storage boundary. A MongoDB implementation can replace the JSON file later. */
export interface Store {
  createSession(s: Session): Promise<void>;
  getSession(nonce: string): Promise<Session | undefined>;
  markSessionUsed(nonce: string, at: number): Promise<void>;
  /** Throws DuplicateReplayError if the same replay was already recorded for the challenge. */
  insertRun(run: RunRecord): Promise<void>;
  getRun(id: string): Promise<RunRecord | undefined>;
  listRuns(challengeId: string): Promise<RunRecord[]>;
  setAnchor(id: string, anchor: Anchor): Promise<void>;
}

interface Data {
  sessions: Record<string, Session>;
  runs: Record<string, RunRecord>;
}

export class MemoryStore implements Store {
  protected data: Data = { sessions: {}, runs: {} };

  protected async changed(): Promise<void> {}

  async createSession(s: Session) {
    this.data.sessions[s.nonce] = { ...s };
    await this.changed();
  }
  async getSession(nonce: string) {
    const s = this.data.sessions[nonce];
    return s ? { ...s } : undefined;
  }
  async markSessionUsed(nonce: string, at: number) {
    const s = this.data.sessions[nonce];
    if (s) s.usedAt = at;
    await this.changed();
  }
  async insertRun(run: RunRecord) {
    const dup = Object.values(this.data.runs).find(
      (r) => r.challengeId === run.challengeId && r.result.replayHash === run.result.replayHash,
    );
    if (dup) throw new DuplicateReplayError(dup.id);
    this.data.runs[run.id] = structuredClone(run);
    await this.changed();
  }
  async getRun(id: string) {
    const r = this.data.runs[id];
    return r ? structuredClone(r) : undefined;
  }
  async listRuns(challengeId: string) {
    return Object.values(this.data.runs)
      .filter((r) => r.challengeId === challengeId)
      .map((r) => structuredClone(r));
  }
  async setAnchor(id: string, anchor: Anchor) {
    const r = this.data.runs[id];
    if (r) r.anchor = { ...anchor };
    await this.changed();
  }
}

/** Persists to one JSON file. Writes go to a temp file and are renamed, so a crash never leaves half a file. */
export class JsonFileStore extends MemoryStore {
  private writing: Promise<void> = Promise.resolve();

  private constructor(private readonly file: string) {
    super();
  }

  static async open(file: string): Promise<JsonFileStore> {
    const store = new JsonFileStore(file);
    try {
      store.data = JSON.parse(await readFile(file, "utf8")) as Data;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    return store;
  }

  protected override async changed(): Promise<void> {
    const snapshot = JSON.stringify(this.data);
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, snapshot);
      await rename(tmp, this.file);
    });
    await this.writing;
  }
}
