// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Receives protocol fees from prediction pools.
contract FLWCVault is Ownable {
    uint256 public totalCollected;

    event FeeReceived(address indexed source, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    constructor(address initialOwner) Ownable(initialOwner) {}

    receive() external payable {
        totalCollected += msg.value;
        emit FeeReceived(msg.sender, msg.value);
    }

    function withdraw(address payable to, uint256 amount) external onlyOwner {
        require(amount <= address(this).balance, "INSUFFICIENT");
        (bool ok,) = to.call{value: amount}("");
        require(ok, "TRANSFER_FAILED");
        emit Withdrawn(to, amount);
    }

    function balance() external view returns (uint256) {
        return address(this).balance;
    }
}
