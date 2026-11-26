# TRACE//RUN

**Every move leaves proof.** Proof-of-Play Snake on QoreChain, built for the [Build Before Q-Day](https://build.qorechain.io/) fest (Quantum Pass track).

Most leaderboards ask you to trust the score. TRACE//RUN publishes the replay instead. Every ranked run is a signed input log that anyone can re-simulate to reproduce the exact score.

## How it works

1. **Daily Circuit.** Everyone gets the same seeded map, obstacles and packet sequence. Collect 12 packets, reach the extraction gate, in the fewest ticks.
2. **Record.** The game logs only accepted turns (`{tick, dir}`), never the score.
3. **Prove.** The browser hashes the replay (SHA-256, format `TRACE-RUN-REPLAY-V1`). The player approves one QoreX transaction (`signAndBroadcast`): a 1 uqor self-transfer whose memo is `TRACE//RUN v1 <circuit> <session nonce> <replay hash>`. QoreX adds the hybrid secp256k1 + ML-DSA-87 signature.
4. **Verify + anchor.** The server replays the inputs with the shared engine, rebuilds the memo, and reads the transaction back from the chain. Only then is the run VERIFIED and ANCHORED, and ranked.
5. **Re-check.** Every leaderboard entry can be replayed in any browser, which re-verifies it against the published result.

Why a transaction and not `signArbitrary`? The QoreX docs describe `signArbitrary`, but the official `@qorechain/qorex-types` 0.1.0 says current builds refuse it ("not yet supported"). `signAndBroadcast` is supported by both, so the game relies on it. The server also accepts `signArbitrary` signatures (verified with `verifyMessageWithChain`) for wallets that support it.

## On-chain proof (Diana testnet)

| What | Value |
|---|---|
| Hybrid-signed transaction (`MsgOpenEVMWindow`, ML-DSA-87 + secp256k1) | [`9DD781F95686D29EB378DD03863507C7485534FBCDC5EB3BC18115474DE13280`](https://api-testnet.qore.host/cosmos/tx/v1beta1/txs/9DD781F95686D29EB378DD03863507C7485534FBCDC5EB3BC18115474DE13280) |
| Block / time | 10794407 · 2026-11-26 14:53:38 UTC |
| Chain's PQC check | `pqc_verify`: algorithm `dilithium5`, `hybrid_mode: required`, `status: verified` |
| Deployer | `qor1akrult2udv80u6qmtr6wr5e0w74nchl6qh5q4h` |
| `RunRegistry` contract (EVM, chain 9800) | `0x995b59611DFC742b614E11c03659c90e1F24feA9` |

## How the server decides VERIFIED and ANCHORED

**VERIFIED + ANCHORED** (`POST /api/runs` with `txHash`): the session nonce is unused, unexpired and bound to this address; the server replays the input log itself (it never accepts a score); it **rebuilds** the run memo from the raw fields and reads the transaction back with `inspectTransaction`, requiring `code 0`, that exact memo, the player as signer, and a verified ML-DSA-87 layer. Client-supplied text is ignored. While the tx is not committed yet the server answers `tx-not-found` and the session stays usable, so the game retries.

**VERIFIED only** (`POST /api/runs` with `signature`): the same replay, plus a QoreX `signArbitrary` signature over a server-rebuilt commitment, checked with `verifyMessageWithChain` against the player's registered ML-DSA-87 key. Such a run can be anchored later (`POST /api/runs/:id/anchor`).

**Replay theft** (copying a top player's inputs and signing them with your own key) is refused: the first verified submission of a replay owns it.

| Measured | Result |
|---|---|
| Random single-edit tamperings of real input logs (fuzz test) | 2,000 / 2,000 detected |
| Server tests (real QoreSign hybrid signatures for the message path) | 17 passing: forged keys, edited logs, wrong chain id, reused/expired sessions, replay theft, bad anchor txs, and tx-proven runs (wrong session in memo, wrong signer, no ML-DSA-87 layer, failed tx, not yet committed) |
| Full game flow in a browser (mock QoreX wallet, real server) | connect → ranked run → sign → confirm → VERIFIED + ANCHORED → leaderboard → replay re-verified; declined signature and wrong network handled |
| Mutation check | disabling the signature check fails 3 tests; skipping the anchor signer check fails 1 |
| Replay cost | ~0.15 ms per run |

## What "verified" means

A verified run means these signed inputs reproduce this score, under this ruleset. It does **not** prove a human pressed the keys: a bot can generate a legal run. That is a separate problem, and we don't claim to solve it.

## Repository

| Path | What it is |
|---|---|
| `packages/engine` | Deterministic Snake engine, replay verifier, replay hashing, QoreX commitment builder. No UI or wallet deps. |
| `apps/server` | Verification server (Express): daily challenge, single-use sessions, signed-run verification by replay, anchor checks, leaderboard. |
| `apps/web` | Vite + React game (scaffolded with `create-qorechain-dapp`, `fullstack-web` template): QoreX connect, ranked/practice runs, run receipt, verified leaderboard with replays. |
| `contracts` | `RunRegistry` contract, tests and Ignition deploy module (scaffolded with `create-qorechain-dapp`, `hardhat` template). See [contracts/README.md](contracts/README.md) for deploying to Diana. |

## Getting started

```bash
npm install
cp apps/web/.env.example apps/web/.env        # API URL + testnet endpoints
cp apps/server/.env.example apps/server/.env  # set DAILY_SECRET
cp contracts/.env.example contracts/.env      # never commit real keys
npm test                       # engine + server tests
npm run test:contracts         # RunRegistry tests
npm run dev:server             # verifier at http://localhost:8787 (terminal 1)
npm run dev:web                # play at http://localhost:5173 (terminal 2)
```

Testnet: `qorechain-diana` (EVM chain ID 9800). Free test QOR from the [faucet](https://dashboard.qorechain.io/faucet).

## Status

- [x] Deterministic engine with tests
- [x] Playable canvas frontend (Daily Circuit, input trace, watch replay with self-check)
- [x] Server replay verification, anchor checks + leaderboard API
- [x] QoreX connection, ranked runs proven by a hybrid-signed tx, leaderboard with replays (tested with a mock wallet; live QoreX test pending)
- [x] `RunRegistry` contract + tests
- [x] `RunRegistry` deployed on testnet, after a hybrid-signed window tx
- [ ] Race the Ghost

## Design

"Forensic Arcade": IBM Plex Mono for data, Barlow Condensed for scores, self-hosted. Lime marks the player and the goal, teal marks verification, orange is reserved for real failures (losing a run is shown neutrally). The run receipt only claims PLAYED, VERIFIED or ANCHORED once that step has actually succeeded. Checked with axe-core (WCAG 2 A/AA): no violations on desktop or mobile. Respects `prefers-reduced-motion`.

## Credits

- Scaffolded with [`create-qorechain-dapp`](https://www.npmjs.com/package/create-qorechain-dapp) (QoreChain Association): `fullstack-web` and `hardhat` templates.
- [`@qorechain/sdk`](https://www.npmjs.com/package/@qorechain/sdk), [`@qorechain/qoresign`](https://www.npmjs.com/package/@qorechain/qoresign), [`@qorechain/qorex-types`](https://www.npmjs.com/package/@qorechain/qorex-types) and the QoreX wallet.
- [`cosmjs-types`](https://github.com/confio/cosmjs-types) for the `MsgSend` encoding.
- [`@noble/hashes`](https://github.com/paulmillr/noble-hashes) for SHA-256.
- mulberry32 PRNG (public domain).
- [Barlow Condensed](https://fonts.google.com/specimen/Barlow+Condensed) and [IBM Plex Mono](https://github.com/IBM/plex) (SIL Open Font License), via Fontsource.
- Built with AI assistance (Claude) for code and review. Design decisions, testing and the submission are the author's.

## License

MIT. See [LICENSE](LICENSE).
