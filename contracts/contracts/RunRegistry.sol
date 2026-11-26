// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title RunRegistry
/// @notice Public record of TRACE//RUN runs that the verification server has
///         replayed and accepted. Anyone can read a record and check it against
///         the published replay log: hash the log, compare it with `replayHash`.
/// @dev    Only the verifier (the server's key) can write, so a record here means
///         "the verifier reproduced this score from these inputs". The contract
///         does not replay games itself, and it does not prove a human played.
contract RunRegistry {
    enum Outcome {
        Dead,
        Completed
    }

    struct Run {
        bytes32 challengeId; // e.g. keccak256("daily-2026-11-26")
        bytes32 replayHash; // SHA-256 of the canonical TRACE-RUN-REPLAY-V1 encoding
        bytes32 ruleset; // e.g. "snake-v1" as bytes32
        string player; // QoreChain address of the signer (qor1...)
        uint32 ticks;
        uint16 packets;
        uint16 moves;
        Outcome outcome;
        uint64 recordedAt; // block timestamp
    }

    address public owner;
    address public verifier;
    uint256 public runCount;

    /// @dev key = keccak256(abi.encode(challengeId, replayHash)). One record per replay.
    mapping(bytes32 => Run) private runs;

    event RunRecorded(
        bytes32 indexed key,
        bytes32 indexed challengeId,
        bytes32 replayHash,
        string player,
        uint32 ticks,
        Outcome outcome
    );
    event VerifierChanged(address indexed previous, address indexed current);
    event OwnershipTransferred(address indexed previous, address indexed current);

    error NotOwner();
    error NotVerifier();
    error ZeroAddress();
    error EmptyField();
    error AlreadyRecorded(bytes32 key);
    error UnknownRun(bytes32 key);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyVerifier() {
        if (msg.sender != verifier) revert NotVerifier();
        _;
    }

    constructor(address initialVerifier) {
        if (initialVerifier == address(0)) revert ZeroAddress();
        owner = msg.sender;
        verifier = initialVerifier;
        emit OwnershipTransferred(address(0), msg.sender);
        emit VerifierChanged(address(0), initialVerifier);
    }

    /// @notice The storage key for a run.
    function keyOf(bytes32 challengeId, bytes32 replayHash) public pure returns (bytes32) {
        return keccak256(abi.encode(challengeId, replayHash));
    }

    /// @notice Record a run the verifier has replayed and accepted.
    function record(
        bytes32 challengeId,
        bytes32 replayHash,
        bytes32 ruleset,
        string calldata player,
        uint32 ticks,
        uint16 packets,
        uint16 moves,
        Outcome outcome
    ) external onlyVerifier returns (bytes32 key) {
        if (challengeId == bytes32(0) || replayHash == bytes32(0) || ruleset == bytes32(0) || bytes(player).length == 0) {
            revert EmptyField();
        }
        key = keyOf(challengeId, replayHash);
        if (runs[key].recordedAt != 0) revert AlreadyRecorded(key);

        runs[key] = Run({
            challengeId: challengeId,
            replayHash: replayHash,
            ruleset: ruleset,
            player: player,
            ticks: ticks,
            packets: packets,
            moves: moves,
            outcome: outcome,
            recordedAt: uint64(block.timestamp)
        });
        unchecked {
            runCount += 1;
        }
        emit RunRecorded(key, challengeId, replayHash, player, ticks, outcome);
    }

    /// @notice Read a recorded run. Reverts if there is none.
    function getRun(bytes32 key) external view returns (Run memory) {
        Run memory r = runs[key];
        if (r.recordedAt == 0) revert UnknownRun(key);
        return r;
    }

    /// @notice Whether a replay has been recorded for a challenge.
    function isRecorded(bytes32 challengeId, bytes32 replayHash) external view returns (bool) {
        return runs[keyOf(challengeId, replayHash)].recordedAt != 0;
    }

    function setVerifier(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit VerifierChanged(verifier, next);
        verifier = next;
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, next);
        owner = next;
    }
}
