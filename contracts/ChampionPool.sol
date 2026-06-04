// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Parimutuel pool for predicting the FLWC tournament champion.
/// @dev 2% protocol fee. Owner locks predictions at tournament start and settles after the final.
contract ChampionPool is Ownable, ReentrancyGuard {
    uint256 public constant FEE_BPS = 200;
    uint256 public constant MIN_BET = 0.0001 ether;

    address payable public vault;
    bool public locked;
    bool public settled;
    bytes32 public championTeamId;
    uint256 public totalPool;

    mapping(bytes32 => bool)                         public registeredTeams;
    mapping(bytes32 => uint256)                      public teamPools;
    mapping(bytes32 => mapping(address => uint256))  public predictions;
    mapping(address => bool)                         public claimed;

    event TeamRegistered(bytes32 indexed teamId);
    event PredictionPlaced(address indexed user, bytes32 indexed teamId, uint256 amount);
    event Locked();
    event Settled(bytes32 indexed championTeamId);
    event Claimed(address indexed user, uint256 payout);
    event VaultUpdated(address newVault);

    constructor(address initialOwner, address payable vaultAddr, bytes32[] memory initialTeams)
        Ownable(initialOwner)
    {
        vault = vaultAddr;
        for (uint256 i = 0; i < initialTeams.length; i++) {
            registeredTeams[initialTeams[i]] = true;
            emit TeamRegistered(initialTeams[i]);
        }
    }

    // ── Owner ────────────────────────────────────────────────────────

    function registerTeam(bytes32 teamId) external onlyOwner {
        require(!locked, "LOCKED");
        registeredTeams[teamId] = true;
        emit TeamRegistered(teamId);
    }

    function lock() external onlyOwner {
        require(!locked, "ALREADY_LOCKED");
        locked = true;
        emit Locked();
    }

    function settle(bytes32 teamId) external onlyOwner {
        require(locked, "NOT_LOCKED");
        require(!settled, "ALREADY_SETTLED");
        require(registeredTeams[teamId], "UNKNOWN_TEAM");
        championTeamId = teamId;
        settled = true;
        emit Settled(teamId);
    }

    function setVault(address payable newVault) external onlyOwner {
        vault = newVault;
        emit VaultUpdated(newVault);
    }

    // ── Bettors ──────────────────────────────────────────────────────

    function predictChampion(bytes32 teamId) external payable nonReentrant {
        require(!locked, "LOCKED");
        require(registeredTeams[teamId], "UNKNOWN_TEAM");
        require(msg.value >= MIN_BET, "BELOW_MIN");

        predictions[teamId][msg.sender] += msg.value;
        teamPools[teamId] += msg.value;
        totalPool += msg.value;
        emit PredictionPlaced(msg.sender, teamId, msg.value);
    }

    function claim() external nonReentrant {
        require(settled, "NOT_SETTLED");
        require(!claimed[msg.sender], "CLAIMED");

        uint256 myStake = predictions[championTeamId][msg.sender];
        require(myStake > 0, "NO_WINNING_STAKE");

        claimed[msg.sender] = true;

        uint256 afterFee = totalPool - (totalPool * FEE_BPS) / 10000;
        uint256 payout = (afterFee * myStake) / teamPools[championTeamId];

        // Send fee to vault on first claim trigger
        uint256 fee = totalPool - afterFee;
        if (fee > 0 && vault != address(0)) {
            (bool feeOk,) = vault.call{value: fee}("");
            require(feeOk, "FEE_FAILED");
        }

        (bool ok,) = msg.sender.call{value: payout}("");
        require(ok, "TRANSFER_FAILED");
        emit Claimed(msg.sender, payout);
    }

    function myPrediction(bytes32 teamId, address user) external view returns (uint256) {
        return predictions[teamId][user];
    }
}
