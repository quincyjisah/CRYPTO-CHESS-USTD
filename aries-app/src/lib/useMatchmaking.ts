/**
 * useMatchmaking.ts — Aries Protocol Real Multiplayer (1M-user scale)
 *
 * Architecture:
 *  - Client NEVER writes game state directly. All moves go through the
 *    Cloud Function `validateMove` (HTTPS callable). The server validates,
 *    applies, and persists. Client just listens via onSnapshot.
 *  - Matchmaking is also server-driven: client writes queue entry,
 *    Cloud Function `matchmakingPair` does the pairing atomically.
 *  - Settlement is 100% server-side via `settleGame` Firestore trigger.
 *  - Client is read-only for game state. Write-only for queue entries.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { db } from './firebase';
import {
  collection, doc, setDoc, getDoc, deleteDoc,
  onSnapshot, serverTimestamp, query, where, orderBy, limit
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Chess } from 'chess.js';
import { isLegalChessMove } from './security';
import { calcSettlement, calcDrawSettlement } from './protocol';

export type GamePhase = 'idle' | 'queuing' | 'matched' | 'playing' | 'finished';
export type PlayerColor = 'white' | 'black';

export interface GameState {
  gameId: string;
  phase: GamePhase;
  color: PlayerColor | null;
  opponentId: string | null;
  opponentHandle: string | null;
  fen: string;
  pgn: string;
  wager: number;
  currency: string;
  result: 'win' | 'loss' | 'draw' | null;
  statusText: string;
  myTurn: boolean;
  moveCount: number;
  pot: number;
  fee: number;
  winnerPayout: number;
}

const QUEUE_TIMEOUT_MS = 30_000;

// ─── Cloud Function caller ────────────────────────────────────────────────────
const functions = getFunctions(undefined, 'us-central1');
const validateMoveFn = httpsCallable(functions, 'validateMove');
const resignGameFn = httpsCallable(functions, 'resignGame');

export function useMatchmaking(
  uid: string | null,
  handle: string,
  wager: number,
  currency: string
) {
  const settlement = calcSettlement(wager);

  const [state, setState] = useState<GameState>({
    gameId: '', phase: 'idle', color: null,
    opponentId: null, opponentHandle: null,
    fen: new Chess().fen(), pgn: '',
    wager, currency, result: null,
    statusText: 'Ready to play.',
    myTurn: false, moveCount: 0,
    pot: settlement.pot,
    fee: settlement.fee,
    winnerPayout: settlement.winnerPayout,
  });

  const gameRef      = useRef(new Chess());
  const unsubRef     = useRef<(() => void) | null>(null);
  const queueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moveTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Join Queue ─────────────────────────────────────────────────────────────
  const joinQueue = useCallback(async () => {
    if (!uid) return;
    setState(s => ({ ...s, phase: 'queuing', statusText: 'Finding opponent...' }));

    // Write queue entry — Cloud Function matchmakingPair handles pairing
    const myRef = doc(db, 'matchmaking', uid);
    await setDoc(myRef, {
      uid, handle, wager, currency,
      joinedAt: serverTimestamp(),
      status: 'waiting'
    });

    queueTimerRef.current = setTimeout(() => cancelQueue(), QUEUE_TIMEOUT_MS);

    // Listen for the Cloud Function to set status: 'matched' + gameId
    const unsub = onSnapshot(myRef, async (snap) => {
      const data = snap.data();
      if (data?.status === 'matched' && data?.gameId) {
        unsub();
        if (queueTimerRef.current) clearTimeout(queueTimerRef.current);
        await joinGame(data.gameId);
      }
    });
    unsubRef.current = unsub;
  }, [uid, handle, wager, currency]);

  // ─── Join an existing game ───────────────────────────────────────────────────
  const joinGame = async (gameId: string) => {
    const snap = await getDoc(doc(db, 'games', gameId));
    if (!snap.exists()) return;

    const data = snap.data();
    const color: PlayerColor = data.blackUid === uid ? 'black' : 'white';
    const opponentId          = color === 'black' ? data.whiteUid : data.blackUid;
    const opponentHandle      = color === 'black' ? data.whiteHandle : data.blackHandle;
    const s                   = calcSettlement(data.wager);

    gameRef.current = new Chess(data.fen);

    setState(prev => ({
      ...prev, phase: 'playing', gameId, color,
      opponentId, opponentHandle,
      fen: data.fen, wager: data.wager, currency: data.currency,
      pot: s.pot, fee: s.fee, winnerPayout: s.winnerPayout,
      myTurn: data.turn === color,
      moveCount: (data.moves || []).length,
      statusText: `Playing as ${color} vs ${opponentHandle}`
    }));

    subscribeToGame(gameId, color, opponentHandle);
  };

  // ─── Subscribe to game — read-only real-time listener ──────────────────────
  const subscribeToGame = (
    gameId: string,
    color: PlayerColor,
    opponentHandle: string
  ) => {
    const gameDocRef = doc(db, 'games', gameId);

    const unsub = onSnapshot(gameDocRef, (snap) => {
      if (!snap.exists()) return;
      const data   = snap.data();
      const myTurn = data.turn === color;
      const phase: GamePhase = data.status === 'active' ? 'playing' : 'finished';

      // Sync local engine to server FEN (server is authoritative)
      if (data.fen && data.fen !== gameRef.current.fen()) {
        gameRef.current = new Chess(data.fen);
      }

      let result: 'win' | 'loss' | 'draw' | null = null;
      let statusText = myTurn ? 'Your turn.' : `Waiting for ${opponentHandle}...`;

      if (data.status === 'finished') {
        if (data.result === 'draw')  { result = 'draw'; statusText = 'Draw — full wager refunded.'; }
        else if (data.result === color) { result = 'win';  statusText = 'You won!'; }
        else                            { result = 'loss'; statusText = 'You lost.'; }
      }

      const s = calcSettlement(data.wager || wager);
      setState(prev => ({
        ...prev, phase, fen: data.fen, pgn: data.pgn || '',
        myTurn, result, statusText,
        moveCount: (data.moves || []).length,
        pot: s.pot, fee: s.fee, winnerPayout: s.winnerPayout,
      }));

      // Move timeout: if it's my turn and I haven't moved in 55s, warn
      if (myTurn && data.status === 'active') {
        if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
        moveTimerRef.current = setTimeout(() => {
          setState(prev => ({ ...prev, statusText: '⚠️ Move soon — 5 seconds before forfeit!' }));
        }, 55_000);
      } else {
        if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
      }
    });

    unsubRef.current = unsub;
  };

  // ─── Submit move — goes to Cloud Function, not Firestore directly ───────────
  const submitMove = useCallback(async (from: string, to: string): Promise<boolean> => {
    if (!uid || !state.gameId || !state.myTurn) return false;

    // Client-side legality pre-check (UX only — server re-validates)
    if (!isLegalChessMove(gameRef.current, from, to)) return false;

    try {
      const res: any = await validateMoveFn({
        gameId: state.gameId,
        from, to, promotion: 'q'
      });

      // Server applied the move — local engine syncs via onSnapshot
      return res?.data?.fen !== undefined;
    } catch (err: any) {
      console.error('[Matchmaking] validateMove failed:', err?.message);
      return false;
    }
  }, [uid, state.gameId, state.myTurn]);

  // ─── Cancel Queue ────────────────────────────────────────────────────────────
  const cancelQueue = useCallback(async () => {
    if (!uid) return;
    if (queueTimerRef.current) clearTimeout(queueTimerRef.current);
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
    try { await deleteDoc(doc(db, 'matchmaking', uid)); } catch {}
    setState(s => ({ ...s, phase: 'idle', statusText: 'Queue cancelled.' }));
  }, [uid]);

  // ─── Resign ──────────────────────────────────────────────────────────────────
  const resign = useCallback(async () => {
    if (!state.gameId || !uid || state.phase !== 'playing') return;
    try {
      await resignGameFn({ gameId: state.gameId });
    } catch (err) {
      console.error('[Matchmaking] Resignation failed:', err);
    }
  }, [state.gameId, state.phase, uid]);

  // ─── Cleanup ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (unsubRef.current)    unsubRef.current();
      if (queueTimerRef.current) clearTimeout(queueTimerRef.current);
      if (moveTimerRef.current)  clearTimeout(moveTimerRef.current);
    };
  }, []);

  return { state, gameRef, joinQueue, cancelQueue, submitMove, resign };
}
