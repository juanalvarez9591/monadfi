// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/CasinoRoulette.sol";
import "../src/MonadToken.sol";

contract CasinoRouletteTest is Test {
    CasinoRoulette roulette;
    MonadToken token;

    address house = makeAddr("house");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    bytes32 constant SEED = keccak256("random_seed");
    uint256 constant STAKE = 100 * 10 ** 18;

    function setUp() public {
        vm.prank(house);
        token = new MonadToken(house);

        vm.prank(house);
        roulette = new CasinoRoulette(house, address(token));

        vm.startPrank(house);
        token.mint(alice, 10_000 * 10 ** 18);
        token.mint(bob, 10_000 * 10 ** 18);
        token.mint(carol, 10_000 * 10 ** 18);
        vm.stopPrank();

        vm.prank(alice);
        token.approve(address(roulette), type(uint256).max);
        vm.prank(bob);
        token.approve(address(roulette), type(uint256).max);
        vm.prank(carol);
        token.approve(address(roulette), type(uint256).max);
    }

    // ── openGame ───────────────────────────────────────────────────────────────

    function test_OpenGame() public {
        vm.prank(house);
        uint256 id = roulette.openGame(SEED);
        assertEq(id, 1);

        CasinoRoulette.Game memory g = roulette.getGame(1);
        assertEq(uint8(g.state), uint8(CasinoRoulette.GameState.Open));
        assertEq(g.randomSeed, SEED);
        assertEq(g.totalPot, 0);
    }

    function test_OpenGame_RevertsIfAlreadyActive() public {
        vm.prank(house);
        roulette.openGame(SEED);
        vm.prank(house);
        vm.expectRevert(CasinoRoulette.GameAlreadyActive.selector);
        roulette.openGame(SEED);
    }

    function test_OpenGame_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        roulette.openGame(SEED);
    }

    // ── contribute ─────────────────────────────────────────────────────────────

    function test_Contribute() public {
        vm.prank(house);
        roulette.openGame(SEED);

        vm.prank(alice);
        roulette.contribute(1, STAKE);

        assertEq(roulette.playerContributions(1, alice), STAKE);
        assertEq(roulette.getGame(1).totalPot, STAKE);
        assertEq(token.balanceOf(address(roulette)), STAKE);
    }

    function test_Contribute_MultiplePlayersAccumulate() public {
        vm.prank(house);
        roulette.openGame(SEED);

        vm.prank(alice);
        roulette.contribute(1, 300 * 10 ** 18);
        vm.prank(bob);
        roulette.contribute(1, 700 * 10 ** 18);

        assertEq(roulette.getGame(1).totalPot, 1000 * 10 ** 18);
        assertEq(roulette.getPlayers(1).length, 2);
    }

    function test_Contribute_SamePlayerAccumulates() public {
        vm.prank(house);
        roulette.openGame(SEED);

        vm.prank(alice);
        roulette.contribute(1, STAKE);
        vm.prank(alice);
        roulette.contribute(1, STAKE);

        assertEq(roulette.playerContributions(1, alice), STAKE * 2);
        assertEq(roulette.getPlayers(1).length, 1);
    }

    function test_Contribute_RevertsAfterWindowClose() public {
        vm.prank(house);
        roulette.openGame(SEED);
        vm.warp(block.timestamp + roulette.CONTRIBUTION_WINDOW() + 1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CasinoRoulette.WindowClosed.selector, roulette.getGame(1).windowClose));
        roulette.contribute(1, STAKE);
    }

    function test_Contribute_RevertsZeroAmount() public {
        vm.prank(house);
        roulette.openGame(SEED);

        vm.prank(alice);
        vm.expectRevert(CasinoRoulette.ZeroAmount.selector);
        roulette.contribute(1, 0);
    }

    // ── resolveGame ────────────────────────────────────────────────────────────

    function test_ResolveGame_HappyPath() public {
        vm.prank(house);
        roulette.openGame(SEED);
        vm.prank(alice);
        roulette.contribute(1, 1000 * 10 ** 18);

        vm.warp(block.timestamp + roulette.CONTRIBUTION_WINDOW() + 1);

        uint256 balBefore = token.balanceOf(alice);
        roulette.resolveGame(1); // callable by anyone

        CasinoRoulette.Game memory g = roulette.getGame(1);
        assertEq(uint8(g.state), uint8(CasinoRoulette.GameState.Resolved));
        assertEq(g.winner, alice);
        assertGt(token.balanceOf(alice), balBefore);
    }

    function test_ResolveGame_CallableByAnyone() public {
        vm.prank(house);
        roulette.openGame(SEED);
        vm.prank(alice);
        roulette.contribute(1, STAKE);
        vm.warp(block.timestamp + roulette.CONTRIBUTION_WINDOW() + 1);

        vm.prank(bob); // not the owner — should still work
        roulette.resolveGame(1);

        assertEq(uint8(roulette.getGame(1).state), uint8(CasinoRoulette.GameState.Resolved));
    }

    function test_ResolveGame_FeeToHouse() public {
        vm.prank(house); // 5%
        roulette.setHouseFee(500);
        vm.prank(house);
        roulette.openGame(SEED);
        vm.prank(alice);
        roulette.contribute(1, 1000 * 10 ** 18);

        vm.warp(block.timestamp + roulette.CONTRIBUTION_WINDOW() + 1);
        uint256 houseBefore = token.balanceOf(house);
        roulette.resolveGame(1);

        assertEq(token.balanceOf(house) - houseBefore, 50 * 10 ** 18); // 5% of 1000
    }

    function test_ResolveGame_RevertsWindowStillOpen() public {
        vm.prank(house);
        roulette.openGame(SEED);
        vm.prank(alice);
        roulette.contribute(1, STAKE);

        vm.expectRevert(
            abi.encodeWithSelector(CasinoRoulette.WindowStillOpen.selector, roulette.getGame(1).windowClose)
        );
        roulette.resolveGame(1);
    }

    function test_ResolveGame_RevertsEmptyPot() public {
        vm.prank(house);
        roulette.openGame(SEED);
        vm.warp(block.timestamp + roulette.CONTRIBUTION_WINDOW() + 1);

        vm.expectRevert(abi.encodeWithSelector(CasinoRoulette.EmptyPot.selector, 1));
        roulette.resolveGame(1);
    }

    // ── isAcceptingContributions / isReadyToResolve ────────────────────────────

    function test_AgentHelpers() public {
        vm.prank(house);
        roulette.openGame(SEED);

        assertTrue(roulette.isAcceptingContributions(1));
        assertFalse(roulette.isReadyToResolve(1));

        vm.prank(alice);
        roulette.contribute(1, STAKE);
        vm.warp(block.timestamp + roulette.CONTRIBUTION_WINDOW() + 1);

        assertFalse(roulette.isAcceptingContributions(1));
        assertTrue(roulette.isReadyToResolve(1));
    }

    // ── No-arg dispatch helpers (canOpen / canResolve / canContribute) ──────────

    function test_NoArgHelpers_FreshState() public view {
        // No game opened yet: house can open, nothing else.
        assertTrue(roulette.canOpen());
        assertFalse(roulette.canResolve());
        assertFalse(roulette.canContribute());
    }

    function test_NoArgHelpers_OpenGame() public {
        vm.prank(house);
        roulette.openGame(SEED);
        // Game open, window not elapsed.
        assertFalse(roulette.canOpen()); // game already active
        assertFalse(roulette.canResolve()); // window still open / empty pot
        assertTrue(roulette.canContribute()); // players may contribute
    }

    function test_NoArgHelpers_ReadyToResolve() public {
        vm.prank(house);
        roulette.openGame(SEED);
        vm.prank(alice);
        roulette.contribute(1, STAKE);
        vm.warp(block.timestamp + roulette.CONTRIBUTION_WINDOW() + 1);

        assertFalse(roulette.canOpen()); // current game not finished
        assertTrue(roulette.canResolve()); // window closed, pot > 0
        assertFalse(roulette.canContribute()); // window closed
    }

    function test_NoArgHelpers_AfterResolve() public {
        vm.prank(house);
        roulette.openGame(SEED);
        vm.prank(alice);
        roulette.contribute(1, STAKE);
        vm.warp(block.timestamp + roulette.CONTRIBUTION_WINDOW() + 1);
        roulette.resolveGame(1);

        // Game resolved: house can open the next one.
        assertTrue(roulette.canOpen());
        assertFalse(roulette.canResolve());
        assertFalse(roulette.canContribute());
    }

    function test_NoArgHelpers_WindowClosedEmptyPot() public {
        vm.prank(house);
        roulette.openGame(SEED);
        vm.warp(block.timestamp + roulette.CONTRIBUTION_WINDOW() + 1);

        // Window closed but no contributions: not resolvable, not openable.
        assertFalse(roulette.canResolve());
        assertFalse(roulette.canContribute());
        assertFalse(roulette.canOpen());
    }

    function test_GetCurrentGame() public {
        vm.prank(house);
        roulette.openGame(SEED);

        (uint256 id, CasinoRoulette.Game memory g) = roulette.getCurrentGame();
        assertEq(id, 1);
        assertEq(uint8(g.state), uint8(CasinoRoulette.GameState.Open));
    }

    // ── Refund flow ────────────────────────────────────────────────────────────

    function test_TriggerRefund_AfterDeadline() public {
        vm.prank(house);
        roulette.openGame(SEED);
        vm.prank(alice);
        roulette.contribute(1, STAKE);

        vm.warp(block.timestamp + roulette.CONTRIBUTION_WINDOW() + roulette.REFUND_DEADLINE() + 1);
        roulette.triggerRefund(1);

        assertEq(uint8(roulette.getGame(1).state), uint8(CasinoRoulette.GameState.Refunded));
    }

    function test_TriggerRefund_RevertsBeforeDeadline() public {
        vm.prank(house);
        roulette.openGame(SEED);
        vm.prank(alice);
        roulette.contribute(1, STAKE);
        vm.warp(block.timestamp + roulette.CONTRIBUTION_WINDOW() + 1);

        uint256 refundOpenAt = roulette.getGame(1).windowClose + roulette.REFUND_DEADLINE();
        vm.expectRevert(abi.encodeWithSelector(CasinoRoulette.RefundDeadlineNotReached.selector, refundOpenAt));
        roulette.triggerRefund(1);
    }

    function test_ClaimRefund() public {
        vm.prank(house);
        roulette.openGame(SEED);
        vm.prank(alice);
        roulette.contribute(1, STAKE);

        vm.warp(block.timestamp + roulette.CONTRIBUTION_WINDOW() + roulette.REFUND_DEADLINE() + 1);
        roulette.triggerRefund(1);

        uint256 balBefore = token.balanceOf(alice);
        vm.prank(alice);
        roulette.claimRefund(1);
        assertEq(token.balanceOf(alice), balBefore + STAKE);
    }

    function test_ClaimRefund_RevertsDoubleClaim() public {
        vm.prank(house);
        roulette.openGame(SEED);
        vm.prank(alice);
        roulette.contribute(1, STAKE);
        vm.warp(block.timestamp + roulette.CONTRIBUTION_WINDOW() + roulette.REFUND_DEADLINE() + 1);
        roulette.triggerRefund(1);

        vm.prank(alice);
        roulette.claimRefund(1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CasinoRoulette.AlreadyClaimed.selector, 1));
        roulette.claimRefund(1);
    }

    // ── Sequential games ───────────────────────────────────────────────────────

    function test_SequentialGames() public {
        vm.prank(house);
        roulette.openGame(SEED);
        vm.prank(alice);
        roulette.contribute(1, STAKE);
        vm.warp(block.timestamp + roulette.CONTRIBUTION_WINDOW() + 1);
        roulette.resolveGame(1);

        vm.prank(house);
        roulette.openGame(keccak256("seed2"));
        assertEq(roulette.gameCount(), 2);
        assertEq(uint8(roulette.getGame(2).state), uint8(CasinoRoulette.GameState.Open));
    }
}
