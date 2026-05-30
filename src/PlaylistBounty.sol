// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title PlaylistBounty
 *
 * Hackathon contract — single dev wallet, roles passed as string params.
 *
 * Flow:
 *   1. Agent (role "agent_N") calls submitPlaylist() with native MON stake + song IDs.
 *   2. Oracle (role "oracle_N") calls scorePlaylist() with a score 1–10.
 *   3. Score determines how much the agent gets back vs. the treasury keeps.
 *
 * Slashing table (score → agent receives X% of stake):
 *   1 →   0%   (100% slashed → treasury)
 *   2 →  20%   ( 80% slashed)
 *   3 →  40%   ( 60% slashed)
 *   4 →  60%   ( 40% slashed)
 *   5 → 100%   (break even)
 *   6 → 110%   (+10% reward, treasury pays)
 *   7 → 120%   (+20%)
 *   8 → 140%   (+40%)
 *   9 → 170%   (+70%)
 *  10 → 200%   (doubles)
 *
 * Treasury sustainability (uniform 1-10 distribution over one stake unit):
 *   Income from scores 1-5: 100+80+60+40+0 = 280%
 *   Payouts  for scores 6-10: 10+20+40+70+100 = 240%
 *   Net per 10-agent cycle: +40% of one stake → sustainable ✓
 *
 * All roles share the same devWallet. Role strings must start with
 * "agent_" or "oracle_" (e.g. "agent_1", "oracle_1") — this is dev-only.
 */
contract PlaylistBounty {

    address public immutable devWallet;

    uint256 public constant POOL_SIZE = 15;
    uint256 public round = 1;
    uint256 private _roundStart; // index of first playlist in the current round

    struct Playlist {
        string   roleId;
        string   name;
        uint256[] songIds;
        uint256  stake;
        uint256  submittedAt;
        bool     scored;
        uint8    score;
    }

    Playlist[] private _playlists;
    uint256 public pendingHead; // index of next unscored playlist

    // ── Events ─────────────────────────────────────────────────────────────────

    event PlaylistSubmitted(
        uint256 indexed playlistId,
        string  roleId,
        string  name,
        uint256[] songIds,
        uint256 stake
    );

    event PlaylistScored(
        uint256 indexed playlistId,
        string  roleId,
        uint8   score,
        uint256 agentPayout,
        uint256 treasuryDelta,
        bool    treasuryGained
    );

    // Emitted when all POOL_SIZE playlists in a round have been scored.
    // avgScore10x is avg * 10 for integer math (e.g. 72 = avg 7.2).
    event RoundComplete(
        uint256 indexed round,
        uint256 poolSize,
        uint256 totalScore,
        uint256 avgScore10x
    );

    // ── Errors ─────────────────────────────────────────────────────────────────

    error NotDevWallet();
    error InvalidRole(string role);
    error InvalidScore(uint8 score);
    error AlreadyScored(uint256 playlistId);
    error StakeRequired();
    error TreasuryInsufficient(uint256 need, uint256 have);
    error PlaylistNotFound(uint256 playlistId);

    // ── Constructor ────────────────────────────────────────────────────────────

    constructor() payable {
        devWallet = msg.sender;
    }

    modifier onlyDev() {
        if (msg.sender != devWallet) revert NotDevWallet();
        _;
    }

    // ── Role helpers ───────────────────────────────────────────────────────────

    function _isAgent(string calldata r) internal pure returns (bool) {
        bytes memory b = bytes(r);
        // must be at least "agent_X" (7 chars)
        if (b.length < 7) return false;
        return b[0]=='a' && b[1]=='g' && b[2]=='e' && b[3]=='n' && b[4]=='t' && b[5]=='_';
    }

    function _isOracle(string calldata r) internal pure returns (bool) {
        bytes memory b = bytes(r);
        // must be at least "oracle_X" (8 chars)
        if (b.length < 8) return false;
        return b[0]=='o' && b[1]=='r' && b[2]=='a' && b[3]=='c' && b[4]=='l' && b[5]=='e' && b[6]=='_';
    }

    // ── Agent: submit a playlist ───────────────────────────────────────────────

    /**
     * @notice Stake native MON and publish a playlist of song IDs.
     * @param roleId   Must start with "agent_" (e.g. "agent_1").
     * @param songIds  Array of off-chain song DB IDs.
     */
    function submitPlaylist(string calldata roleId, string calldata name, uint256[] calldata songIds)
        external payable onlyDev
    {
        if (!_isAgent(roleId))  revert InvalidRole(roleId);
        if (msg.value == 0)     revert StakeRequired();

        uint256 id = _playlists.length;
        _playlists.push(Playlist({
            roleId:      roleId,
            name:        name,
            songIds:     songIds,
            stake:       msg.value,
            submittedAt: block.timestamp,
            scored:      false,
            score:       0
        }));

        emit PlaylistSubmitted(id, roleId, name, songIds, msg.value);
    }

    // ── Oracle: score a playlist ───────────────────────────────────────────────

    /**
     * @notice Score a submitted playlist. Slashes or rewards based on score.
     * @param roleId     Must start with "oracle_" (e.g. "oracle_1").
     * @param playlistId Index of the playlist to score.
     * @param score      Integer 1–10.
     */
    function scorePlaylist(string calldata roleId, uint256 playlistId, uint8 score)
        external onlyDev
    {
        if (!_isOracle(roleId))              revert InvalidRole(roleId);
        if (score < 1 || score > 10)         revert InvalidScore(score);
        if (playlistId >= _playlists.length) revert PlaylistNotFound(playlistId);

        Playlist storage pl = _playlists[playlistId];
        if (pl.scored) revert AlreadyScored(playlistId);

        pl.scored = true;
        pl.score  = score;

        // Advance pendingHead past all scored playlists.
        while (pendingHead < _playlists.length && _playlists[pendingHead].scored) {
            pendingHead++;
        }

        uint256 stake = pl.stake;
        uint256 agentPayout;
        uint256 treasuryDelta;
        bool    treasuryGained;

        if (score == 1) {
            agentPayout    = 0;
            treasuryDelta  = stake;
            treasuryGained = true;
        } else if (score == 2) {
            agentPayout    = stake * 20 / 100;
            treasuryDelta  = stake * 80 / 100;
            treasuryGained = true;
        } else if (score == 3) {
            agentPayout    = stake * 40 / 100;
            treasuryDelta  = stake * 60 / 100;
            treasuryGained = true;
        } else if (score == 4) {
            agentPayout    = stake * 60 / 100;
            treasuryDelta  = stake * 40 / 100;
            treasuryGained = true;
        } else if (score == 5) {
            agentPayout    = stake;
            treasuryDelta  = 0;
            treasuryGained = true;
        } else if (score == 6) {
            agentPayout    = stake * 110 / 100;
            treasuryDelta  = stake * 10 / 100;
            treasuryGained = false;
        } else if (score == 7) {
            agentPayout    = stake * 120 / 100;
            treasuryDelta  = stake * 20 / 100;
            treasuryGained = false;
        } else if (score == 8) {
            agentPayout    = stake * 140 / 100;
            treasuryDelta  = stake * 40 / 100;
            treasuryGained = false;
        } else if (score == 9) {
            agentPayout    = stake * 170 / 100;
            treasuryDelta  = stake * 70 / 100;
            treasuryGained = false;
        } else {
            // score == 10: doubles
            agentPayout    = stake * 200 / 100;
            treasuryDelta  = stake;
            treasuryGained = false;
        }

        if (agentPayout > 0) {
            uint256 bal = address(this).balance;
            // Re-add the already-received stake since it's sitting in the contract.
            // Available = current balance (which already includes the original stake
            // for scores <=5; for scores >5 the treasury must cover the extra).
            if (bal < agentPayout) revert TreasuryInsufficient(agentPayout, bal);
            (bool ok,) = payable(devWallet).call{value: agentPayout}("");
            require(ok, "payout failed");
        }

        emit PlaylistScored(playlistId, roleId, score, agentPayout, treasuryDelta, treasuryGained);

        // Check if all POOL_SIZE playlists in this round are now scored.
        if (pendingHead >= _roundStart + POOL_SIZE) {
            uint256 total = 0;
            for (uint256 i = _roundStart; i < _roundStart + POOL_SIZE; i++) {
                total += _playlists[i].score;
            }
            uint256 avg10x = (total * 10) / POOL_SIZE;
            emit RoundComplete(round, POOL_SIZE, total, avg10x);
            _roundStart += POOL_SIZE;
            round++;
        }
    }

    // ── Agent-friendly views ───────────────────────────────────────────────────

    /// Total playlists ever submitted.
    function playlistCount() external view returns (uint256) {
        return _playlists.length;
    }

    /// True when there is at least one unscored playlist waiting.
    function canScore() external view returns (bool) {
        return pendingHead < _playlists.length;
    }

    /// True when the current round's pool still has room (< POOL_SIZE submitted).
    function canSubmit() external view returns (bool) {
        return _playlists.length - _roundStart < POOL_SIZE;
    }

    /// How many playlists have been submitted in the current round.
    function roundSubmitted() external view returns (uint256) {
        return _playlists.length - _roundStart;
    }

    /// ID of the oldest unscored playlist — what the oracle should score next.
    function pendingPlaylistId() external view returns (uint256) {
        return pendingHead;
    }

    /// Number of unscored playlists.
    function pendingCount() external view returns (uint256) {
        return _playlists.length - pendingHead;
    }

    /// Read a full playlist by ID.
    function getPlaylist(uint256 id) external view returns (
        string memory roleId,
        string memory name,
        uint256[] memory songIds,
        uint256 stake,
        uint256 submittedAt,
        bool scored,
        uint8 score
    ) {
        require(id < _playlists.length, "not found");
        Playlist storage pl = _playlists[id];
        return (pl.roleId, pl.name, pl.songIds, pl.stake, pl.submittedAt, pl.scored, pl.score);
    }

    /// Native MON balance held by this contract (= treasury).
    function treasury() external view returns (uint256) {
        return address(this).balance;
    }

    // ── Treasury funding ───────────────────────────────────────────────────────

    receive() external payable {}
}
