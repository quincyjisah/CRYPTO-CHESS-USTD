import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { db } from '../lib/firebase';
import { doc, getDoc, collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { ratingBand, ratingColor } from '../lib/rating';
import {
  Play, Pause, SkipBack, SkipForward, ChevronLeft, ChevronRight,
  Download, Trophy, TrendingUp, TrendingDown, Minus, Loader2
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface MoveAnnotation {
  cpLoss:         number;
  classification: 'brilliant' | 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';
  accuracy:       number;
  engineBestMove: string;
  engineScore:    number;
}

interface ReplayData {
  gameId:      string;
  pgn:         string;
  moves:       { san: string; fen: string; thinkMs: number; timestamp: number }[];
  whiteHandle: string;
  blackHandle: string;
  wager:       number;
  currency:    string;
  result:      string;
  endReason:   string;
  accuracy:    { white: number; black: number };
  blunders:    { white: number; black: number };
  playedAt:    number;
  durationMs:  number;
}

interface ReplayViewerProps {
  gameId?:    string;       // Specific game to load
  playerId?:  string;       // Load player's recent games
  onClose?:   () => void;
}

// ─── Classification colours ───────────────────────────────────────────────────
const CLASS_COLORS: Record<string, string> = {
  brilliant:  'text-cyan-400   bg-cyan-400/10   border-cyan-400/30',
  best:       'text-green-400  bg-green-400/10  border-green-400/30',
  excellent:  'text-blue-400   bg-blue-400/10   border-blue-400/30',
  good:       'text-teal-400   bg-teal-400/10   border-teal-400/30',
  inaccuracy: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
  mistake:    'text-orange-400 bg-orange-400/10 border-orange-400/30',
  blunder:    'text-red-500    bg-red-500/10    border-red-500/30',
};

const CLASS_SYMBOL: Record<string, string> = {
  brilliant: '!!', best: '!', excellent: '!?', good: '',
  inaccuracy: '?!', mistake: '?', blunder: '??',
};

export default function ReplayViewer({ gameId, playerId, onClose }: ReplayViewerProps) {
  const [replay,      setReplay]      = useState<ReplayData | null>(null);
  const [gameList,    setGameList]    = useState<ReplayData[]>([]);
  const [selectedId,  setSelectedId]  = useState<string | null>(gameId || null);
  const [annotations, setAnnotations] = useState<Map<number, MoveAnnotation>>(new Map());
  const [cursor,      setCursor]      = useState(0);    // Current move index (0 = start)
  const [isPlaying,   setIsPlaying]   = useState(false);
  const [speed,       setSpeed]       = useState(800);  // ms per move in auto-play
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chess       = useRef(new Chess());

  // ─── Load game list for a player ──────────────────────────────────────────
  useEffect(() => {
    if (!playerId) return;
    const load = async () => {
      setLoading(true);
      try {
        const q = query(
          collection(db, 'transactions'),
          where('userId', '==', playerId),
          where('type', '==', 'Match'),
          orderBy('createdAt', 'desc'),
          limit(20)
        );
        const snap = await getDocs(q);
        const gameIds = [...new Set(snap.docs.map(d => d.data().gameId).filter(Boolean))];

        const replays = await Promise.all(
          gameIds.map(async (id) => {
            const raw = await getDoc(doc(db, 'cache', `replay_${id}`));
            return raw.exists() ? (raw.data() as ReplayData) : null;
          })
        );
        setGameList(replays.filter(Boolean) as ReplayData[]);
      } catch (e) {
        setError('Could not load game history.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [playerId]);

  // ─── Load specific replay ──────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedId) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      setCursor(0);
      setIsPlaying(false);
      try {
        // Try Firebase cache first, then direct game doc
        const cacheSnap = await getDoc(doc(db, 'cache', `replay_${selectedId}`));
        if (cacheSnap.exists()) {
          setReplay(cacheSnap.data() as ReplayData);
        } else {
          const gameSnap = await getDoc(doc(db, 'games', selectedId));
          if (gameSnap.exists()) {
            const data     = gameSnap.data();
            const replayData: ReplayData = {
              gameId:      selectedId,
              pgn:         data.pgn || '',
              moves:       data.moves || [],
              whiteHandle: data.whiteHandle || 'White',
              blackHandle: data.blackHandle || 'Black',
              wager:       data.wager || 0,
              currency:    data.currency || 'USDT',
              result:      data.result || '?',
              endReason:   data.endReason || '',
              accuracy:    { white: 0, black: 0 },
              blunders:    { white: 0, black: 0 },
              playedAt:    data.createdAt?.toMillis() || 0,
              durationMs:  0,
            };
            setReplay(replayData);
          } else {
            setError('Game not found.');
          }
        }

        // Load move annotations from Redis-backed cache
        const annSnap = await getDoc(doc(db, 'cache', `annotations_${selectedId}`));
        if (annSnap.exists()) {
          const annMap = new Map<number, MoveAnnotation>();
          const data   = annSnap.data();
          Object.entries(data).forEach(([moveNum, ann]) => {
            annMap.set(parseInt(moveNum, 10), ann as MoveAnnotation);
          });
          setAnnotations(annMap);
        }
      } catch (e) {
        setError('Failed to load replay.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [selectedId]);

  // ─── Rebuild board position from cursor ───────────────────────────────────
  const getFenAtCursor = useCallback((idx: number): string => {
    if (!replay) return new Chess().fen();
    if (idx === 0) return new Chess().fen();
    return replay.moves[idx - 1]?.fen || new Chess().fen();
  }, [replay]);

  const currentFen = getFenAtCursor(cursor);

  // ─── Auto-play ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying || !replay) return;

    intervalRef.current = setInterval(() => {
      setCursor(c => {
        if (c >= replay.moves.length) {
          setIsPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, speed);

    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isPlaying, speed, replay]);

  // ─── Controls ─────────────────────────────────────────────────────────────
  const goTo      = (idx: number) => { setIsPlaying(false); setCursor(Math.max(0, Math.min(idx, replay?.moves.length || 0))); };
  const goFirst   = () => goTo(0);
  const goLast    = () => goTo(replay?.moves.length || 0);
  const stepBack  = () => goTo(cursor - 1);
  const stepFwd   = () => goTo(cursor + 1);
  const togglePlay = () => setIsPlaying(p => !p);

  // ─── PGN Download ─────────────────────────────────────────────────────────
  const downloadPGN = () => {
    if (!replay) return;
    const date    = new Date(replay.playedAt).toISOString().split('T')[0].replace(/-/g, '.');
    const headers = [
      `[Event "Aries Protocol Wager Match"]`,
      `[Site "ariesprotocol.app"]`,
      `[Date "${date}"]`,
      `[White "${replay.whiteHandle}"]`,
      `[Black "${replay.blackHandle}"]`,
      `[Result "${replay.result === 'white' ? '1-0' : replay.result === 'black' ? '0-1' : '1/2-1/2'}"]`,
      `[WhiteAccuracy "${replay.accuracy.white.toFixed(1)}"]`,
      `[BlackAccuracy "${replay.accuracy.black.toFixed(1)}"]`,
      `[Wager "${replay.wager} ${replay.currency}"]`,
      '',
      replay.pgn,
    ].join('\n');

    const blob = new Blob([headers], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `aries-${replay.gameId.slice(0, 8)}.pgn`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Current move annotation ───────────────────────────────────────────────
  const currentAnnotation = cursor > 0 ? annotations.get(cursor) : undefined;

  // ─── Result display ────────────────────────────────────────────────────────
  const resultText = replay
    ? replay.result === 'white' ? `${replay.whiteHandle} wins`
    : replay.result === 'black' ? `${replay.blackHandle} wins`
    : 'Draw'
    : '';

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Loading replay...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-red-400 text-sm font-mono">{error}</p>
        {onClose && <button onClick={onClose} className="text-[9px] text-zinc-500 uppercase tracking-widest hover:text-white">← Close</button>}
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl mx-auto animate-in fade-in duration-300">

      {/* Game selector (when showing player history) */}
      {gameList.length > 0 && !gameId && (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
          {gameList.map((g) => (
            <button key={g.gameId} onClick={() => setSelectedId(g.gameId)}
              className={`flex-shrink-0 px-3 py-2 rounded-lg border text-[9px] font-mono transition-all ${selectedId === g.gameId ? 'bg-blue-600/20 border-blue-500/40 text-blue-400' : 'bg-white/5 border-white/10 text-zinc-400 hover:border-white/20'}`}>
              {g.whiteHandle} vs {g.blackHandle}
              <span className={`ml-2 ${g.result === 'white' ? 'text-green-400' : g.result === 'black' ? 'text-red-400' : 'text-zinc-500'}`}>
                {g.result === 'white' ? '1-0' : g.result === 'black' ? '0-1' : '½-½'}
              </span>
            </button>
          ))}
        </div>
      )}

      {replay && (
        <div className="flex flex-col lg:flex-row gap-6">

          {/* Board */}
          <div className="flex-1">
            {/* Player headers */}
            <div className="flex justify-between items-center mb-2 px-1">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-zinc-800 border border-white/20 flex items-center justify-center text-[8px]">♚</div>
                <div>
                  <p className="text-[10px] font-black text-white">{replay.blackHandle}</p>
                  <p className="text-[8px] text-zinc-500 font-mono">Acc: {replay.accuracy.black.toFixed(1)}%</p>
                </div>
              </div>
              {replay.blunders.black > 0 && (
                <span className="text-[8px] text-red-400 font-mono">{replay.blunders.black} blunder{replay.blunders.black !== 1 ? 's' : ''}</span>
              )}
            </div>

            {/* Board */}
            <div className="glass-glow p-1 rounded-xl border border-zinc-800 relative">
              {/* Move annotation overlay */}
              {currentAnnotation && (
                <div className={`absolute top-2 right-2 z-10 px-2 py-1 rounded border text-[9px] font-black ${CLASS_COLORS[currentAnnotation.classification]}`}>
                  {CLASS_SYMBOL[currentAnnotation.classification]} {currentAnnotation.classification}
                  <span className="ml-1 opacity-70">({currentAnnotation.accuracy.toFixed(0)}%)</span>
                </div>
              )}
              <Chessboard
                {...({
                  position:           currentFen,
                  boardOrientation:   'white',
                  customDarkSquareStyle:  { backgroundColor: '#ff1f1f', opacity: 0.85 },
                  customLightSquareStyle: { backgroundColor: '#ececec' },
                  arePiecesDraggable: false,
                } as any)}
              />
            </div>

            <div className="flex justify-between items-center mt-2 px-1">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-white border border-white/20 flex items-center justify-center text-[8px] text-black">♔</div>
                <div>
                  <p className="text-[10px] font-black text-white">{replay.whiteHandle}</p>
                  <p className="text-[8px] text-zinc-500 font-mono">Acc: {replay.accuracy.white.toFixed(1)}%</p>
                </div>
              </div>
              {replay.blunders.white > 0 && (
                <span className="text-[8px] text-red-400 font-mono">{replay.blunders.white} blunder{replay.blunders.white !== 1 ? 's' : ''}</span>
              )}
            </div>

            {/* Controls */}
            <div className="flex items-center justify-center gap-2 mt-4">
              <button onClick={goFirst}   className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"><SkipBack    className="w-4 h-4 text-zinc-400" /></button>
              <button onClick={stepBack}  className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"><ChevronLeft  className="w-4 h-4 text-zinc-400" /></button>
              <button onClick={togglePlay} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
                {isPlaying ? <Pause className="w-4 h-4 text-white" /> : <Play className="w-4 h-4 text-white" />}
              </button>
              <button onClick={stepFwd}   className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"><ChevronRight className="w-4 h-4 text-zinc-400" /></button>
              <button onClick={goLast}    className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"><SkipForward  className="w-4 h-4 text-zinc-400" /></button>

              {/* Speed selector */}
              <select value={speed} onChange={e => setSpeed(Number(e.target.value))}
                className="bg-black/50 border border-white/10 text-zinc-400 text-[9px] font-mono p-2 rounded-lg focus:outline-none">
                <option value={2000}>0.5×</option>
                <option value={800}>1×</option>
                <option value={400}>2×</option>
                <option value={150}>5×</option>
              </select>

              <button onClick={downloadPGN}
                className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors" title="Download PGN">
                <Download className="w-4 h-4 text-zinc-400" />
              </button>
            </div>

            {/* Progress bar */}
            <div className="mt-3 bg-zinc-900 rounded-full h-1.5 overflow-hidden">
              <div className="bg-blue-600 h-full transition-all duration-300"
                style={{ width: `${replay.moves.length > 0 ? (cursor / replay.moves.length) * 100 : 0}%` }} />
            </div>
            <p className="text-[8px] text-zinc-600 font-mono text-center mt-1">
              Move {cursor} of {replay.moves.length}
            </p>
          </div>

          {/* Right panel: move list + stats */}
          <div className="w-full lg:w-64 space-y-4">

            {/* Game result card */}
            <div className="glass p-4 rounded-2xl border border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <Trophy className="w-4 h-4 text-yellow-400" />
                <span className="text-[10px] font-black text-white uppercase">{resultText}</span>
              </div>
              <p className="text-[8px] text-zinc-500 font-mono capitalize">{replay.endReason?.replace(/_/g, ' ')}</p>
              {replay.wager > 0 && (
                <p className="text-[8px] text-green-400 font-mono mt-1">
                  Pot: {(replay.wager * 2).toFixed(2)} {replay.currency}
                </p>
              )}
              <p className="text-[7px] text-zinc-600 font-mono mt-1">
                {new Date(replay.playedAt).toLocaleString()}
              </p>
            </div>

            {/* Move list */}
            <div className="glass rounded-2xl border border-white/10 overflow-hidden">
              <div className="p-3 border-b border-white/5">
                <p className="text-[9px] font-black text-zinc-400 uppercase">Moves</p>
              </div>
              <div className="max-h-72 overflow-y-auto custom-scrollbar p-2 space-y-0.5">
                {Array.from({ length: Math.ceil(replay.moves.length / 2) }, (_, i) => {
                  const wIdx = i * 2;     // White move index
                  const bIdx = i * 2 + 1; // Black move index
                  const wMove = replay.moves[wIdx];
                  const bMove = replay.moves[bIdx];
                  const wAnn  = annotations.get(wIdx + 1);
                  const bAnn  = annotations.get(bIdx + 1);

                  return (
                    <div key={i} className="flex items-center gap-1">
                      <span className="text-[8px] text-zinc-600 font-mono w-6 text-right shrink-0">{i + 1}.</span>

                      <button onClick={() => goTo(wIdx + 1)}
                        className={`flex-1 text-left px-1.5 py-0.5 rounded text-[9px] font-mono transition-colors ${cursor === wIdx + 1 ? 'bg-blue-600/30 text-white' : 'text-zinc-300 hover:bg-white/5'}`}>
                        {wMove?.san}
                        {wAnn && CLASS_SYMBOL[wAnn.classification] && (
                          <span className={`ml-0.5 text-[8px] ${CLASS_COLORS[wAnn.classification].split(' ')[0]}`}>
                            {CLASS_SYMBOL[wAnn.classification]}
                          </span>
                        )}
                      </button>

                      {bMove && (
                        <button onClick={() => goTo(bIdx + 1)}
                          className={`flex-1 text-left px-1.5 py-0.5 rounded text-[9px] font-mono transition-colors ${cursor === bIdx + 1 ? 'bg-blue-600/30 text-white' : 'text-zinc-300 hover:bg-white/5'}`}>
                          {bMove.san}
                          {bAnn && CLASS_SYMBOL[bAnn.classification] && (
                            <span className={`ml-0.5 text-[8px] ${CLASS_COLORS[bAnn.classification].split(' ')[0]}`}>
                              {CLASS_SYMBOL[bAnn.classification]}
                            </span>
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Accuracy bars */}
            {(replay.accuracy.white > 0 || replay.accuracy.black > 0) && (
              <div className="glass p-4 rounded-2xl border border-white/10 space-y-3">
                <p className="text-[9px] font-black text-zinc-400 uppercase">Accuracy</p>
                {[
                  { label: replay.whiteHandle, value: replay.accuracy.white, color: 'bg-white' },
                  { label: replay.blackHandle, value: replay.accuracy.black, color: 'bg-zinc-400' },
                ].map(p => (
                  <div key={p.label}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[8px] text-zinc-400 font-mono truncate">{p.label}</span>
                      <span className="text-[9px] font-black text-white">{p.value.toFixed(1)}%</span>
                    </div>
                    <div className="bg-zinc-900 rounded-full h-1.5 overflow-hidden">
                      <div className={`${p.color} h-full rounded-full transition-all duration-500`}
                        style={{ width: `${p.value}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Current move analysis */}
            {currentAnnotation && (
              <div className={`p-4 rounded-2xl border ${CLASS_COLORS[currentAnnotation.classification]}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-base">{CLASS_SYMBOL[currentAnnotation.classification] || '·'}</span>
                  <span className="text-[10px] font-black capitalize">{currentAnnotation.classification}</span>
                </div>
                <div className="space-y-1 text-[8px] font-mono">
                  <div className="flex justify-between"><span className="text-zinc-500">Centipawn loss</span><span>{currentAnnotation.cpLoss.toFixed(0)}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Move accuracy</span><span>{currentAnnotation.accuracy.toFixed(1)}%</span></div>
                  {currentAnnotation.engineBestMove && (
                    <div className="flex justify-between"><span className="text-zinc-500">Engine best</span><span>{currentAnnotation.engineBestMove}</span></div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!replay && !loading && (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <p className="text-zinc-500 text-sm font-mono">Select a game to replay.</p>
        </div>
      )}
    </div>
  );
}
