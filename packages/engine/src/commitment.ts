/**
 * The small text message the player signs with QoreX `signArbitrary`.
 * The full input log stays on the server; only its hash is signed.
 * QoreX accepts 1–4096 bytes, so we check the size here.
 */
export interface CommitmentFields {
  chainId: string; // e.g. "qorechain-diana"
  challengeId: string;
  sessionNonce: string;
  address: string;
  ruleset: string;
  replaySha256: string;
}

export const COMMITMENT_HEADER = "TRACE//RUN/v1";
const MAX_BYTES = 4096;

export function buildCommitment(f: CommitmentFields): string {
  for (const [k, v] of Object.entries(f)) {
    if (typeof v !== "string" || v.length === 0 || /[\r\n]/.test(v)) {
      throw new Error(`commitment field ${k} must be a non-empty single-line string`);
    }
  }
  if (!/^[0-9a-f]{64}$/.test(f.replaySha256)) throw new Error("replaySha256 must be 64 hex chars");
  const msg = [
    COMMITMENT_HEADER,
    `chain_id: ${f.chainId}`,
    `challenge_id: ${f.challengeId}`,
    `session_nonce: ${f.sessionNonce}`,
    `address: ${f.address}`,
    `ruleset: ${f.ruleset}`,
    `replay_sha256: ${f.replaySha256}`,
  ].join("\n");
  if (new TextEncoder().encode(msg).length > MAX_BYTES) throw new Error("commitment too large");
  return msg;
}
