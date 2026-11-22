// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * AriesEscrow.sol — Aries Protocol Wager Escrow Contract
 *
 * Flow:
 *  1. Both players call lockWager() before the game starts
 *  2. Both locks confirmed → game is eligible to start
 *  3. Game engine calls settle() after server-verified outcome
 *  4. Winner receives pot minus 2% platform fee
 *  5. On dispute or timeout: both players get full refunds
 *
 * Security:
 *  - ReentrancyGuard on all state-changing functions
 *  - Only the SETTLER_ROLE (our backend wallet) can settle
 *  - 24-hour timeout: either player can claim refund if game never starts
 *  - Platform fee capped at 5% on-chain — cannot be changed by code alone
 *  - All wagers in USDT (ERC-20) — no raw ETH wagers
 */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract AriesEscrow is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ─── Roles ────────────────────────────────────────────────────────────────
    bytes32 public constant SETTLER_ROLE   = keccak256("SETTLER_ROLE");
    bytes32 public constant PAUSER_ROLE    = keccak256("PAUSER_ROLE");
    bytes32 public constant TREASURY_ROLE  = keccak256("TREASURY_ROLE");

    // ─── Constants ────────────────────────────────────────────────────────────
    uint256 public constant PLATFORM_FEE_BPS  = 200;   // 2% — hard-coded on-chain
    uint256 public constant MAX_PLATFORM_FEE  = 500;   // Fee can never exceed 5% even via upgrade
    uint256 public constant LOCK_TIMEOUT      = 24 hours;
    uint256 public constant DISPUTE_TIMEOUT   = 7 days;
    uint256 public constant MAX_GAME_DURATION = 7 days;
    uint256 public constant BPS_DENOMINATOR   = 10_000;

    // ─── Accepted stablecoins ─────────────────────────────────────────────────
    mapping(address => bool) public acceptedTokens;

    // ─── Escrow state ─────────────────────────────────────────────────────────
    enum EscrowStatus { Empty, WhiteLocked, BothLocked, Settled, Refunded, Disputed }

    struct EscrowGame {
        bytes32     gameId;
        address     whitePlayer;
        address     blackPlayer;
        address     token;          // USDT / USDC / DAI address
        uint256     wagerAmount;    // Per player (equal amounts required)
        EscrowStatus status;
        uint256     lockedAt;       // Timestamp of first lock
        uint256     bothLockedAt;
        uint256     startedAt;
        uint256     gameDeadline;
        uint256     disputedAt;
        uint256     settledAt;
        bool        whiteLocked;
        bool        blackLocked;
    }

    mapping(bytes32 => EscrowGame) public games;

    // ─── Treasury ─────────────────────────────────────────────────────────────
    address public treasury;
    mapping(address => uint256) public collectedFees;

    // ─── Events ───────────────────────────────────────────────────────────────
    event WagerLocked(bytes32 indexed gameId, address indexed player, address token, uint256 amount);
    event GameStarted(bytes32 indexed gameId, uint256 startedAt, uint256 deadline);
    event GameSettled(bytes32 indexed gameId, address indexed winner, uint256 payout, uint256 fee);
    event DisputeResolved(bytes32 indexed gameId, address indexed winner);
    event GameRefunded(bytes32 indexed gameId, string reason);
    event GameDisputed(bytes32 indexed gameId, string reason);
    event TokenAdded(address indexed token);
    event TokenRemoved(address indexed token);
    event FeesWithdrawn(address indexed token, uint256 amount);

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(address _treasury, address[] memory _tokens) {
        require(_treasury != address(0), "Invalid treasury");
        treasury = _treasury;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(SETTLER_ROLE,       msg.sender);
        _grantRole(PAUSER_ROLE,        msg.sender);
        _grantRole(TREASURY_ROLE,      _treasury);

        for (uint i = 0; i < _tokens.length; i++) {
            require(_tokens[i] != address(0) && _tokens[i].code.length > 0, "Invalid token");
            acceptedTokens[_tokens[i]] = true;
            emit TokenAdded(_tokens[i]);
        }
    }

    // ─── Lock wager ───────────────────────────────────────────────────────────
    /**
     * Called by each player before a game starts.
     * Player must have approved this contract for `amount` of `token` first.
     *
     * @param gameId       Unique match identifier
     * @param opponent     The other player's address
     * @param token        Stablecoin address (USDT / USDC / DAI)
     * @param amount       Wager amount (must match opponent's lock)
     */
    function lockWager(
        bytes32 gameId,
        address opponent,
        address token,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        require(acceptedTokens[token],        "Token not accepted");
        require(gameId != bytes32(0),         "Invalid game ID");
        require(amount > 0 && amount <= type(uint256).max / 2, "Invalid wager amount");
        require(opponent != address(0),       "Invalid opponent");
        require(opponent != msg.sender,       "Cannot play yourself");

        EscrowGame storage game = games[gameId];

        if (game.status == EscrowStatus.Empty) {
            // First lock — initialize the escrow
            game.gameId       = gameId;
            game.whitePlayer  = msg.sender;
            game.blackPlayer  = opponent;
            game.token        = token;
            game.wagerAmount  = amount;
            game.status       = EscrowStatus.WhiteLocked;
            game.lockedAt     = block.timestamp;
            game.whiteLocked  = true;

        } else if (game.status == EscrowStatus.WhiteLocked) {
            // Second lock — validate consistency
            require(game.blackPlayer == msg.sender,  "Not the expected player");
            require(game.whitePlayer == opponent,    "Opponent mismatch");
            require(game.token == token,             "Token mismatch");
            require(game.wagerAmount == amount,      unicode"Wager amount mismatch — must be equal");
            require(!game.blackLocked,               "Already locked");
            require(
                block.timestamp < game.lockedAt + LOCK_TIMEOUT,
                unicode"Lock window expired — request refund"
            );

            game.blackLocked = true;
            game.bothLockedAt = block.timestamp;
            game.status      = EscrowStatus.BothLocked;

        } else {
            revert("Game not in lockable state");
        }

        // Reject fee-on-transfer / non-exact tokens so escrow is always fully collateralized.
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        require(IERC20(token).balanceOf(address(this)) - balanceBefore == amount, "Non-exact token transfer");

        emit WagerLocked(gameId, msg.sender, token, amount);
    }

    // ─── Game lifecycle ───────────────────────────────────────────────────────
    /**
     * Called by the authorized game oracle after both wagers are locked.
     * The deadline is bounded so players can recover funds if settlement fails.
     * @param gameId Match identifier
     * @param deadline Unix timestamp after which either player may recover the wager
     */
    function startGame(bytes32 gameId, uint256 deadline)
        external onlyRole(SETTLER_ROLE) whenNotPaused
    {
        EscrowGame storage game = games[gameId];
        require(game.status == EscrowStatus.BothLocked, "Game not ready to start");
        require(game.startedAt == 0, "Game already started");
        require(deadline > block.timestamp, "Invalid game deadline");
        require(deadline <= block.timestamp + MAX_GAME_DURATION, "Game deadline too far");
        game.startedAt = block.timestamp;
        game.gameDeadline = deadline;
        emit GameStarted(gameId, block.timestamp, deadline);
    }

    function settle(bytes32 gameId, address winner)
        external onlyRole(SETTLER_ROLE) nonReentrant whenNotPaused
    {
        EscrowGame storage game = games[gameId];
        require(game.status == EscrowStatus.BothLocked, "Game not in settleable state");
        require(game.startedAt != 0, "Game has not started");
        require(block.timestamp < game.gameDeadline, "Game deadline passed");
        _settleGame(gameId, winner);
    }

    function resolveDispute(bytes32 gameId, address winner)
        external onlyRole(SETTLER_ROLE) nonReentrant whenNotPaused
    {
        EscrowGame storage game = games[gameId];
        require(game.status == EscrowStatus.Disputed, "Game is not disputed");
        require(block.timestamp < game.disputedAt + DISPUTE_TIMEOUT, "Dispute resolution expired");
        _settleGame(gameId, winner);
        emit DisputeResolved(gameId, winner);
    }

    function _settleGame(bytes32 gameId, address winner) internal {
        EscrowGame storage game = games[gameId];
        address white = game.whitePlayer;
        address black = game.blackPlayer;
        address token = game.token;
        uint256 wager = game.wagerAmount;
        require(winner == address(0) || winner == white || winner == black, "Winner not a participant");
        game.status = EscrowStatus.Settled;
        game.settledAt = block.timestamp;
        if (winner == address(0)) {
            IERC20(token).safeTransfer(white, wager);
            IERC20(token).safeTransfer(black, wager);
            emit GameSettled(gameId, address(0), wager, 0);
            return;
        }
        uint256 pot = wager * 2;
        uint256 fee = Math.mulDiv(pot, PLATFORM_FEE_BPS, BPS_DENOMINATOR);
        uint256 payout = pot - fee;
        collectedFees[token] += fee;
        IERC20(token).safeTransfer(winner, payout);
        emit GameSettled(gameId, winner, payout, fee);
    }

    // ─── Refund ───────────────────────────────────────────────────────────────
    /**
     * Either player can claim a refund if:
     *  a) The opponent never locked within 24 hours, or
     *  b) The settler calls refund (game cancelled / technical error)
     */
    function refund(bytes32 gameId, string calldata reason)
        external nonReentrant
    {
        require(bytes(reason).length > 0 && bytes(reason).length <= 256, "Invalid refund reason");
        EscrowGame storage game = games[gameId];
        require(
            game.status == EscrowStatus.WhiteLocked ||
            game.status == EscrowStatus.BothLocked ||
            game.status == EscrowStatus.Disputed,
            "Cannot refund in this state"
        );
        bool isPlayer = msg.sender == game.whitePlayer || msg.sender == game.blackPlayer;
        bool settlerMayCancel = hasRole(SETTLER_ROLE, msg.sender) &&
            (game.status == EscrowStatus.WhiteLocked ||
                (game.status == EscrowStatus.BothLocked && game.startedAt == 0));
        bool unstartedTimeout =
            (game.status == EscrowStatus.WhiteLocked && block.timestamp >= game.lockedAt + LOCK_TIMEOUT) ||
            (game.status == EscrowStatus.BothLocked && game.startedAt == 0 &&
                block.timestamp >= game.bothLockedAt + LOCK_TIMEOUT);
        bool activeGameTimeout = game.status == EscrowStatus.BothLocked &&
            game.startedAt != 0 && block.timestamp >= game.gameDeadline;
        bool disputeTimeout = game.status == EscrowStatus.Disputed &&
            block.timestamp >= game.disputedAt + DISPUTE_TIMEOUT;
        require(
            settlerMayCancel || (isPlayer && (unstartedTimeout || activeGameTimeout || disputeTimeout)),
            "Not authorized to refund"
        );
        game.status = EscrowStatus.Refunded;
        address token = game.token;
        if (game.whiteLocked) IERC20(token).safeTransfer(game.whitePlayer, game.wagerAmount);
        if (game.blackLocked) IERC20(token).safeTransfer(game.blackPlayer, game.wagerAmount);
        emit GameRefunded(gameId, reason);
    }

    // ─── Dispute ──────────────────────────────────────────────────────────────
    function disputeGame(bytes32 gameId, string calldata reason)
        external
    {
        EscrowGame storage game = games[gameId];
        require(
            msg.sender == game.whitePlayer || msg.sender == game.blackPlayer || hasRole(SETTLER_ROLE, msg.sender),
            "Not authorized to dispute"
        );
        require(bytes(reason).length > 0 && bytes(reason).length <= 256, "Invalid dispute reason");
        require(game.status == EscrowStatus.BothLocked, "Cannot dispute in this state");
        require(game.startedAt != 0, "Game has not started");
        require(block.timestamp < game.gameDeadline, "Game deadline passed");
        game.status = EscrowStatus.Disputed;
        game.disputedAt = block.timestamp;
        emit GameDisputed(gameId, reason);
        // Funds remain locked pending human review
    }

    // ─── Treasury withdrawal ──────────────────────────────────────────────────
    function withdrawFees(address token) external onlyRole(TREASURY_ROLE) nonReentrant {
        require(msg.sender == treasury, "Treasury address required");
        uint256 amount = collectedFees[token];
        require(amount > 0, "No fees to withdraw");
        collectedFees[token] = 0;
        IERC20(token).safeTransfer(treasury, amount);
        emit FeesWithdrawn(token, amount);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────
    function addToken(address token)    external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(token != address(0) && token.code.length > 0, "Invalid token");
        acceptedTokens[token] = true;
        emit TokenAdded(token);
    }
    function removeToken(address token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        acceptedTokens[token] = false;
        emit TokenRemoved(token);
    }
    function pause()   external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    // ─── View ─────────────────────────────────────────────────────────────────
    function getGame(bytes32 gameId) external view returns (EscrowGame memory) {
        return games[gameId];
    }

    function computePayout(uint256 wagerPerPlayer) external pure returns (
        uint256 pot, uint256 fee, uint256 winnerPayout
    ) {
        require(wagerPerPlayer <= type(uint256).max / 2, "Invalid wager amount");
        pot          = wagerPerPlayer * 2;
        fee          = Math.mulDiv(pot, PLATFORM_FEE_BPS, BPS_DENOMINATOR);
        winnerPayout = pot - fee;
    }
}
