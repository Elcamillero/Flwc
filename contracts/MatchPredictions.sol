// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Trustless parimutuel match betting.
/// - Anyone commits the Base block hash at kickoff (within 256 blocks ~8.5 min).
/// - Anyone finalizes after 20 minutes using the committed seed.
/// - FLWC token holders (≥1000 FLWC) pay 1% fee instead of 2%.
contract MatchPredictions is ReentrancyGuard {

    // ── Constants ────────────────────────────────────────────────
    uint256 public constant MATCH_DURATION   = 1200;        // 20 minutes
    uint256 public constant FEE_BPS_STANDARD = 200;         // 2%
    uint256 public constant FEE_BPS_HOLDER   = 100;         // 1% for FLWC holders
    uint256 public constant FLWC_THRESHOLD   = 1000 * 1e18; // 1000 FLWC
    uint256 public constant MIN_BET          = 0.0001 ether;

    enum Outcome { Home, Draw, Away }

    struct Pool {
        // Betting
        uint256  homePool;
        uint256  drawPool;
        uint256  awayPool;
        // Seed commitment
        bytes32  seed;
        uint64   kickoff;       // unix timestamp of match start
        uint32   seedBlock;
        uint32   homeStrength;
        uint32   awayStrength;
        // Settlement
        Outcome  winner;
        bool     seedCommitted;
        bool     settled;
    }

    // ── Storage ──────────────────────────────────────────────────
    address public immutable owner;
    address payable public vault;
    IERC20  public immutable flwcToken;

    mapping(bytes32 => Pool)                                       public pools;
    mapping(bytes32 => mapping(uint8 => mapping(address => uint256))) public stakes;

    // ── Events ───────────────────────────────────────────────────
    event MatchOpened(bytes32 indexed matchId, uint64 kickoff, uint32 homeStr, uint32 awayStr);
    event SeedCommitted(bytes32 indexed matchId, bytes32 seed, uint32 blockNumber);
    event BetPlaced(bytes32 indexed matchId, address indexed user, Outcome outcome, uint256 amount);
    event MatchSettled(bytes32 indexed matchId, Outcome winner, uint8 homeGoals, uint8 awayGoals);
    event Claimed(bytes32 indexed matchId, address indexed user, uint256 payout, bool holderDiscount);

    modifier onlyOwner() { require(msg.sender == owner, "NOT_OWNER"); _; }

    constructor(address payable vaultAddr, address flwcTokenAddr) {
        owner     = msg.sender;
        vault     = vaultAddr;
        flwcToken = IERC20(flwcTokenAddr);
    }

    // ── Owner: open a match for betting ──────────────────────────

    function openMatch(
        bytes32 matchId,
        uint64  kickoff,
        uint32  homeStrength,
        uint32  awayStrength
    ) external onlyOwner {
        require(pools[matchId].kickoff == 0, "EXISTS");
        pools[matchId].kickoff      = kickoff;
        pools[matchId].homeStrength = homeStrength;
        pools[matchId].awayStrength = awayStrength;
        emit MatchOpened(matchId, kickoff, homeStrength, awayStrength);
    }

    // ── Anyone: commit block hash at kickoff ──────────────────────

    /// @notice Call within ~8.5 min of kickoff with the block number at kickoff.
    function commitSeed(bytes32 matchId, uint32 blockNumber) external {
        Pool storage p = pools[matchId];
        require(p.kickoff != 0,                        "UNKNOWN");
        require(!p.seedCommitted,                      "ALREADY_COMMITTED");
        require(block.timestamp >= p.kickoff,          "NOT_STARTED");
        require(block.number > blockNumber,            "BLOCK_NOT_MINED");
        require(block.number - blockNumber <= 255,     "BLOCK_TOO_OLD");

        bytes32 seed = blockhash(blockNumber);
        require(seed != bytes32(0), "INVALID_BLOCK");

        p.seed          = seed;
        p.seedBlock     = blockNumber;
        p.seedCommitted = true;
        emit SeedCommitted(matchId, seed, blockNumber);
    }

    // ── Bet ───────────────────────────────────────────────────────

    function placeBet(bytes32 matchId, Outcome outcome) external payable nonReentrant {
        Pool storage p = pools[matchId];
        require(!p.settled,             "SETTLED");
        require(msg.value >= MIN_BET,   "BELOW_MIN");

        // If match has kickoff set, only allow bets before kickoff
        if (p.kickoff != 0) {
            require(block.timestamp < p.kickoff, "MATCH_STARTED");
        }

        if (outcome == Outcome.Home)      p.homePool += msg.value;
        else if (outcome == Outcome.Draw) p.drawPool += msg.value;
        else                              p.awayPool += msg.value;

        stakes[matchId][uint8(outcome)][msg.sender] += msg.value;
        emit BetPlaced(matchId, msg.sender, outcome, msg.value);
    }

    // ── Anyone: settle after match ends ──────────────────────────

    /// @notice Anyone can settle once the seed is committed and 20 min have passed.
    function settle(bytes32 matchId) external nonReentrant {
        Pool storage p = pools[matchId];
        require(p.seedCommitted,                              "SEED_NOT_COMMITTED");
        require(!p.settled,                                   "ALREADY_SETTLED");
        require(block.timestamp >= p.kickoff + MATCH_DURATION,"NOT_FINISHED");

        (uint8 homeGoals, uint8 awayGoals) = computeResult(
            p.seed, p.homeStrength, p.awayStrength
        );

        Outcome winner;
        if      (homeGoals > awayGoals) winner = Outcome.Home;
        else if (homeGoals < awayGoals) winner = Outcome.Away;
        else                             winner = Outcome.Draw;

        p.winner  = winner;
        p.settled = true;

        // Send fee to vault
        uint256 total = p.homePool + p.drawPool + p.awayPool;
        if (total > 0 && vault != address(0)) {
            uint256 fee = (total * FEE_BPS_STANDARD) / 10000;
            if (fee > 0) { (bool ok,) = vault.call{value: fee}(""); require(ok, "FEE_FAILED"); }
        }

        emit MatchSettled(matchId, winner, homeGoals, awayGoals);
    }

    // ── Owner fallback settle (for matches without seed) ─────────

    function ownerSettle(bytes32 matchId, Outcome winner) external onlyOwner nonReentrant {
        Pool storage p = pools[matchId];
        require(!p.settled, "ALREADY_SETTLED");
        p.winner  = winner;
        p.settled = true;

        uint256 total = p.homePool + p.drawPool + p.awayPool;
        if (total > 0 && vault != address(0)) {
            uint256 fee = (total * FEE_BPS_STANDARD) / 10000;
            if (fee > 0) { (bool ok,) = vault.call{value: fee}(""); require(ok, "FEE_FAILED"); }
        }
        emit MatchSettled(matchId, winner, 0, 0);
    }

    // ── Claim ─────────────────────────────────────────────────────

    function claim(bytes32 matchId) external nonReentrant {
        Pool storage p = pools[matchId];
        require(p.settled, "NOT_SETTLED");

        uint256 myStake = stakes[matchId][uint8(p.winner)][msg.sender];
        require(myStake > 0, "NO_STAKE");
        stakes[matchId][uint8(p.winner)][msg.sender] = 0;

        // Fee discount for FLWC holders
        bool isHolder = flwcToken.balanceOf(msg.sender) >= FLWC_THRESHOLD;
        uint256 feeBps = isHolder ? FEE_BPS_HOLDER : FEE_BPS_STANDARD;

        uint256 total   = p.homePool + p.drawPool + p.awayPool;
        uint256 afterFee = total - (total * feeBps) / 10000;
        uint256 winPool = p.winner == Outcome.Home ? p.homePool
            : p.winner == Outcome.Draw ? p.drawPool
            : p.awayPool;

        uint256 payout = (afterFee * myStake) / winPool;
        (bool ok,) = msg.sender.call{value: payout}("");
        require(ok, "TRANSFER_FAILED");
        emit Claimed(matchId, msg.sender, payout, isHolder);
    }

    // ── Pure: deterministic result (mirrors frontend keccak256) ──

    function computeResult(bytes32 seed, uint256 homeStr, uint256 awayStr)
        public pure returns (uint8 homeGoals, uint8 awayGoals)
    {
        uint256 total = homeStr + awayStr;
        for (uint256 min = 1; min <= 90; min++) {
            uint256 goalRoll = uint256(keccak256(abi.encodePacked(seed, min, uint8(1)))) % 10000;
            if (goalRoll < 280) {
                uint256 teamRoll = uint256(keccak256(abi.encodePacked(seed, min, uint8(2)))) % total;
                if (teamRoll < homeStr) homeGoals++;
                else awayGoals++;
            }
        }
    }

    // ── Views ─────────────────────────────────────────────────────

    function getPool(bytes32 matchId) external view returns (
        uint256 homePool, uint256 drawPool, uint256 awayPool,
        bool settled, uint8 winner, bool seedCommitted
    ) {
        Pool storage p = pools[matchId];
        return (p.homePool, p.drawPool, p.awayPool, p.settled, uint8(p.winner), p.seedCommitted);
    }

    function myStakes(bytes32 matchId, address user) external view returns (
        uint256 home, uint256 draw, uint256 away
    ) {
        return (
            stakes[matchId][0][user],
            stakes[matchId][1][user],
            stakes[matchId][2][user]
        );
    }

    function isFlwcHolder(address user) external view returns (bool) {
        return flwcToken.balanceOf(user) >= FLWC_THRESHOLD;
    }

    function setVault(address payable newVault) external onlyOwner { vault = newVault; }
}
