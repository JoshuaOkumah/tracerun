import {
  QORECHAIN_TESTNET_EVM_CHAIN_ID,
  QOREX_DOWNLOAD_URLS,
  getQorexNative,
  hasCapability,
  isQorexIntegrationError,
  qorexSignAndBroadcast,
  type QorexSignAndBroadcastResult,
} from "@qorechain/qorex-types";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";

/**
 * QoreX integration. Every call here is from the official QoreX types
 * (`@qorechain/qorex-types`): getKey, signAndBroadcast, capabilities, and the
 * EVM provider's eth_chainId to read the network selected in the wallet.
 */

export const DOWNLOAD_URL = QOREX_DOWNLOAD_URLS.chrome;

export type WalletIssue =
  | { kind: "not-installed" }
  | { kind: "outdated" }
  | { kind: "wrong-network"; expected: string }
  | { kind: "declined" }
  | { kind: "not-authorised"; detail: string }
  | { kind: "tx-failed"; code: number }
  | { kind: "downgraded" }
  | { kind: "unknown"; detail: string };

export class WalletError extends Error {
  constructor(readonly issue: WalletIssue) {
    super(issue.kind);
  }
}

/** QoreX injects after page load in some browsers; wait briefly for it. */
export async function waitForQorex(timeoutMs = 1500): Promise<boolean> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (getQorexNative()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return Boolean(getQorexNative());
}

/** The EVM chain id selected in QoreX (answers even while locked). Null if it can't be read. */
async function selectedEvmChainId(): Promise<number | null> {
  try {
    const hex = (await window.qorex?.evm.request({ method: "eth_chainId" })) as string | undefined;
    return hex ? parseInt(hex, 16) : null;
  } catch {
    return null;
  }
}

const EVM_ID: Record<string, number> = { "qorechain-diana": QORECHAIN_TESTNET_EVM_CHAIN_ID, "qorechain-vladi": 9801 };

export function classify(e: unknown, chainId: string): WalletIssue {
  if (e instanceof WalletError) return e.issue;
  if (isQorexIntegrationError(e, "QOREX_NOT_INSTALLED")) return { kind: "not-installed" };
  if (isQorexIntegrationError(e, "QOREX_NOT_SUPPORTED_YET")) return { kind: "outdated" };
  const err = e as { code?: number; message?: string };
  const msg = String(err?.message ?? e);
  if (err?.code === 4001 || /rejected|denied|closed/i.test(msg)) return { kind: "declined" };
  if (/does not match the active network|unsupported chain/i.test(msg)) return { kind: "wrong-network", expected: chainId };
  if (err?.code === 4100) return { kind: "not-authorised", detail: msg };
  return { kind: "unknown", detail: msg };
}

/** Connect the site and return the active qor1… address. */
export async function connect(chainId: string): Promise<string> {
  const native = getQorexNative();
  if (!native) throw new WalletError({ kind: "not-installed" });
  if (!hasCapability(native, "signAndBroadcast") && typeof native.signAndBroadcast !== "function") {
    throw new WalletError({ kind: "outdated" });
  }
  const evm = await selectedEvmChainId();
  if (evm !== null && EVM_ID[chainId] && evm !== EVM_ID[chainId]) {
    throw new WalletError({ kind: "wrong-network", expected: chainId });
  }
  try {
    const key = await native.getKey(chainId);
    return key.bech32Address;
  } catch (e) {
    throw new WalletError(classify(e, chainId));
  }
}

/**
 * The run transaction: send 1 uqor to yourself with the run memo. QoreX shows
 * it, sets the fee, adds the hybrid secp256k1 + ML-DSA-87 signature and
 * broadcasts. The memo is the whole point: it names the circuit, the session
 * and the replay hash, and the server reads it back from the chain.
 */
export async function signRunTx(chainId: string, address: string, memo: string): Promise<QorexSignAndBroadcastResult> {
  const value = MsgSend.encode(
    MsgSend.fromPartial({ fromAddress: address, toAddress: address, amount: [{ denom: "uqor", amount: "1" }] }),
  ).finish();
  let result: QorexSignAndBroadcastResult;
  try {
    result = await qorexSignAndBroadcast({
      chainId,
      messages: [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: Array.from(value) }],
      memo,
    });
  } catch (e) {
    throw new WalletError(classify(e, chainId));
  }
  if (result.code !== 0) throw new WalletError({ kind: "tx-failed", code: result.code });
  if (result.shield === "downgraded") throw new WalletError({ kind: "downgraded" });
  return result;
}

export function describeIssue(issue: WalletIssue): { title: string; detail: string } {
  switch (issue.kind) {
    case "not-installed":
      return { title: "QoreX not found", detail: "Install the QoreX extension to sign ranked runs. Practice runs still work." };
    case "outdated":
      return { title: "QoreX needs an update", detail: "This QoreX build can't send transactions (signAndBroadcast). Update the extension." };
    case "wrong-network":
      return { title: "Wrong network", detail: `Switch QoreX to the Diana testnet (${issue.expected}), then try again. Sites can't switch it for you.` };
    case "declined":
      return { title: "Signature declined", detail: "Nothing was sent. Your run is still here: submit again when ready." };
    case "not-authorised":
      return { title: "QoreX refused", detail: issue.detail };
    case "tx-failed":
      return { title: "Transaction failed", detail: `The network rejected it (code ${issue.code}). Check you have test QOR for the fee.` };
    case "downgraded":
      return { title: "No post-quantum layer", detail: "The transaction was committed without its ML-DSA-87 signature. It can't prove this run." };
    case "unknown":
      return { title: "Wallet error", detail: issue.detail };
  }
}

export const shortAddress = (a: string) => `${a.slice(0, 8)}…${a.slice(-4)}`;
