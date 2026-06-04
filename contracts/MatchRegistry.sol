// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Stores FLWC match fixtures, committed block seeds, and on-chain results.
/// @dev Settlement is trustless: anyone commits the block hash at kickoff within 256 blocks,
///      then anyone can finalize using the stored seed. No oracle needed.
contract MatchRegistry is Ownable {
    uint16 public constant MATCH_DURATION = 1200; // 20 minutes in seconds

    enum Status { Scheduled, SeedCommitted, Final }

    struct MatchRecord {
        bytes32 homeTeamId;
        bytes32 awayTeamId;
        uint64  kickoff;        // unix timestamp
        uint32  homeStrength;
        uint32  awayStrength;
        bytes32 seed;           // blockhash committed at kickoff
        uint32  seedBlockNumber;
        uint8   homeScore;
        uint8   awayScore;
        Status  status;
    }

    mapping(bytes32 => MatchRecord) public matches;
    bytes32[] public matchIds;

    event MatchScheduled(bytes32 indexed matchId, bytes32 homeTeamId, bytes32 awayTeamId, uint64 kickoff);
    event SeedCommitted(bytes32 indexed matchId, bytes32 seed, uint32 blockNumber);
    event MatchFinalized(bytes32 indexed matchId, uint8 homeScore, uint8 awayScore);

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ── Owner actions ────────────────────────────────────────────────

    function scheduleMatch(
        bytes32 matchId,
        bytes32 homeTeamId,
        bytes32 awayTeamId,
        uint64  kickoff,
        uint32  homeStrength,
        uint32  awayStrength
    ) external onlyOwner {
        require(matches[matchId].kickoff == 0, "EXISTS");
        require(homeTeamId != awayTeamId, "SAME_TEAM");
        require(kickoff > block.timestamp, "PAST");

        matches[matchId] = MatchRecord({
            homeTeamId:      homeTeamId,
            awayTeamId:      awayTeamId,
            kickoff:         kickoff,
            homeStrength:    homeStrength,
            awayStrength:    awayStrength,
            seed:            bytes32(0),
            seedBlockNumber: 0,
            homeScore:       0,
            awayScore:       0,
            status:          Status.Scheduled
        });
        matchIds.push(matchId);
        emit MatchScheduled(matchId, homeTeamId, awayTeamId, kickoff);
    }

    // ── Trustless seed commitment (anyone can call, within 256 blocks of kickoff) ──

    /// @notice Commits the block hash of `blockNumber` as the randomness seed for `matchId`.
    ///         Must be called within ~256 blocks (~8.5 min on Base) after kickoff.
    function commitSeed(bytes32 matchId, uint32 blockNumber) external {
        MatchRecord storage m = matches[matchId];
        require(m.kickoff != 0, "UNKNOWN");
        require(m.status == Status.Scheduled, "ALREADY_COMMITTED");
        require(block.timestamp >= m.kickoff, "NOT_STARTED");
        require(block.number > blockNumber, "BLOCK_NOT_MINED");
        require(block.number - blockNumber <= 255, "BLOCK_TOO_OLD");

        bytes32 seed = blockhash(blockNumber);
        require(seed != bytes32(0), "INVALID_BLOCK");

        m.seed = seed;
        m.seedBlockNumber = blockNumber;
        m.status = Status.SeedCommitted;
        emit SeedCommitted(matchId, seed, blockNumber);
    }

    /// @notice Finalizes the match using the committed seed. Anyone can call after match ends.
    function finalizeMatch(bytes32 matchId) external {
        MatchRecord storage m = matches[matchId];
        require(m.status == Status.SeedCommitted, "SEED_NOT_COMMITTED");
        require(block.timestamp >= m.kickoff + MATCH_DURATION, "NOT_FINISHED");

        (uint8 home, uint8 away) = computeResult(m.seed, m.homeStrength, m.awayStrength);
        m.homeScore = home;
        m.awayScore = away;
        m.status = Status.Final;
        emit MatchFinalized(matchId, home, away);
    }

    // ── Pure result computation — mirrors frontend computeMatchGoals exactly ──

    /// @notice Deterministically computes the match score from a seed and team strengths.
    ///         Uses keccak256 chaining — identical algorithm to the frontend JS.
    function computeResult(bytes32 seed, uint256 homeStr, uint256 awayStr)
        public pure returns (uint8 homeGoals, uint8 awayGoals)
    {
        uint256 total = homeStr + awayStr;
        for (uint256 min = 1; min <= 90; min++) {
            // ~2.8% goal chance per minute ≈ 2.52 goals/match average
            uint256 goalRoll = uint256(keccak256(abi.encodePacked(seed, min, uint8(1)))) % 10000;
            if (goalRoll < 280) {
                uint256 teamRoll = uint256(keccak256(abi.encodePacked(seed, min, uint8(2)))) % total;
                if (teamRoll < homeStr) homeGoals++;
                else awayGoals++;
            }
        }
    }

    function matchCount() external view returns (uint256) { return matchIds.length; }

    function getMatch(bytes32 matchId) external view returns (MatchRecord memory) {
        return matches[matchId];
    }
}
