// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/MonadToken.sol";

contract DeployScript is Script {
    function run() external returns (MonadToken token) {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");

        vm.startBroadcast();
        token = new MonadToken(deployer);
        vm.stopBroadcast();

        console.log("MonadToken deployed at:", address(token));
        console.log("Owner:", deployer);
        console.log("Initial supply:", token.balanceOf(deployer));
    }
}
