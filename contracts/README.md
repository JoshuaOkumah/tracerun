# TRACE//RUN contracts

`RunRegistry` is the public record of runs the TRACE//RUN verifier has replayed and accepted. Each record holds the challenge, the replay's SHA-256, the ruleset, the player's QoreChain address and the result. Anyone can check a record by hashing the published replay log and comparing.

Scaffolded from the `create-qorechain-dapp` **hardhat** template (Hardhat 3 + viem), which also provides `scripts/window.ts`, the EVM authorisation window helper.

| Network | EVM chain id | Hardhat network | RPC |
| --- | --- | --- | --- |
| Testnet (`qorechain-diana`) | 9800 | `qorechainTestnet` | `https://evm-testnet.qore.host` |

## Contract

- `record(challengeId, replayHash, ruleset, player, ticks, packets, moves, outcome)`: verifier only. One record per `(challengeId, replayHash)`; a duplicate reverts.
- `getRun(key)`, `isRecorded(challengeId, replayHash)`, `keyOf(challengeId, replayHash)`, `runCount()`: public reads.
- `setVerifier`, `transferOwnership`: owner only.

A record means "the verifier reproduced this score from these inputs". The contract does not replay games itself, and it does not prove a human played.

## Build and test

Node.js 22+. From the repo root:

```sh
npm install
npm run build -w contracts
npm test -w contracts      # RunRegistry tests on Hardhat's simulated network
```

## Deploy to the Diana testnet

QoreChain admits an EVM transaction only when the sender has a registered **ML-DSA-87** key and a live **EVM authorisation window**. Both are set up on the native lane, and opening the window is a **hybrid-signed** (secp256k1 + ML-DSA-87) transaction.

1. Fund the deployer from the [faucet](https://dashboard.qorechain.io/faucet).
2. Put credentials in `contracts/.env` (never commit it): either `QORE_MNEMONIC`, or `PRIVATE_KEY` plus `QORE_PQC_RECOVERY_CODE` (create one with `npm run window -w contracts -- recovery-code` and keep it safe).
3. Run:

```sh
npm run window -w contracts -- status     # account, PQC key, window
npm run window -w contracts -- register   # once: registers the ML-DSA-87 key
npm run window -w contracts -- open       # hybrid-signed tx: prints its hash
# wait ~10 seconds for the window to settle, then:
npm run deploy:testnet -w contracts
```

Record both outputs: the **window tx hash** (your hybrid-signed transaction) and the **RunRegistry address**. They go in the root README and the submission form.

Notes from the template: opening a window advances the account's nonce, so open it and then deploy. If Ignition stops with HHE10402, wait a few seconds and run the deploy again. Opening a new window replaces the old one. Sourcify does not list chain 9800 yet, so source verification is not available.
