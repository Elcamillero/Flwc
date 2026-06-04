// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice FLWC utility token. Fixed supply, no mint after deploy.
contract FLWCToken is ERC20, ERC20Burnable, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 1e18; // 1 billion

    constructor(address treasury) ERC20("Fantasy League World Cup", "FLWC") Ownable(treasury) {
        _mint(treasury, MAX_SUPPLY);
    }
}
