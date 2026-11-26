import { inspectTransaction, verifyMessageWithChain, type InspectedTransaction } from "@qorechain/qoresign/network";
import type { Config } from "./config.js";

/**
 * Everything the server asks of QoreChain. Kept behind an interface so tests
 * can run the same checks offline.
 */
export interface ChainAdapter {
  /**
   * Throws unless `signature` (a QoreX signArbitrary result) is a valid hybrid
   * signature by `signer` over exactly `data`, checked against the ML-DSA-87
   * key the signer has registered on chain.
   */
  verifyCommitment(args: { signer: string; data: string; signature: unknown }): Promise<void>;
  /** Read a committed transaction back, or undefined if the network doesn't know it (yet). */
  inspectAnchor(txHash: string): Promise<InspectedTransaction | undefined>;
}

export function qoreChain(config: Pick<Config, "rest" | "chainId">): ChainAdapter {
  return {
    async verifyCommitment({ signer, data, signature }) {
      // QoreX docs: pass the signArbitrary result as-is; it follows QoreSign message-signing-v1.
      await verifyMessageWithChain({
        rest: config.rest,
        chainId: config.chainId,
        signer,
        data,
        signature: signature as Parameters<typeof verifyMessageWithChain>[0]["signature"],
        requirePq: true,
      });
    },
    inspectAnchor(txHash) {
      return inspectTransaction({ rest: config.rest, chainId: config.chainId, txhash: txHash });
    },
  };
}
