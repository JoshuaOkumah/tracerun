/**
 * The memo of the player's ANCHOR transaction: a hybrid-signed native QoreChain
 * transaction (QoreX signAndBroadcast) whose memo names exactly one verified run.
 * The server reads the committed tx back and requires this exact memo, the
 * player's address as signer, and a verified ML-DSA-87 layer.
 * QoreX memos are at most 256 bytes; this one is about 100.
 */
export const ANCHOR_PREFIX = "TRACE//RUN v1";
const MAX_MEMO_BYTES = 256;

export function buildAnchorMemo(challengeId: string, replaySha256: string): string {
  if (!challengeId || /\s/.test(challengeId)) throw new Error("challengeId must be non-empty with no spaces");
  if (!/^[0-9a-f]{64}$/.test(replaySha256)) throw new Error("replaySha256 must be 64 lowercase hex chars");
  const memo = `${ANCHOR_PREFIX} ${challengeId} ${replaySha256}`;
  if (new TextEncoder().encode(memo).length > MAX_MEMO_BYTES) throw new Error("anchor memo too long");
  return memo;
}

export function parseAnchorMemo(memo: string): { challengeId: string; replaySha256: string } | null {
  const m = /^TRACE\/\/RUN v1 (\S+) ([0-9a-f]{64})$/.exec(memo);
  return m ? { challengeId: m[1], replaySha256: m[2] } : null;
}

/**
 * Memo of a RUN transaction: the player's hybrid-signed QoreX transaction that
 * both proves they submitted this run (signer + ML-DSA-87 layer) and anchors it.
 * Binds the circuit, the server-issued session nonce and the replay hash.
 * About 130 bytes, under QoreX's 256-byte memo limit.
 */
export function buildRunMemo(challengeId: string, sessionNonce: string, replaySha256: string): string {
  if (!challengeId || /\s/.test(challengeId)) throw new Error("challengeId must be non-empty with no spaces");
  if (!/^[0-9a-f]{32}$/.test(sessionNonce)) throw new Error("sessionNonce must be 32 lowercase hex chars");
  if (!/^[0-9a-f]{64}$/.test(replaySha256)) throw new Error("replaySha256 must be 64 lowercase hex chars");
  const memo = `${ANCHOR_PREFIX} ${challengeId} ${sessionNonce} ${replaySha256}`;
  if (new TextEncoder().encode(memo).length > MAX_MEMO_BYTES) throw new Error("run memo too long");
  return memo;
}
