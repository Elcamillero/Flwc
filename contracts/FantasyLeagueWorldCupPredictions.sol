// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice MVP prediction pool for Fantasy League World Cup.
/// @dev This is a product prototype contract and must be audited before mainnet use.
contract FantasyLeagueWorldCupPredictions {
    address public immutable owner;
    bool public locked;
    bool public settled;
    bytes32 public championTeamId;
    uint256 public totalPool;

    mapping(bytes32 => bool) public registeredTeams;
    mapping(bytes32 => uint256) public teamPools;
    mapping(bytes32 => mapping(address => uint256)) public predictions;
    mapping(address => bool) public claimed;

    event TeamRegistered(bytes32 indexed teamId);
    event Predicted(address indexed user, bytes32 indexed teamId, uint256 amount);
    event Locked();
    event Settled(bytes32 indexed championTeamId);
    event Claimed(address indexed user, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    constructor(bytes32[] memory initialTeams) {
        owner = msg.sender;

        for (uint256 i = 0; i < initialTeams.length; i++) {
            registeredTeams[initialTeams[i]] = true;
            emit TeamRegistered(initialTeams[i]);
        }
    }

    function registerTeam(bytes32 teamId) external onlyOwner {
        require(!locked, "POOL_LOCKED");
        registeredTeams[teamId] = true;
        emit TeamRegistered(teamId);
    }

    function predictChampion(bytes32 teamId) external payable {
        require(!locked, "POOL_LOCKED");
        require(registeredTeams[teamId], "UNKNOWN_TEAM");
        require(msg.value > 0, "NO_VALUE");

        predictions[teamId][msg.sender] += msg.value;
        teamPools[teamId] += msg.value;
        totalPool += msg.value;

        emit Predicted(msg.sender, teamId, msg.value);
    }

    function lockPredictions() external onlyOwner {
        require(!locked, "ALREADY_LOCKED");
        locked = true;
        emit Locked();
    }

    function settleChampion(bytes32 teamId) external onlyOwner {
        require(locked, "NOT_LOCKED");
        require(!settled, "ALREADY_SETTLED");
        require(registeredTeams[teamId], "UNKNOWN_TEAM");

        championTeamId = teamId;
        settled = true;

        emit Settled(teamId);
    }

    function claim() external {
        require(settled, "NOT_SETTLED");
        require(!claimed[msg.sender], "CLAIMED");

        uint256 userStake = predictions[championTeamId][msg.sender];
        require(userStake > 0, "NO_WINNING_STAKE");

        claimed[msg.sender] = true;
        uint256 payout = (totalPool * userStake) / teamPools[championTeamId];

        (bool sent,) = msg.sender.call{value: payout}("");
        require(sent, "TRANSFER_FAILED");

        emit Claimed(msg.sender, payout);
    }
}
