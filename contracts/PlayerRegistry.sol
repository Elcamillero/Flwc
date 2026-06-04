// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Non-tradable player data registry for Fantasy League World Cup.
contract PlayerRegistry is Ownable {
    struct PlayerStats {
        bytes32 teamId;
        uint8   rating;
        uint8   attack;
        uint8   defense;
        uint8   pace;
        bool    active;
    }

    mapping(bytes32 => PlayerStats) public players;
    bytes32[] public playerIds;

    event PlayerRegistered(bytes32 indexed playerId, bytes32 indexed teamId, uint8 rating, uint8 attack, uint8 defense, uint8 pace);
    event PlayerStatusChanged(bytes32 indexed playerId, bool active);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function registerPlayer(
        bytes32 playerId,
        bytes32 teamId,
        uint8 rating,
        uint8 attack,
        uint8 defense,
        uint8 pace
    ) external onlyOwner {
        require(playerId != bytes32(0), "INVALID_PLAYER");
        require(teamId != bytes32(0), "INVALID_TEAM");
        require(rating <= 100 && attack <= 100 && defense <= 100 && pace <= 100, "INVALID_STATS");

        if (players[playerId].teamId == bytes32(0)) playerIds.push(playerId);

        players[playerId] = PlayerStats({ teamId: teamId, rating: rating, attack: attack, defense: defense, pace: pace, active: true });
        emit PlayerRegistered(playerId, teamId, rating, attack, defense, pace);
    }

    function registerPlayerBatch(
        bytes32[] calldata ids,
        bytes32[] calldata teamIds,
        uint8[] calldata ratings,
        uint8[] calldata attacks,
        uint8[] calldata defenses,
        uint8[] calldata paces
    ) external onlyOwner {
        require(ids.length == teamIds.length && ids.length == ratings.length, "LENGTH_MISMATCH");
        for (uint256 i = 0; i < ids.length; i++) {
            if (players[ids[i]].teamId == bytes32(0)) playerIds.push(ids[i]);
            players[ids[i]] = PlayerStats({
                teamId: teamIds[i], rating: ratings[i], attack: attacks[i],
                defense: defenses[i], pace: paces[i], active: true
            });
            emit PlayerRegistered(ids[i], teamIds[i], ratings[i], attacks[i], defenses[i], paces[i]);
        }
    }

    function setPlayerActive(bytes32 playerId, bool active) external onlyOwner {
        require(players[playerId].teamId != bytes32(0), "UNKNOWN");
        players[playerId].active = active;
        emit PlayerStatusChanged(playerId, active);
    }

    function playerCount() external view returns (uint256) { return playerIds.length; }
}
