# TRACE//RUN

**Every move leaves proof.** Proof-of-Play Snake on QoreChain, built for the [Build Before Q-Day](https://build.qorechain.io/) fest (Quantum Pass track).

Most leaderboards ask you to trust the score. TRACE//RUN publishes the replay instead. Every ranked run is a signed input log that anyone can re-simulate to reproduce the exact score.

## How it works

1. **Daily Circuit.** Everyone gets the same seeded map, obstacles and packet sequence. Collect 12 packets, reach the extraction gate, in the fewest ticks.
2. **Record.** The game logs only accepted turns (`{tick, dir}`), never the score.
3. **Commit.** The browser hashes the replay (SHA-256, format `TRACE-RUN-REPLAY-V1`). The player signs a short commitment with QoreX `signArbitrary` (classical + ML-DSA-87).
4. **Verify.** The server checks the signature against the player's registered post-quantum key, then replays the run with the shared engine. Only the replayed result is ranked.
5. **Anchor.** A player can anchor a personal best in a hybrid-signed native QoreChain transaction (`signAndBroadcast`, replay hash in the memo). Verified runs are also recorded in a `RunRegistry` contract on the Diana testnet.

## On-chain proof (Diana testnet)

| What | Value |
|---|---|
| Hybrid-signed transaction (`MsgOpenEVMWindow`, ML-DSA-87 + secp256k1) | [`9DD781F95686D29EB378DD03863507C7485534FBCDC5EB3BC18115474DE13280`](https://api-testnet.qore.host/cosmos/tx/v1beta1/txs/9DD781F95686D29EB378DD03863507C7485534FBCDC5EB3BC18115474DE13280) |
| Block / time | 10794407 · 2026-11-26 14:53:38 UTC |
| Chain's PQC check | `pqc_verify`: algorithm `dilithium5`, `hybrid_mode: required`, `status: verified` |
| Deployer | `qor1akrult2udv80u6qmtr6wr5e0w74nchl6qh5q4h` |
| `RunRegistry` contract (EVM, chain 9800) | `0x995b59611DFC742b614E11c03659c90e1F24feA9` |

## How the server decides VERIFIED and ANCHORED

**VERIFIED** (`POST /api/runs`): the session nonce is unused, unexpired and bound to this address; the server replays the input log itself (it never accepts a score); it **rebuilds** the commitment text from the raw fields and checks the QoreX signature over that text with `verifyMessageWithChain`, against the ML-DSA-87 key the player has registered on chain. Client-supplied message text is ignored.

**ANCHORED** (`POST /api/runs/:id/anchor`): the server reads the player's transaction back from the chain with `inspectTransaction` and requires `code 0`, the exact memo `TRACE//RUN v1 <challengeId> <replayHash>`, the run's player as signer, and a verified ML-DSA-87 layer.

**Replay theft** (copying a top player's inputs and signing them with your own key) is refused: the first verified submission of a replay owns it.

| Measured | Result |
|---|---|
| Random single-edit tamperings of real input logs (fuzz test) | 2,000 / 2,000 detected |
| Server tests with real QoreSign hybrid signatures | 12 passing, including forged keys, edited logs, wrong chain id, reused/expired sessions, replay theft, and 4 bad anchor txs |
| Mutation check | disabling the signature check fails 3 tests; skipping the anchor signer check fails 1 |
| Replay cost | ~0.15 ms per run |

## What "verified" means

A verified run means these signed inputs reproduce this score, under this ruleset. It does **not** prove a human pressed the keys: a bot can generate a legal run. That is a separate problem, and we don't claim to solve it.

## Repository

| Path | What it is |
|---|---|
| `packages/engine` | Deterministic Snake engine, replay verifier, replay hashing, QoreX commitment builder. No UI or wallet deps. |
| `apps/server` | Verification server (Express): daily challenge, single-use sessions, signed-run verification by replay, anchor checks, leaderboard. |
| `apps/web` | Vite + React frontend (scaffolded with `create-qorechain-dapp`, `fullstack-web` template). |
| `contracts` | `RunRegistry` contract, tests and Ignition deploy module (scaffolded with `create-qorechain-dapp`, `hardhat` template). See [contracts/README.md](contracts/README.md) for deploying to Diana. |

## Getting started

```bash
npm install
npm test                       # engine + server tests
npm run test:contracts         # RunRegistry tests
npm run dev:server             # verifier at http://localhost:8787
npm run dev:web                # play at http://localhost:5173
cp apps/web/.env.example apps/web/.env        # testnet endpoints
cp apps/server/.env.example apps/server/.env  # set DAILY_SECRET
cp contracts/.env.example contracts/.env      # never commit real keys
```

Testnet: `qorechain-diana` (EVM chain ID 9800). Free test QOR from the [faucet](https://dashboard.qorechain.io/faucet).

## Status

- [x] Deterministic engine with tests
- [x] Playable canvas frontend (Daily Circuit, input trace, watch replay with self-check)
- [x] Server replay verification, anchor checks + leaderboard API
- [ ] QoreX connection, hybrid-signed anchor tx
- [x] `RunRegistry` contract + tests
- [x] `RunRegistry` deployed on testnet, after a hybrid-signed window tx
- [ ] Race the Ghost

## Design

"Forensic Arcade": IBM Plex Mono for data, Barlow Condensed for scores, self-hosted. Lime marks the player and the goal, teal marks verification, orange is reserved for real failures (losing a run is shown neutrally). The run receipt only claims PLAYED, VERIFIED or ANCHORED once that step has actually succeeded. Checked with axe-core (WCAG 2 A/AA): no violations on desktop or mobile. Respects `prefers-reduced-motion`.

## Credits

- Scaffolded with [`create-qorechain-dapp`](https://www.npmjs.com/package/create-qorechain-dapp) (QoreChain Association): `fullstack-web` and `hardhat` templates.
- [`@qorechain/sdk`](https://www.npmjs.com/package/@qorechain/sdk), [`@qorechain/qoresign`](https://www.npmjs.com/package/@qorechain/qoresign) and the QoreX wallet.
- [`@noble/hashes`](https://github.com/paulmillr/noble-hashes) for SHA-256.
- mulberry32 PRNG (public domain).
- [Barlow Condensed](https://fonts.google.com/specimen/Barlow+Condensed) and [IBM Plex Mono](https://github.com/IBM/plex) (SIL Open Font License), via Fontsource.
- Built with AI assistance (Claude) for code and review. Design decisions, testing and the submission are the author's.

## License

MIT. See [LICENSE](LICENSE).
