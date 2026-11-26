# TRACE//RUN

**Every move leaves proof.** Proof-of-Play Snake on QoreChain, built for the [Build Before Q-Day](https://build.qorechain.io/) fest (Quantum Pass track).

Most leaderboards ask you to trust the score. TRACE//RUN publishes the replay instead. Every ranked run is a signed input log that anyone can re-simulate to reproduce the exact score.

## How it works

1. **Daily Circuit.** Everyone gets the same seeded map, obstacles and packet sequence. Collect 12 packets, reach the extraction gate, in the fewest ticks.
2. **Record.** The game logs only accepted turns (`{tick, dir}`), never the score.
3. **Commit.** The browser hashes the replay (SHA-256, format `TRACE-RUN-REPLAY-V1`). The player signs a short commitment with QoreX `signArbitrary` (classical + ML-DSA-87).
4. **Verify.** The server checks the signature against the player's registered post-quantum key, then replays the run with the shared engine. Only the replayed result is ranked.
5. **Anchor.** A player can anchor a personal best in a hybrid-signed native QoreChain transaction (`signAndBroadcast`, replay hash in the memo). Verified runs are also recorded in a `RunRegistry` contract on the Diana testnet.

## What "verified" means

A verified run means these signed inputs reproduce this score, under this ruleset. It does **not** prove a human pressed the keys: a bot can generate a legal run. That is a separate problem, and we don't claim to solve it.

## Repository

| Path | What it is |
|---|---|
| `packages/engine` | Deterministic Snake engine, replay verifier, replay hashing, QoreX commitment builder. No UI or wallet deps. |
| `apps/web` | Vite + React frontend (scaffolded with `create-qorechain-dapp`, `fullstack-web` template). |
| `contracts` | Hardhat 3 project for the `RunRegistry` contract (scaffolded with `create-qorechain-dapp`, `hardhat` template). |

## Getting started

```bash
npm install
npm test                       # engine tests
npm run dev:web                # play at http://localhost:5173
cp apps/web/.env.example apps/web/.env        # testnet endpoints
cp contracts/.env.example contracts/.env      # never commit real keys
```

Testnet: `qorechain-diana` (EVM chain ID 9800). Free test QOR from the [faucet](https://dashboard.qorechain.io/faucet).

## Status

- [x] Deterministic engine with tests
- [x] Playable canvas frontend (Daily Circuit, input trace, watch replay with self-check)
- [ ] Server replay verification + leaderboard
- [ ] QoreX connection, hybrid-signed anchor tx
- [ ] `RunRegistry` deployed on testnet
- [ ] Race the Ghost

## Credits

- Scaffolded with [`create-qorechain-dapp`](https://www.npmjs.com/package/create-qorechain-dapp) (QoreChain Association): `fullstack-web` and `hardhat` templates.
- [`@qorechain/sdk`](https://www.npmjs.com/package/@qorechain/sdk), [`@qorechain/qoresign`](https://www.npmjs.com/package/@qorechain/qoresign) and the QoreX wallet.
- [`@noble/hashes`](https://github.com/paulmillr/noble-hashes) for SHA-256.
- mulberry32 PRNG (public domain).

## License

MIT. See [LICENSE](LICENSE).
