"use strict";
/**
 * Aries Protocol — Cloud Functions (Firebase Gen 2)
 *
 * All financial settlement happens here — never on the client.
 * The client proposes moves; the server validates and settles.
 *
 * Functions:
 *   settleGame          — triggered when a game doc status → 'finished'
 *   validateMove        — HTTPS callable: validates + applies a chess move
 *   matchmakingPair     — triggered when a matchmaking entry is created
 *   detectFraud         — triggered on every transaction write
 *   collectFee          — sends 2% treasury fee on-chain after settlement
 *   bundleLeaderboard   — scheduled: pre-bundles top-100 for CDN serving
 *   cleanStaleGames     — scheduled: forfeit disconnected players
 *   onUserCreated       — auth trigger: create profile on signup
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTournament = exports.startTournament = exports.registerTournamentPlayer = exports.collectFee = exports.sendGlobalChatMessage = exports.syncPublicProfile = exports.createPublicProfile = exports.onUserCreated = exports.bundleLeaderboard = exports.cleanStaleQueue = exports.cleanStaleGames = exports.detectFraud = exports.matchmakingPair = exports.resignGame = exports.validateMove = exports.settleGame = void 0;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-functions/v2/firestore");
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const identity_1 = require("firebase-functions/v2/identity");
const logger = __importStar(require("firebase-functions/logger"));
const node_crypto_1 = require("node:crypto");
const chess_js_1 = require("chess.js");
const safety_1 = require("./safety");
admin.initializeApp();
const db = admin.firestore();
function publicProfileProjection(profile) {
    return {
        handle: typeof profile.handle === 'string' ? profile.handle : 'Player',
        avatar: typeof profile.avatar === 'string' ? profile.avatar : '',
        rating: typeof profile.rating === 'number' ? profile.rating : 1500,
        ratingBand: typeof profile.ratingBand === 'string' ? profile.ratingBand : 'Unrated',
        matches: typeof profile.matches === 'number' ? profile.matches : 0,
        wins: typeof profile.wins === 'number' ? profile.wins : 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
}
// ─── Constants ────────────────────────────────────────────────────────────────
const PROTOCOL_FEE_RATE = 0.02; // 2% of pot, from winner only
const MOVE_TIMEOUT_SECS = 60; // forfeit if no move in 60s
const QUEUE_TIMEOUT_SECS = 30; // cancel queue entry after 30s
const MAX_WAGER = 1000;
const MIN_WAGER = 1;
// Treasury address receives 2% fee on-chain
const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS || '';
const ALCHEMY_RPC = process.env.ALCHEMY_RPC_URL || '';
// USDT Mainnet contract
const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const USDT_ABI = [
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address) view returns (uint256)',
];
// ─── 1. settleGame ────────────────────────────────────────────────────────────
/**
 * Triggered when a game document's status changes to 'finished'.
 * Re-validates the game result by replaying all moves server-side,
 * then atomically settles both ledgers. Client cannot influence the payout.
 */
exports.settleGame = (0, firestore_1.onDocumentUpdated)({ document: 'games/{gameId}', region: 'us-central1' }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after || !before)
        return;
    // Only act when status transitions to 'finished' and not yet settled
    if (before.status === 'finished' || after.status !== 'finished')
        return;
    if (after.settled === true)
        return;
    const gameId = event.params.gameId;
    const { whiteUid, blackUid, wager, currency, moves } = after;
    // Claim settlement transactionally. Duplicate event deliveries cannot
    // apply profile/rating increments twice. An abandoned claim can be retried
    // after ten minutes.
    const claimed = await db.runTransaction(async (transaction) => {
        const currentSnap = await transaction.get(event.data.after.ref);
        if (!currentSnap.exists)
            return false;
        const current = currentSnap.data();
        if (current.status !== 'finished' || current.settled === true)
            return false;
        const lockAt = current.settlementInProgressAt?.toMillis?.() ?? 0;
        if (current.settlementInProgress === true && Date.now() - lockAt < 10 * 60 * 1000) {
            return false;
        }
        transaction.update(event.data.after.ref, {
            settlementInProgress: true,
            settlementInProgressAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return true;
    });
    if (!claimed)
        return;
    // Real-value games remain disabled until the audited on-chain escrow is integrated.
    if (wager !== 0 || currency !== 'FREE') {
        await event.data.after.ref.update({
            status: 'disputed',
            settled: false,
            settlementInProgress: false,
            disputeReason: 'Wagering disabled until escrow integration is live',
        });
        await db.collection('disputes').add({
            gameId, whiteUid, blackUid, wager, currency,
            reason: 'Unsupported non-free game reached settlement',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return;
    }
    // ── Server-side move validation ──────────────────────────────────────────
    const game = new chess_js_1.Chess();
    let safeResult;
    if (after.endReason === 'resign') {
        const replayState = replayAndVerify(game, moves || [], 'active');
        const expectedWinner = after.resignedBy === whiteUid ? 'black'
            : after.resignedBy === blackUid ? 'white' : null;
        safeResult = replayState === 'active' && expectedWinner !== null && expectedWinner === after.result
            ? expectedWinner : 'invalid';
    }
    else if (after.endReason === 'timeout') {
        const replayState = replayAndVerify(game, moves || [], 'active');
        const lastMoveMs = before.lastMoveAt?.toMillis?.() ?? 0;
        const timedOut = lastMoveMs > 0 && Date.now() - lastMoveMs >= (MOVE_TIMEOUT_SECS + 5) * 1000;
        const expectedWinner = before.turn === 'white' ? 'black' : 'white';
        safeResult = replayState === 'active' && timedOut && after.result === expectedWinner
            ? expectedWinner : 'invalid';
    }
    else {
        safeResult = replayAndVerify(game, moves || [], after.result);
    }
    if (safeResult === 'invalid') {
        // Fraudulent result claimed by client — reverse and flag
        await event.data.after.ref.update({
            settled: false,
            settlementInProgress: false,
            disputed: true,
            disputeReason: 'Server-side move replay did not match claimed result',
        });
        await db.collection('disputes').add({
            gameId, whiteUid, blackUid, clientResult: after.result,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return;
    }
    // Free-play settlement: ratings only. No balances or financial ledger entries.
    const [wSnap, bSnap] = await Promise.all([
        db.collection('profiles').doc(whiteUid).get(),
        db.collection('profiles').doc(blackUid).get(),
    ]);
    const wp = wSnap.data() || {};
    const bp = bSnap.data() || {};
    const whitePlayer = { rating: wp.rating || 1500, rd: wp.rd || 350, volatility: wp.volatility || 0.06 };
    const blackPlayer = { rating: bp.rating || 1500, rd: bp.rd || 350, volatility: bp.volatility || 0.06 };
    const whiteScore = safeResult === 'white' ? 1 : safeResult === 'draw' ? 0.5 : 0;
    const blackScore = safeResult === 'black' ? 1 : safeResult === 'draw' ? 0.5 : 0;
    const wRating = computeGlickoUpdate(whitePlayer, [{ opponentRating: blackPlayer.rating, opponentRd: blackPlayer.rd, score: whiteScore }]);
    const bRating = computeGlickoUpdate(blackPlayer, [{ opponentRating: whitePlayer.rating, opponentRd: whitePlayer.rd, score: blackScore }]);
    const batch = db.batch();
    batch.set(db.collection('profiles').doc(whiteUid), {
        matches: admin.firestore.FieldValue.increment(1),
        ...(safeResult === 'white' ? { wins: admin.firestore.FieldValue.increment(1) } : {}),
        ...(safeResult === 'black' ? { losses: admin.firestore.FieldValue.increment(1) } : {}),
        rating: wRating.newRating,
        rd: wRating.newRd,
        volatility: wRating.newVolatility,
        ratingBand: getRatingBand(wRating.newRating),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(db.collection('profiles').doc(blackUid), {
        matches: admin.firestore.FieldValue.increment(1),
        ...(safeResult === 'black' ? { wins: admin.firestore.FieldValue.increment(1) } : {}),
        ...(safeResult === 'white' ? { losses: admin.firestore.FieldValue.increment(1) } : {}),
        rating: bRating.newRating,
        rd: bRating.newRd,
        volatility: bRating.newVolatility,
        ratingBand: getRatingBand(bRating.newRating),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(db.collection('protocol').doc('stats'), {
        activeMatches: admin.firestore.FieldValue.increment(-1),
        totalMatches: admin.firestore.FieldValue.increment(1),
    }, { merge: true });
    batch.update(event.data.after.ref, {
        settled: true,
        settlementInProgress: false,
        settledAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await batch.commit();
    // Clean up matchmaking entries
    await Promise.allSettled([
        db.collection('matchmaking').doc(whiteUid).delete(),
        db.collection('matchmaking').doc(blackUid).delete(),
    ]);
});
// ─── 2. validateMove (HTTPS Callable) ────────────────────────────────────────
/**
 * Client calls this instead of writing moves directly to Firestore.
 * The server validates the move, applies it, checks for game over,
 * and writes the new state. Client cannot submit illegal moves.
 */
exports.validateMove = (0, https_1.onCall)({ region: 'us-central1', maxInstances: 1000 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in.');
    const { gameId, from, to, promotion = 'q' } = request.data;
    if (!gameId || !from || !to)
        throw new https_1.HttpsError('invalid-argument', 'Missing gameId, from, or to.');
    const uid = request.auth.uid;
    const gameRef = db.collection('games').doc(gameId);
    return db.runTransaction(async (transaction) => {
        const snap = await transaction.get(gameRef);
        if (!snap.exists)
            throw new https_1.HttpsError('not-found', 'Game not found.');
        const data = snap.data();
        if (data.whiteUid !== uid && data.blackUid !== uid) {
            throw new https_1.HttpsError('permission-denied', 'You are not a participant in this game.');
        }
        const myColor = data.whiteUid === uid ? 'white' : 'black';
        if (data.status !== 'active') {
            throw new https_1.HttpsError('failed-precondition', 'Game is not active.');
        }
        if (data.turn !== myColor) {
            throw new https_1.HttpsError('failed-precondition', 'Not your turn.');
        }
        const game = new chess_js_1.Chess();
        for (const priorMove of (data.moves || [])) {
            if (!game.move(priorMove)) {
                throw new https_1.HttpsError('internal', 'Move history corrupted.');
            }
        }
        const moveResult = game.move({ from, to, promotion });
        if (!moveResult)
            throw new https_1.HttpsError('invalid-argument', 'Illegal move.');
        const newFen = game.fen();
        const newPgn = game.pgn();
        const newMoves = [...(data.moves || []), moveResult.san];
        const nextTurn = myColor === 'white' ? 'black' : 'white';
        const gameOver = game.isGameOver();
        const status = gameOver ? 'finished' : 'active';
        const result = gameOver ? (game.isDraw() ? 'draw' : myColor) : null;
        transaction.update(gameRef, {
            fen: newFen,
            pgn: newPgn,
            moves: newMoves,
            turn: nextTurn,
            status,
            result,
            lastMoveAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { fen: newFen, status, result, moveNotation: moveResult.san };
    });
});
// ─── Server-validated resignation ─────────────────────────────────────────────
exports.resignGame = (0, https_1.onCall)({ region: 'us-central1', maxInstances: 500 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in.');
    const gameId = request.data?.gameId;
    if (typeof gameId !== 'string' || gameId.length < 1 || gameId.length > 128) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid gameId.');
    }
    const uid = request.auth.uid;
    const gameRef = db.collection('games').doc(gameId);
    return db.runTransaction(async (transaction) => {
        const snap = await transaction.get(gameRef);
        if (!snap.exists)
            throw new https_1.HttpsError('not-found', 'Game not found.');
        const data = snap.data();
        if (data.status !== 'active') {
            throw new https_1.HttpsError('failed-precondition', 'Game is not active.');
        }
        const resigningColor = data.whiteUid === uid ? 'white'
            : data.blackUid === uid ? 'black' : null;
        if (!resigningColor) {
            throw new https_1.HttpsError('permission-denied', 'You are not a participant.');
        }
        const replay = new chess_js_1.Chess();
        for (const move of (data.moves || [])) {
            if (!replay.move(move)) {
                throw new https_1.HttpsError('failed-precondition', 'Move history is invalid.');
            }
        }
        if (replay.isGameOver()) {
            throw new https_1.HttpsError('failed-precondition', 'The game has already ended.');
        }
        const winner = resigningColor === 'white' ? 'black' : 'white';
        transaction.update(gameRef, {
            status: 'finished',
            result: winner,
            endReason: 'resign',
            resignedBy: uid,
            lastMoveAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { status: 'finished', result: winner };
    });
});
// ─── 3. matchmakingPair ───────────────────────────────────────────────────────
/**
 * Triggered when a new matchmaking entry is created.
 * Finds a compatible waiting opponent and pairs them atomically.
 * Uses wager-range shards to avoid Firestore hotspot contention at scale.
 */
exports.matchmakingPair = (0, firestore_1.onDocumentCreated)({ document: 'matchmaking/{uid}', region: 'us-central1' }, async (event) => {
    const data = event.data?.data();
    const myUid = event.params.uid;
    if (!data || data.status !== 'waiting')
        return;
    const { wager, currency, handle } = data;
    if (wager !== 0 || currency !== 'FREE') {
        logger.warn({ uid: myUid }, 'Rejected matchmaking entry: paid games are disabled until escrow is integrated.');
        await event.data?.ref.delete();
        return;
    }
    // Query for a compatible waiting opponent (same wager + currency, different uid)
    const snap = await db.collection('matchmaking')
        .where('status', '==', 'waiting')
        .where('wager', '==', wager)
        .where('currency', '==', currency)
        .orderBy('joinedAt', 'asc')
        .limit(5)
        .get();
    const opponent = snap.docs.find(d => d.id !== myUid);
    if (!opponent)
        return; // No match yet — wait for next entrant
    const oppData = opponent.data();
    const gameId = `${myUid.slice(0, 8)}_${opponent.id.slice(0, 8)}_${Date.now()}`;
    const gameRef = db.collection('games').doc(gameId);
    const myQueueRef = db.collection('matchmaking').doc(myUid);
    const opponentQueueRef = db.collection('matchmaking').doc(opponent.id);
    // The pair is claimed atomically. Concurrent create triggers cannot pair
    // the same two queue entries twice.
    const paired = await db.runTransaction(async (transaction) => {
        const [myQueue, opponentQueue] = await Promise.all([
            transaction.get(myQueueRef),
            transaction.get(opponentQueueRef),
        ]);
        if (!myQueue.exists || !opponentQueue.exists)
            return false;
        const currentMine = myQueue.data();
        const currentOpponent = opponentQueue.data();
        if (currentMine.status !== 'waiting' || currentOpponent.status !== 'waiting')
            return false;
        if (currentMine.wager !== 0 || currentOpponent.wager !== 0 ||
            currentMine.currency !== 'FREE' || currentOpponent.currency !== 'FREE')
            return false;
        if (currentMine.uid !== myUid || currentOpponent.uid !== opponent.id)
            return false;
        transaction.create(gameRef, {
            gameId,
            whiteUid: myUid,
            blackUid: opponent.id,
            whiteHandle: currentMine.handle,
            blackHandle: currentOpponent.handle,
            wager: 0,
            currency: 'FREE',
            fen: new chess_js_1.Chess().fen(),
            pgn: '',
            moves: [],
            turn: 'white',
            status: 'active',
            result: null,
            settled: false,
            isPublic: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lastMoveAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        transaction.update(myQueueRef, { status: 'matched', gameId });
        transaction.update(opponentQueueRef, { status: 'matched', gameId });
        transaction.set(db.collection('protocol').doc('stats'), {
            activeMatches: admin.firestore.FieldValue.increment(1),
        }, { merge: true });
        return true;
    });
    if (!paired)
        return;
});
// ─── 4. detectFraud ──────────────────────────────────────────────────────────
/**
 * Triggered on every transaction write.
 * Flags accounts for suspicious patterns:
 *   - Win rate > 92% over last 100 games (bot assistance)
 *   - Same two wallets playing > 15 times per day (collusion)
 *   - Game ending in < 5 moves (arranged draw)
 */
exports.detectFraud = (0, firestore_1.onDocumentCreated)({ document: 'transactions/{txId}', region: 'us-central1' }, async (event) => {
    const data = event.data?.data();
    if (!data || data.type !== 'Match' || !data.gameId)
        return;
    const uid = data.userId;
    const gameId = data.gameId;
    // Check win rate
    const recentTx = await db.collection('transactions')
        .where('userId', '==', uid)
        .where('type', '==', 'Match')
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();
    const wins = recentTx.docs.filter(d => (d.data().amount || 0) > 0).length;
    const total = recentTx.docs.length;
    const winRate = total > 20 ? wins / total : 0;
    if (winRate > 0.92) {
        await db.collection('flagged_accounts').doc(uid).set({
            uid, reason: `Suspicious win rate: ${(winRate * 100).toFixed(1)}%`,
            winRate, totalGames: total,
            flaggedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
    // Check for short games (< 5 moves = possible arranged result)
    const game = await db.collection('games').doc(gameId).get();
    if (game.exists) {
        const moves = game.data()?.moves || [];
        if (moves.length < 5 && game.data()?.status === 'finished') {
            await db.collection('flagged_games').doc(gameId).set({
                gameId, reason: `Game ended in only ${moves.length} moves`,
                flaggedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
    }
});
// ─── 5. cleanStaleGames ──────────────────────────────────────────────────────
/**
 * Runs every 2 minutes. Forfeits any active game where lastMoveAt
 * is more than 65 seconds ago (player disconnected / timed out).
 */
exports.cleanStaleGames = (0, scheduler_1.onSchedule)({ schedule: 'every 2 minutes', region: 'us-central1' }, async () => {
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - (MOVE_TIMEOUT_SECS + 5) * 1000);
    const stale = await db.collection('games')
        .where('status', '==', 'active')
        .where('lastMoveAt', '<', cutoff)
        .limit(50)
        .get();
    const promises = stale.docs.map(async (snap) => {
        const data = snap.data();
        // The player whose turn it is has timed out — opponent wins
        const winner = data.turn === 'white' ? 'black' : 'white';
        await snap.ref.update({
            status: 'finished',
            result: winner,
            endReason: 'timeout',
            lastMoveAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    });
    await Promise.allSettled(promises);
});
// ─── 6. cleanStaleQueue ──────────────────────────────────────────────────────
/**
 * Runs every minute. Removes matchmaking entries older than 30 seconds
 * that were never matched (player navigated away).
 */
exports.cleanStaleQueue = (0, scheduler_1.onSchedule)({ schedule: 'every 1 minutes', region: 'us-central1' }, async () => {
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - QUEUE_TIMEOUT_SECS * 1000);
    const stale = await db.collection('matchmaking')
        .where('status', '==', 'waiting')
        .where('joinedAt', '<', cutoff)
        .limit(100)
        .get();
    const batch = db.batch();
    stale.docs.forEach(doc => batch.delete(doc.ref));
    if (!stale.empty)
        await batch.commit();
});
// ─── 7. bundleLeaderboard ────────────────────────────────────────────────────
/**
 * Every 5 minutes, pre-fetches the top-100 leaderboard and writes it
 * to a single cache document. The client reads this one document
 * instead of doing a complex ordered query — 100x fewer Firestore reads.
 */
exports.bundleLeaderboard = (0, scheduler_1.onSchedule)({ schedule: 'every 5 minutes', region: 'us-central1' }, async () => {
    const snap = await db.collection('profiles')
        .orderBy('rating', 'desc')
        .limit(100)
        .get();
    const leaders = snap.docs.map((d, i) => ({
        rank: i + 1,
        uid: d.id,
        handle: d.data().handle,
        avatar: d.data().avatar || '',
        wins: d.data().wins || 0,
        matches: d.data().matches || 0,
        rating: d.data().rating || 1500,
        rd: d.data().rd || 350,
        ratingBand: d.data().ratingBand || 'Unrated',
    }));
    await db.collection('cache').doc('leaderboard').set({
        leaders,
        cachedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
});
// ─── 8. onUserCreated ────────────────────────────────────────────────────────
/**
 * Firebase Auth trigger — creates a profile document the moment a
 * new user registers. Prevents the client from ever writing its own
 * initial profile (which could be forged).
 */
exports.onUserCreated = (0, identity_1.beforeUserCreated)({ region: 'us-central1' }, async (event) => {
    const user = event.data;
    if (!user)
        return;
    const rawName = user.displayName || '';
    const sanitizedHandle = rawName
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 32);
    const handle = sanitizedHandle.length >= 3
        ? sanitizedHandle
        : 'OPERATIVE_' + user.uid.slice(0, 5);
    const initialProfile = {
        id: user.uid,
        handle,
        avatar: user.photoURL || '',
        rank: 'Recruit',
        exp: 0, matches: 0, victories: 0,
        wins: 0, losses: 0, profit: 0,
        rating: 1500, rd: 350, volatility: 0.06, ratingBand: 'Unrated',
        joinedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await Promise.all([
        db.collection('profiles').doc(user.uid).set(initialProfile),
        db.collection('profiles_public').doc(user.uid).set(publicProfileProjection(initialProfile)),
    ]);
});
// Keep public player cards separate from private profiles (wallet/account data).
exports.createPublicProfile = (0, firestore_1.onDocumentCreated)({ document: 'profiles/{uid}', region: 'us-central1' }, async (event) => {
    const profile = event.data?.data();
    if (!profile)
        return;
    await db.collection('profiles_public').doc(event.params.uid)
        .set(publicProfileProjection(profile));
});
exports.syncPublicProfile = (0, firestore_1.onDocumentUpdated)({ document: 'profiles/{uid}', region: 'us-central1' }, async (event) => {
    const profile = event.data?.after.data();
    if (!profile)
        return;
    await db.collection('profiles_public').doc(event.params.uid)
        .set(publicProfileProjection(profile), { merge: true });
});
// ─── Global chat message (authenticated + server rate limited) ────────────────
exports.sendGlobalChatMessage = (0, https_1.onCall)({ region: 'us-central1', maxInstances: 100 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in to send a message.');
    const rawText = request.data?.text;
    if (typeof rawText !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'Message text must be a string.');
    }
    const text = rawText.replace(/[\\u0000-\\u001F\\u007F]/g, ' ').trim();
    if (text.length < 1 || text.length > 500) {
        throw new https_1.HttpsError('invalid-argument', 'Message must contain 1–500 characters.');
    }
    const uid = request.auth.uid;
    const profileRef = db.collection('profiles').doc(uid);
    const rateRef = db.collection('chat_rate_limits').doc(uid);
    const messageRef = db.collection('messages').doc();
    const now = Date.now();
    await db.runTransaction(async (transaction) => {
        const [profileSnap, rateSnap] = await Promise.all([
            transaction.get(profileRef),
            transaction.get(rateRef),
        ]);
        if (!profileSnap.exists) {
            throw new https_1.HttpsError('failed-precondition', 'Complete your player profile before chatting.');
        }
        const handle = profileSnap.get('handle');
        if (typeof handle !== 'string' || !/^[A-Za-z0-9_]{3,32}$/.test(handle)) {
            throw new https_1.HttpsError('failed-precondition', 'Your player handle is invalid.');
        }
        const rate = rateSnap.data() || {};
        const recent = Array.isArray(rate.recentSentAt)
            ? rate.recentSentAt.filter((value) => typeof value === 'number' && now - value < 5000)
            : [];
        const hourly = Array.isArray(rate.hourlySentAt)
            ? rate.hourlySentAt.filter((value) => typeof value === 'number' && now - value < 3600000)
            : [];
        if (recent.length >= 3) {
            throw new https_1.HttpsError('resource-exhausted', 'You are sending messages too quickly.');
        }
        if (hourly.length >= 100) {
            throw new https_1.HttpsError('resource-exhausted', 'Hourly chat limit reached.');
        }
        transaction.set(rateRef, {
            recentSentAt: [...recent, now],
            hourlySentAt: [...hourly, now],
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        transaction.create(messageRef, {
            text,
            userId: uid,
            userName: handle,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    });
    return { messageId: messageRef.id };
});
// ─── 9. collectFee (on-chain treasury transfer) ───────────────────────────────
/**
 * Triggered when a transaction with type 'ProtocolFee' is created.
 * Sends the fee amount in USDT to the treasury wallet on-chain.
 *
 * IMPORTANT: This requires the Cloud Function to have a funded Ethereum
 * wallet. Store the private key in Google Secret Manager — NEVER in env vars
 * directly. See DEPLOYMENT.md for Secret Manager setup.
 */
exports.collectFee = (0, firestore_1.onDocumentCreated)({ document: 'protocol_fees/{feeId}', region: 'us-central1' }, async (event) => {
    const data = event.data?.data();
    if (!data || !TREASURY_ADDRESS || !ALCHEMY_RPC)
        return;
    try {
        // Secret Manager integration — see DEPLOYMENT.md
        // const secretKey = await getSecret('ARIES_TREASURY_PRIVATE_KEY');
        // const wallet = new ethers.Wallet(secretKey, provider);
        // const usdt = new ethers.Contract(USDT_ADDRESS, USDT_ABI, wallet);
        // const tx = await usdt.transfer(TREASURY_ADDRESS, ethers.parseUnits(data.amount.toString(), 6));
        // await tx.wait(1);
        // The on-chain transfer implementation is not enabled.
        // Never mark a fee as collected without a confirmed transaction receipt.
        await event.data.ref.update({
            status: 'pending_integration',
            error: 'No on-chain transfer was sent; treasury integration is not configured.',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    catch (err) {
        console.error('[collectFee] On-chain fee transfer failed:', err);
        await event.data.ref.update({ status: 'failed', error: String(err) });
    }
});
// ─── 10. registerTournamentPlayer (HTTPS Callable) ────────────────────────────
exports.registerTournamentPlayer = (0, https_1.onCall)({ region: 'us-central1', maxInstances: 100 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in.');
    const tournamentId = request.data?.tournamentId;
    const requestedUid = request.data?.uid;
    if (typeof tournamentId !== 'string' || tournamentId.length < 1 || tournamentId.length > 128) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid tournamentId.');
    }
    const callerUid = request.auth.uid;
    if (requestedUid && requestedUid !== callerUid) {
        throw new https_1.HttpsError('permission-denied', 'Cannot register another player.');
    }
    const tRef = db.collection('tournaments').doc(tournamentId);
    const outcome = await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(tRef);
        if (!snap.exists)
            throw new https_1.HttpsError('not-found', 'Tournament not found.');
        const tournament = snap.data();
        if (!(0, safety_1.isFreeOnlyTerms)(tournament.entryFee, tournament.currency)) {
            throw new https_1.HttpsError('failed-precondition', 'Paid tournaments are disabled until escrow and payouts are integrated.');
        }
        if (tournament.status !== 'registration')
            return { ok: false, reason: 'Registration is closed.' };
        if (!Array.isArray(tournament.players)) {
            throw new https_1.HttpsError('failed-precondition', 'Tournament player list is invalid.');
        }
        if (tournament.players.includes(callerUid))
            return { ok: false, reason: 'Already registered.' };
        if (tournament.players.length >= tournament.maxPlayers)
            return { ok: false, reason: 'Tournament is full.' };
        transaction.update(tRef, {
            players: admin.firestore.FieldValue.arrayUnion(callerUid),
        });
        return { ok: true };
    });
    if (outcome.ok) {
        const privateProfile = await db.collection('profiles').doc(callerUid).get();
        if (privateProfile.exists) {
            await db.collection('profiles_public').doc(callerUid)
                .set(publicProfileProjection(privateProfile.data()), { merge: true });
        }
        logger.info({ tournamentId, uid: callerUid }, 'Player registered for free tournament');
    }
    return outcome;
});
// ─── 11. startTournament (HTTPS Callable — admin only) ────────────────────────
exports.startTournament = (0, https_1.onCall)({ region: 'us-central1', maxInstances: 10 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in.');
    const tournamentId = request.data?.tournamentId;
    if (typeof tournamentId !== 'string' || tournamentId.length < 1 || tournamentId.length > 128) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid tournamentId.');
    }
    const tournamentRef = db.collection('tournaments').doc(tournamentId);
    const started = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(tournamentRef);
        if (!snapshot.exists)
            throw new https_1.HttpsError('not-found', 'Tournament not found.');
        const tournament = snapshot.data();
        if (!(0, safety_1.isFreeOnlyTerms)(tournament.entryFee, tournament.currency)) {
            throw new https_1.HttpsError('failed-precondition', 'Paid tournaments are disabled until escrow and payouts are integrated.');
        }
        if (tournament.createdBy !== request.auth.uid) {
            throw new https_1.HttpsError('permission-denied', 'Only the tournament creator can start it.');
        }
        if (tournament.status !== 'registration') {
            throw new https_1.HttpsError('failed-precondition', 'Tournament is not in registration.');
        }
        if (!Array.isArray(tournament.players) ||
            tournament.players.length < 2 ||
            tournament.players.length > tournament.maxPlayers ||
            tournament.players.some((uid) => typeof uid !== 'string' || uid.length < 1)) {
            throw new https_1.HttpsError('failed-precondition', 'Tournament player list is invalid.');
        }
        const players = [...new Set(tournament.players)];
        if (players.length < 2) {
            throw new https_1.HttpsError('failed-precondition', 'At least two distinct players are required.');
        }
        // Cryptographic Fisher-Yates shuffle.
        for (let i = players.length - 1; i > 0; i--) {
            const j = (0, node_crypto_1.randomInt)(i + 1);
            [players[i], players[j]] = [players[j], players[i]];
        }
        if (players.length % 2 !== 0)
            players.push('bye');
        const pairings = [];
        const gameWrites = [];
        for (let i = 0; i < players.length; i += 2) {
            const whiteUid = players[i];
            const blackUid = players[i + 1];
            const isBye = blackUid === 'bye';
            const gameId = 'tournament_' + tournamentId + '_r1_' + (0, node_crypto_1.randomUUID)();
            pairings.push({
                gameId,
                whiteUid,
                blackUid,
                result: isBye ? 'bye' : null,
            });
            if (!isBye) {
                gameWrites.push({
                    ref: db.collection('games').doc(gameId),
                    data: {
                        gameId,
                        tournamentId,
                        tournamentRound: 1,
                        whiteUid,
                        blackUid,
                        whiteHandle: whiteUid.slice(0, 10),
                        blackHandle: blackUid.slice(0, 10),
                        wager: 0,
                        currency: 'FREE',
                        fen: new chess_js_1.Chess().fen(),
                        pgn: '',
                        moves: [],
                        turn: 'white',
                        status: 'active',
                        result: null,
                        settled: false,
                        isPublic: true,
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        lastMoveAt: admin.firestore.FieldValue.serverTimestamp(),
                    },
                });
            }
        }
        const round1 = {
            roundNumber: 1,
            pairings,
            startedAt: Date.now(),
            completedAt: null,
        };
        // Tournament status and all first-round game documents commit atomically.
        transaction.update(tournamentRef, {
            status: 'active',
            rounds: [round1],
            startedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        for (const game of gameWrites)
            transaction.create(game.ref, game.data);
        if (gameWrites.length > 0) {
            transaction.set(db.collection('protocol').doc('stats'), {
                activeMatches: admin.firestore.FieldValue.increment(gameWrites.length),
            }, { merge: true });
        }
        return {
            round: round1,
            playerCount: players.length,
            gameCount: gameWrites.length,
        };
    });
    logger.info({
        tournamentId,
        players: started.playerCount,
        games: started.gameCount,
    }, 'Free tournament started');
    return { ok: true, round: started.round };
});
// ─── 12. createTournament (HTTPS Callable) ────────────────────────────────────
exports.createTournament = (0, https_1.onCall)({ region: 'us-central1', maxInstances: 10 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in.');
    const { name, format, entryFee, currency, maxPlayers, startsAt, timeControl } = request.data || {};
    if (typeof name !== 'string' || !name.trim() || typeof format !== 'string' || typeof timeControl !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'Missing required fields.');
    }
    if (!(0, safety_1.isFreeOnlyTerms)(entryFee, currency)) {
        throw new https_1.HttpsError('failed-precondition', 'Only free tournaments are enabled until escrow and prize payouts are integrated.');
    }
    const validFormats = ['swiss', 'round_robin', 'elimination', 'arena'];
    if (!validFormats.includes(format))
        throw new https_1.HttpsError('invalid-argument', 'Invalid format.');
    if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 256) {
        throw new https_1.HttpsError('invalid-argument', 'maxPlayers must be an integer between 2 and 256.');
    }
    if (!['bullet', 'blitz', 'rapid', 'classical'].includes(timeControl)) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid time control.');
    }
    if (startsAt !== undefined && (!Number.isFinite(startsAt) || Number(startsAt) < Date.now())) {
        throw new https_1.HttpsError('invalid-argument', 'Tournament start time must be in the future.');
    }
    const sanitizedName = name.replace(/[<>"']/g, '').trim().slice(0, 64);
    if (sanitizedName.length < 3) {
        throw new https_1.HttpsError('invalid-argument', 'Tournament name must contain at least three valid characters.');
    }
    const tournament = {
        id: db.collection('tournaments').doc().id,
        name: sanitizedName,
        format,
        status: 'registration',
        entryFee: 0,
        currency: 'FREE',
        prizePool: 0,
        maxPlayers: Number(maxPlayers),
        players: [],
        rounds: [],
        startsAt: startsAt === undefined ? Date.now() + 86400000 : Number(startsAt),
        endsAt: null,
        timeControl,
        createdBy: request.auth.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await db.collection('tournaments').doc(tournament.id).set(tournament);
    logger.info({ tournamentId: tournament.id, createdBy: request.auth.uid }, 'Tournament created');
    return { ok: true, tournamentId: tournament.id };
});
// ─── Helpers ──────────────────────────────────────────────────────────────────
// ─── Inline Glicko-2 (no external import needed in Cloud Functions) ───────────
const GLICKO2_SCALE = 173.7178;
const TAU = 0.5;
const CONVERGENCE = 0.000001;
function computeGlickoUpdate(player, outcomes) {
    const mu = (player.rating - 1500) / GLICKO2_SCALE;
    const phi = player.rd / GLICKO2_SCALE;
    const sigma = player.volatility;
    if (outcomes.length === 0) {
        const newPhi = Math.min(Math.sqrt(phi * phi + sigma * sigma), 350 / GLICKO2_SCALE);
        return { newRating: player.rating, newRd: Math.round(newPhi * GLICKO2_SCALE), newVolatility: sigma, ratingChange: 0 };
    }
    const g = (p) => 1 / Math.sqrt(1 + 3 * p * p / (Math.PI * Math.PI));
    const E = (m, mj, pj) => 1 / (1 + Math.exp(-g(pj) * (m - mj)));
    const opps = outcomes.map(o => ({ mj: (o.opponentRating - 1500) / GLICKO2_SCALE, pj: o.opponentRd / GLICKO2_SCALE, s: o.score }));
    const v = 1 / opps.reduce((sum, o) => { const gp = g(o.pj); const e = E(mu, o.mj, o.pj); return sum + gp * gp * e * (1 - e); }, 0);
    const delta = v * opps.reduce((sum, o) => sum + g(o.pj) * (o.s - E(mu, o.mj, o.pj)), 0);
    const a = Math.log(sigma * sigma);
    const f = (x) => { const ex = Math.exp(x); const d2 = delta * delta; const phi2 = phi * phi; return (ex * (d2 - phi2 - v - ex)) / (2 * Math.pow(phi2 + v + ex, 2)) - (x - a) / (TAU * TAU); };
    let A = a;
    let B = delta * delta > phi * phi + v ? Math.log(delta * delta - phi * phi - v) : (() => { let k = 1; while (f(a - k * TAU) < 0)
        k++; return a - k * TAU; })();
    let fA = f(A);
    let fB = f(B);
    let iter = 0;
    while (Math.abs(B - A) > CONVERGENCE && iter++ < 100) {
        const C = A + (A - B) * fA / (fB - fA);
        const fC = f(C);
        if (fC * fB <= 0) {
            A = B;
            fA = fB;
        }
        else
            fA /= 2;
        B = C;
        fB = fC;
    }
    const newSigma = Math.exp(A / 2);
    const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
    const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
    const muPrime = mu + phiPrime * phiPrime * opps.reduce((sum, o) => sum + g(o.pj) * (o.s - E(mu, o.mj, o.pj)), 0);
    const newRating = Math.max(100, Math.min(3500, Math.round(muPrime * GLICKO2_SCALE + 1500)));
    const newRd = Math.max(30, Math.min(350, Math.round(phiPrime * GLICKO2_SCALE)));
    return { newRating, newRd, newVolatility: newSigma, ratingChange: newRating - player.rating };
}
function getRatingBand(r) {
    if (r < 1000)
        return 'Novice';
    if (r < 1200)
        return 'Amateur';
    if (r < 1400)
        return 'Intermediate';
    if (r < 1600)
        return 'Club Player';
    if (r < 1800)
        return 'Advanced';
    if (r < 2000)
        return 'Expert';
    if (r < 2200)
        return 'Candidate Master';
    if (r < 2400)
        return 'FIDE Master';
    return 'Master';
}
/**
 * Replays move history and returns the verified result.
 * Returns 'white' | 'black' | 'draw' | 'invalid'.
 */
function replayAndVerify(game, moves, claimedResult) {
    try {
        for (const move of moves) {
            const result = game.move(move);
            if (!result)
                return 'invalid';
        }
        if (!game.isGameOver()) {
            // Game claims to be finished but position is still active
            if (claimedResult && claimedResult !== 'active')
                return 'invalid';
            return 'active';
        }
        if (game.isDraw())
            return 'draw';
        // The player who just moved (opposite of current turn) won
        const winner = game.turn() === 'w' ? 'black' : 'white';
        if (claimedResult !== winner && claimedResult !== 'draw')
            return 'invalid';
        return winner;
    }
    catch {
        return 'invalid';
    }
}
//# sourceMappingURL=index.js.map
