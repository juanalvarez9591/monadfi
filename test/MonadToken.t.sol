// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/MonadToken.sol";

contract MonadTokenTest is Test {
    MonadToken token;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");

    function setUp() public {
        vm.prank(owner);
        token = new MonadToken(owner);
    }

    function test_InitialState() public view {
        assertEq(token.name(), "MonadToken");
        assertEq(token.symbol(), "MTKN");
        assertEq(token.owner(), owner);
        assertEq(token.totalSupply(), 100_000_000 * 10 ** 18);
        assertEq(token.balanceOf(owner), 100_000_000 * 10 ** 18);
    }

    function test_MintByOwner() public {
        uint256 amount = 1_000 * 10 ** 18;
        vm.prank(owner);
        token.mint(alice, amount);
        assertEq(token.balanceOf(alice), amount);
    }

    function test_MintRevertsIfNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        token.mint(alice, 1_000 * 10 ** 18);
    }

    function test_MintRevertsIfExceedsMaxSupply() public {
        uint256 toMint = token.MAX_SUPPLY() - token.totalSupply() + 1;
        vm.prank(owner);
        vm.expectRevert("Exceeds max supply");
        token.mint(alice, toMint);
    }

    function test_Burn() public {
        uint256 burnAmount = 1_000 * 10 ** 18;
        vm.prank(owner);
        token.burn(burnAmount);
        assertEq(token.totalSupply(), 100_000_000 * 10 ** 18 - burnAmount);
    }

    function testFuzz_Transfer(uint256 amount) public {
        amount = bound(amount, 1, token.balanceOf(owner));
        vm.prank(owner);
        token.transfer(alice, amount);
        assertEq(token.balanceOf(alice), amount);
    }
}
