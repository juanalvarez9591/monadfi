// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title CasinoRoulette
 *
 * Game flow:
 *   1. House calls openGame(randomSeed)  — opens a round, seed stored on-chain
 *   2. Players call contribute(gameId, amount) — stake MonadTokens during the window
 *   3. Anyone calls resolveGame(gameId) — picks winner using stored seed + block data
 *   4. If resolveGame is never called, anyone calls triggerRefund then claimRefund
 *
 * Agents can query isAcceptingContributions / isReadyToResolve before acting.
 */
contract CasinoRoulette is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Constants ──────────────────────────────────────────────────────────────

    uint256 public constant CONTRIBUTION_WINDOW = 15 seconds;
    uint256 public constant REFUND_DEADLINE = 30 seconds; // grace after window before refunds open
    uint16 public constant MAX_FEE_BPS = 1000; // 10%
    uint256 public constant MAX_PLAYERS = 100;

    // ── Types ──────────────────────────────────────────────────────────────────

    enum GameState {
        None,
        Open,
        Resolved,
        Refunded
    }

    struct Game {
        GameState state;
        bytes32 randomSeed; // supplied by house at openGame; used in resolveGame
        uint256 windowClose; // contributions accepted until this timestamp
        uint256 totalPot; // sum of all MonadToken contributions
        address winner; // set after resolveGame
        uint256 houseFeeTaken;
    }

    // ── Storage ────────────────────────────────────────────────────────────────

    IERC20 public immutable MONAD_TOKEN;
    uint16 public houseFee; // basis points (100 = 1%)
    uint256 public gameCount;

    mapping(uint256 => Game) public games;
    mapping(uint256 => address[]) private _players;
    mapping(uint256 => mapping(address => uint256)) public playerContributions;
    mapping(uint256 => mapping(address => bool)) private _hasJoined;
    mapping(uint256 => mapping(address => bool)) private _refundClaimed;

    // ── Events ─────────────────────────────────────────────────────────────────

    event GameOpened(uint256 indexed gameId, uint256 windowClose);
    event PlayerContributed(uint256 indexed gameId, address indexed player, uint256 amount, uint256 newTotalPot);
    event GameResolved(uint256 indexed gameId, address indexed winner, uint256 payout, uint256 fee);
    event GameRefunded(uint256 indexed gameId);
    event RefundClaimed(uint256 indexed gameId, address indexed player, uint256 amount);
    event HouseFeeUpdated(uint16 oldFee, uint16 newFee);

    // ── Errors ─────────────────────────────────────────────────────────────────

    error GameNotOpen(uint256 gameId);
    error GameNotRefunded(uint256 gameId);
    error WindowStillOpen(uint256 windowClose);
    error WindowClosed(uint256 windowClose);
    error RefundDeadlineNotReached(uint256 refundOpenAt);
    error ZeroAmount();
    error EmptyPot(uint256 gameId);
    error AlreadyClaimed(uint256 gameId);
    error NoContribution(uint256 gameId);
    error FeeTooHigh(uint16 fee, uint16 max);
    error GameAlreadyActive();
    error MaxPlayersReached();

    // ── Constructor ────────────────────────────────────────────────────────────

    constructor(address initialOwner, address monadToken) Ownable(initialOwner) {
        MONAD_TOKEN = IERC20(monadToken);
    }

    // ── House: open a game ─────────────────────────────────────────────────────

    /**
     * @notice Open a new game. Supply any random bytes32 as a seed — it is stored
     *         on-chain and used when resolveGame is called. You do NOT need to
     *         remember or re-submit it.
     * @param randomSeed Off-chain random value, e.g. keccak256(abi.encode(block.timestamp, msg.sender))
     */
    function openGame(bytes32 randomSeed) external onlyOwner returns (uint256 gameId) {
        if (gameCount > 0 && games[gameCount].state == GameState.Open) revert GameAlreadyActive();

        gameId = ++gameCount;
        uint256 windowClose = block.timestamp + CONTRIBUTION_WINDOW;

        games[gameId] = Game({
            state: GameState.Open,
            randomSeed: randomSeed,
            windowClose: windowClose,
            totalPot: 0,
            winner: address(0),
            houseFeeTaken: 0
        });

        emit GameOpened(gameId, windowClose);
    }

    // ── Players: contribute MonadTokens ───────────────────────────────────────

    /**
     * @notice Stake MonadTokens into the current game.
     *         Winning probability is proportional to your stake.
     *         Requires prior approval: MONAD_TOKEN.approve(address(this), amount)
     */
    function contribute(uint256 gameId, uint256 amount) external nonReentrant {
        Game storage game = games[gameId];
        if (game.state != GameState.Open) revert GameNotOpen(gameId);
        if (block.timestamp >= game.windowClose) revert WindowClosed(game.windowClose);
        if (amount == 0) revert ZeroAmount();

        if (!_hasJoined[gameId][msg.sender]) {
            if (_players[gameId].length >= MAX_PLAYERS) revert MaxPlayersReached();
            _players[gameId].push(msg.sender);
            _hasJoined[gameId][msg.sender] = true;
        }

        playerContributions[gameId][msg.sender] += amount;
        game.totalPot += amount;

        MONAD_TOKEN.safeTransferFrom(msg.sender, address(this), amount);
        emit PlayerContributed(gameId, msg.sender, amount, game.totalPot);
    }

    // ── Anyone: resolve after window closes ───────────────────────────────────

    /**
     * @notice Pick a winner and pay out. Callable by anyone once the contribution
     *         window is closed. Uses the stored randomSeed combined with block data.
     */
    function resolveGame(uint256 gameId) external nonReentrant {
        Game storage game = games[gameId];
        if (game.state != GameState.Open) revert GameNotOpen(gameId);
        if (block.timestamp < game.windowClose) revert WindowStillOpen(game.windowClose);
        if (game.totalPot == 0) revert EmptyPot(gameId);

        uint256 seed = uint256(keccak256(abi.encodePacked(game.randomSeed, blockhash(block.number - 1), gameId)));

        address winner = _pickWinner(gameId, seed % game.totalPot);
        uint256 fee = (game.totalPot * houseFee) / 10_000;
        uint256 payout = game.totalPot - fee;

        game.state = GameState.Resolved;
        game.winner = winner;
        game.houseFeeTaken = fee;

        if (fee > 0) MONAD_TOKEN.safeTransfer(owner(), fee);
        MONAD_TOKEN.safeTransfer(winner, payout);

        emit GameResolved(gameId, winner, payout, fee);
    }

    // ── Refund path (if resolveGame is never called) ───────────────────────────

    /**
     * @notice Open the refund path. Callable by anyone after REFUND_DEADLINE
     *         past the contribution window — protects players if the house goes silent.
     */
    function triggerRefund(uint256 gameId) external {
        Game storage game = games[gameId];
        if (game.state != GameState.Open) revert GameNotOpen(gameId);
        uint256 refundOpenAt = game.windowClose + REFUND_DEADLINE;
        if (block.timestamp <= refundOpenAt) revert RefundDeadlineNotReached(refundOpenAt);

        game.state = GameState.Refunded;
        emit GameRefunded(gameId);
    }

    /**
     * @notice Claim your MonadToken refund after a game enters the Refunded state.
     */
    function claimRefund(uint256 gameId) external nonReentrant {
        Game storage game = games[gameId];
        if (game.state != GameState.Refunded) revert GameNotRefunded(gameId);
        if (_refundClaimed[gameId][msg.sender]) revert AlreadyClaimed(gameId);
        uint256 amount = playerContributions[gameId][msg.sender];
        if (amount == 0) revert NoContribution(gameId);

        _refundClaimed[gameId][msg.sender] = true;
        MONAD_TOKEN.safeTransfer(msg.sender, amount);
        emit RefundClaimed(gameId, msg.sender, amount);
    }

    // ── Admin ──────────────────────────────────────────────────────────────────

    /**
     * @notice Update the house fee. Can only be changed between games.
     * @param feeBps Fee in basis points (e.g. 500 = 5%). Max 1000 (10%).
     */
    function setHouseFee(uint16 feeBps) external onlyOwner {
        if (gameCount > 0 && games[gameCount].state == GameState.Open) revert GameAlreadyActive();
        if (feeBps > MAX_FEE_BPS) revert FeeTooHigh(feeBps, MAX_FEE_BPS);
        emit HouseFeeUpdated(houseFee, feeBps);
        houseFee = feeBps;
    }

    // ── Agent-friendly views ───────────────────────────────────────────────────

    /// @notice Returns a game's full state as a struct.
    function getGame(uint256 gameId) external view returns (Game memory) {
        return games[gameId];
    }

    /// @notice Returns the latest game ID and its full state in one call.
    function getCurrentGame() external view returns (uint256 gameId, Game memory game) {
        gameId = gameCount;
        game = games[gameCount];
    }

    /// @notice True when the game is open and players can still contribute.
    function isAcceptingContributions(uint256 gameId) external view returns (bool) {
        Game storage g = games[gameId];
        return g.state == GameState.Open && block.timestamp < g.windowClose;
    }

    /// @notice True when the window has closed and resolveGame can be called.
    function isReadyToResolve(uint256 gameId) external view returns (bool) {
        Game storage g = games[gameId];
        return g.state == GameState.Open && block.timestamp >= g.windowClose && g.totalPot > 0;
    }

    // ── No-arg dispatch helpers (for agents) ─────────────────────────────────────
    // These collapse the game state into single booleans so an agent can pick an
    // action with no argument reasoning. They always refer to the current game.

    /// @notice True when the house can open a new game (no game yet, or the last
    ///         one is finished). Mirrors the openGame guard.
    function canOpen() external view returns (bool) {
        return gameCount == 0 || games[gameCount].state != GameState.Open;
    }

    /// @notice True when the current game's window has closed and it has a pot,
    ///         i.e. resolveGame would succeed.
    function canResolve() external view returns (bool) {
        Game storage g = games[gameCount];
        return g.state == GameState.Open && block.timestamp >= g.windowClose && g.totalPot > 0;
    }

    /// @notice True when players can still contribute to the current game.
    function canContribute() external view returns (bool) {
        Game storage g = games[gameCount];
        return g.state == GameState.Open && block.timestamp < g.windowClose;
    }

    /// @notice How many MonadTokens a specific player has staked in a game.
    function myContribution(uint256 gameId, address player) external view returns (uint256) {
        return playerContributions[gameId][player];
    }

    /// @notice Full list of players in a game.
    function getPlayers(uint256 gameId) external view returns (address[] memory) {
        return _players[gameId];
    }

    // ── Internal ───────────────────────────────────────────────────────────────

    function _pickWinner(uint256 gameId, uint256 winningTicket) internal view returns (address) {
        address[] storage players = _players[gameId];
        uint256 cumulative;
        for (uint256 i = 0; i < players.length; i++) {
            cumulative += playerContributions[gameId][players[i]];
            if (winningTicket < cumulative) return players[i];
        }
        return players[players.length - 1];
    }
}
