// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/MonadToken.sol";
import "../src/CasinoRoulette.sol";

contract DeployCasino is Script {
    function run() external returns (MonadToken token, CasinoRoulette casino) {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");

        vm.startBroadcast();
        token = new MonadToken(deployer);
        casino = new CasinoRoulette(deployer, address(token));
        vm.stopBroadcast();

        console.log("MonadToken deployed at:    ", address(token));
        console.log("CasinoRoulette deployed at:", address(casino));
        console.log("MONAD_TOKEN:               ", address(casino.MONAD_TOKEN()));
    }
}
