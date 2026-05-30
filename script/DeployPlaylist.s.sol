// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/PlaylistBounty.sol";

/**
 * Deploy PlaylistBounty to any EVM-compatible chain.
 *
 * Local anvil:
 *   forge script script/DeployPlaylist.s.sol --rpc-url http://localhost:8545 --broadcast
 *
 * Monad testnet:
 *   forge script script/DeployPlaylist.s.sol \
 *     --rpc-url https://testnet-rpc.monad.xyz \
 *     --broadcast \
 *     --private-key $PRIVATE_KEY \
 *     -vvv
 *
 * Env:
 *   PRIVATE_KEY    — deployer private key (required for non-anvil networks)
 *   TREASURY_SEED  — initial treasury in wei (default: 0.1 ether)
 */
contract DeployPlaylist is Script {
    function run() external returns (PlaylistBounty bounty) {
        uint256 treasurySeed = vm.envOr("TREASURY_SEED", uint256(0.1 ether));

        vm.startBroadcast();
        bounty = new PlaylistBounty{value: treasurySeed}();
        vm.stopBroadcast();

        console.log("PlaylistBounty deployed at:", address(bounty));
        console.log("Treasury seeded:           ", treasurySeed);
        console.log("Deployer:                  ", msg.sender);
    }
}
