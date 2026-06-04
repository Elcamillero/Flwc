// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Parimutuel per-match betting. No setup needed — anyone bets on any matchId.
/// @dev Owner settles with the winning outcome. 2% fee to vault on claim.
contract MatchPredictions is ReentrancyGuard {
    uint256 public constant FEE_BPS = 200;
    uint256 public constant MIN_BET  = 0.0001 ether;

    enum Outcome { Home, Draw, Away }

    struct Pool {
        uint256 homePool;
        uint256 drawPool;
        uint256 awayPool;
        Outcome winner;
        bool    settled;
    }

    address public immutable owner;
    address payable public vault;

    mapping(bytes32 => Pool) public pools;
    // stakes[matchId][outcome][user]
    mapping(bytes32 => mapping(uint8 => mapping(address => uint256))) public stakes;

    event BetPlaced(bytes32 indexed matchId, address indexed user, Outcome outcome, uint256 amount);
    event MatchSettled(bytes32 indexed matchId, Outcome winner);
    event Claimed(bytes32 indexed matchId, address indexed user, uint256 payout);

    modifier onlyOwner() { require(msg.sender == owner, "NOT_OWNER"); _; }

    constructor(address payable vaultAddr) {
        owner = msg.sender;
        vault = vaultAddr;
    }

    // ── Bet ──────────────────────────────────────────────────────────

    function placeBet(bytes32 matchId, Outcome outcome) external payable nonReentrant {
        require(!pools[matchId].settled, "SETTLED");
        require(msg.value >= MIN_BET, "BELOW_MIN");

        Pool storage p = pools[matchId];
        if (outcome == Outcome.Home)      p.homePool += msg.value;
        else if (outcome == Outcome.Draw) p.drawPool += msg.value;
        else                              p.awayPool += msg.value;

        stakes[matchId][uint8(outcome)][msg.sender] += msg.value;
        emit BetPlaced(matchId, msg.sender, outcome, msg.value);
    }

    // ── Settle (owner) ────────────────────────────────────────────────

    function settle(bytes32 matchId, Outcome winner) external onlyOwner nonReentrant {
        Pool storage p = pools[matchId];
        require(!p.settled, "ALREADY_SETTLED");
        p.winner = winner;
        p.settled = true;

        // Send 2% fee to vault
        uint256 total = p.homePool + p.drawPool + p.awayPool;
        if (total > 0 && vault != address(0)) {
            uint256 fee = (total * FEE_BPS) / 10000;
            if (fee > 0) {
                (bool ok,) = vault.call{value: fee}("");
                require(ok, "FEE_FAILED");
            }
        }

        emit MatchSettled(matchId, winner);
    }

    // ── Claim ─────────────────────────────────────────────────────────

    function claim(bytes32 matchId) external nonReentrant {
        Pool storage p = pools[matchId];
        require(p.settled, "NOT_SETTLED");

        uint256 myStake = stakes[matchId][uint8(p.winner)][msg.sender];
        require(myStake > 0, "NO_STAKE");
        stakes[matchId][uint8(p.winner)][msg.sender] = 0;

        uint256 total = p.homePool + p.drawPool + p.awayPool;
        uint256 afterFee = total - (total * FEE_BPS) / 10000;
        uint256 winPool = p.winner == Outcome.Home ? p.homePool
            : p.winner == Outcome.Draw ? p.drawPool
            : p.awayPool;

        uint256 payout = (afterFee * myStake) / winPool;
        (bool ok,) = msg.sender.call{value: payout}("");
        require(ok, "TRANSFER_FAILED");
        emit Claimed(matchId, msg.sender, payout);
    }

    // ── View ──────────────────────────────────────────────────────────

    function getPool(bytes32 matchId) external view returns (
        uint256 homePool,
        uint256 drawPool,
        uint256 awayPool,
        bool settled,
        uint8 winner
    ) {
        Pool storage p = pools[matchId];
        return (p.homePool, p.drawPool, p.awayPool, p.settled, uint8(p.winner));
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
}
