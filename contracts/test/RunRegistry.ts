import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { encodeAbiParameters, keccak256, stringToHex, toHex } from "viem";

const COMPLETED = 1;
const DEAD = 0;

const challengeId = keccak256(stringToHex("daily-2026-11-26"));
const replayHash = ("0x" + "ab".repeat(32)) as `0x${string}`;
const ruleset = toHex("snake-v1", { size: 32 });
const player = "qor1exampleplayeraddress0000000000000000";

interface RunRecord {
  replayHash: `0x${string}`;
  player: string;
  ticks: number;
  packets: number;
  moves: number;
  outcome: number;
  recordedAt: bigint;
}

const addr = (v: unknown) => String(v).toLowerCase();

describe("RunRegistry", async () => {
  // Runs on Hardhat's simulated network; no QoreChain endpoint is needed.
  const { viem } = await network.create();
  const [deployer, verifier, stranger] = await viem.getWalletClients();

  async function deploy() {
    return viem.deployContract("RunRegistry", [verifier.account.address]);
  }

  it("sets owner and verifier", async () => {
    const reg = await deploy();
    assert.equal(addr(await reg.read.owner()), addr(deployer.account.address));
    assert.equal(addr(await reg.read.verifier()), addr(verifier.account.address));
  });

  it("lets the verifier record a run, and anyone read it back", async () => {
    const reg = await deploy();
    const key = await reg.read.keyOf([challengeId, replayHash]);
    assert.equal(key, keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [challengeId, replayHash])));

    await viem.assertions.emitWithArgs(
      reg.write.record([challengeId, replayHash, ruleset, player, 412, 12, 37, COMPLETED], { account: verifier.account }),
      reg,
      "RunRecorded",
      [key, challengeId, replayHash, player, 412, COMPLETED],
    );

    const run = (await reg.read.getRun([key], { account: stranger.account })) as RunRecord;
    assert.equal(run.replayHash, replayHash);
    assert.equal(run.player, player);
    assert.equal(run.ticks, 412);
    assert.equal(run.packets, 12);
    assert.equal(run.moves, 37);
    assert.equal(run.outcome, COMPLETED);
    assert.ok(run.recordedAt > 0n);
    assert.equal(await reg.read.isRecorded([challengeId, replayHash]), true);
    assert.equal(await reg.read.runCount(), 1n);
  });

  it("rejects writes from anyone but the verifier", async () => {
    const reg = await deploy();
    await viem.assertions.revertWithCustomError(
      reg.write.record([challengeId, replayHash, ruleset, player, 1, 0, 0, DEAD], { account: stranger.account }),
      reg,
      "NotVerifier",
    );
    await viem.assertions.revertWithCustomError(
      reg.write.record([challengeId, replayHash, ruleset, player, 1, 0, 0, DEAD], { account: deployer.account }),
      reg,
      "NotVerifier",
    );
  });

  it("refuses to record the same replay twice", async () => {
    const reg = await deploy();
    await reg.write.record([challengeId, replayHash, ruleset, player, 412, 12, 37, COMPLETED], { account: verifier.account });
    await viem.assertions.revertWithCustomError(
      reg.write.record([challengeId, replayHash, ruleset, player, 300, 12, 20, COMPLETED], { account: verifier.account }),
      reg,
      "AlreadyRecorded",
    );
  });

  it("rejects empty fields and unknown lookups", async () => {
    const reg = await deploy();
    const zero = ("0x" + "00".repeat(32)) as `0x${string}`;
    await viem.assertions.revertWithCustomError(
      reg.write.record([challengeId, zero, ruleset, player, 1, 0, 0, DEAD], { account: verifier.account }),
      reg,
      "EmptyField",
    );
    await viem.assertions.revertWithCustomError(
      reg.write.record([challengeId, replayHash, ruleset, "", 1, 0, 0, DEAD], { account: verifier.account }),
      reg,
      "EmptyField",
    );
    await viem.assertions.revertWithCustomError(reg.read.getRun([zero]), reg, "UnknownRun");
  });

  it("only the owner can rotate the verifier", async () => {
    const reg = await deploy();
    await viem.assertions.revertWithCustomError(
      reg.write.setVerifier([stranger.account.address], { account: stranger.account }),
      reg,
      "NotOwner",
    );
    await reg.write.setVerifier([stranger.account.address], { account: deployer.account });
    assert.equal(addr(await reg.read.verifier()), addr(stranger.account.address));
    // The old verifier can no longer write.
    await viem.assertions.revertWithCustomError(
      reg.write.record([challengeId, replayHash, ruleset, player, 1, 0, 0, DEAD], { account: verifier.account }),
      reg,
      "NotVerifier",
    );
  });
});
