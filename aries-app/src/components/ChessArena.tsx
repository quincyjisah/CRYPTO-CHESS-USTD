import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { ViewType } from '../App';
import { useAuth } from '../lib/AuthContext';
import { useMatchmaking } from '../lib/useMatchmaking';
import {
  sfxMove, sfxCapture, sfxCheck, sfxIllegal,
  sfxVictory, sfxDefeat, sfxCastle, sfxPromotion,
  playBgMusic, stopBgMusic, isMuted, setMuted,
  setVolume, getVolume, loadSavedPrefs
} from '../lib/audio';
import { rateLimits } from '../lib/security';
import { PLATFORMS, startScreenCapture } from '../lib/streaming';
import AdBanner from './AdBanner';
import {
  Camera, CameraOff, Volume2, VolumeX,
  MonitorPlay, Users, Shield, Info,
  Trophy, Bot, Loader2
} from 'lucide-react';

interface ChessArenaProps { onNavigate: (view: ViewType) => void; }

// ─── Game mode ────────────────────────────────────────────────────────────────
type GameMode = 'idle' | 'practice' | 'multiplayer';

export default function ChessArena({ onNavigate }: ChessArenaProps) {
  const { user, walletAddress, profile, loginWallet } = useAuth();

  // ─── Mode selection ────────────────────────────────────────────────────────
  const [gameMode,   setGameMode]   = useState<GameMode>('idle');

  // ─── Practice mode state (bot) ────────────────────────────────────────────
  const practiceRef  = useRef(new Chess());
  const [practiceFen, setPracticeFen] = useState(practiceRef.current.fen());
  const [practiceActive, setPracticeActive] = useState(false);
  const [practiceStatus, setPracticeStatus] = useState('Practice mode — free, no funds involved.');

  // ─── Multiplayer state (real backend) ─────────────────────────────────────
  const uid     = user?.uid || null;
  const handle  = profile?.handle || user?.displayName?.slice(0, 20) || walletAddress?.slice(0, 10) || 'Player';
  const { state: mpState, gameRef: mpGameRef, joinQueue, cancelQueue, submitMove, resign }
    = useMatchmaking(uid, handle, 0, 'FREE');

  // ─── A/V ──────────────────────────────────────────────────────────────────
  const [audioMuted, setAudioMuted] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);
  const [bgVolume,   setBgVolumeState] = useState(0.18);
  const [isIllegal,  setIsIllegal]   = useState(false);

  // ─── Streaming ────────────────────────────────────────────────────────────
  const [showStreamModal, setShowStreamModal] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [streamKey, setStreamKey] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [screenStream, setScreenStream] = useState<any>(null);

  // ─── Camera ───────────────────────────────────────────────────────────────
  const userVideoRef = useRef<HTMLVideoElement>(null);
  const cameraRef    = useRef<MediaStream | null>(null);

  useEffect(() => {
    loadSavedPrefs();
    setAudioMuted(isMuted());
    setBgVolumeState(getVolume());
  }, []);

  useEffect(() => {
    const isActive = practiceActive || mpState.phase === 'playing';
    if (!audioMuted) playBgMusic(isActive ? 'game' : 'lobby', bgVolume);
  }, [practiceActive, mpState.phase, audioMuted]);

  useEffect(() => {
    if (videoMuted) { cameraRef.current?.getTracks().forEach(t => t.stop()); return; }
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      .then(stream => { cameraRef.current = stream; if (userVideoRef.current) userVideoRef.current.srcObject = stream; })
      .catch(() => {});
    return () => { cameraRef.current?.getTracks().forEach(t => t.stop()); };
  }, [videoMuted]);

  // ─── Speak helper ─────────────────────────────────────────────────────────
  const speak = (text: string) => {
    if (audioMuted) return;
    const s = new SpeechSynthesisUtterance(text);
    s.rate = 0.9; s.pitch = 0.5; s.volume = 1;
    window.speechSynthesis.speak(s);
  };

  const triggerIllegal = () => {
    setIsIllegal(true);
    sfxIllegal();
    setTimeout(() => setIsIllegal(false), 300);
  };

  // ─── PRACTICE MODE bot move ───────────────────────────────────────────────
  const makeBotMove = useCallback(() => {
    const game = practiceRef.current;
    if (game.isGameOver()) return;
    const moves = game.moves();
    const move  = game.move(moves[Math.floor(Math.random() * moves.length)]);
    if (!move) return;
    setPracticeFen(game.fen());
    if (move.flags.includes('c')) sfxCapture();
    else if (move.flags.includes('k') || move.flags.includes('q')) sfxCastle();
    else sfxMove();
    if (game.isCheck()) sfxCheck();
    if (game.isGameOver()) {
      setPracticeStatus(game.isDraw() ? 'Draw!' : 'You lost! Practice more — no wager lost.');
      setPracticeActive(false);
      sfxDefeat();
    }
  }, []);

  // ─── PRACTICE MODE drop ───────────────────────────────────────────────────
  const onPracticeDrop = (from: string, to: string) => {
    if (!practiceActive) return false;
    const game = practiceRef.current;
    try {
      const move = game.move({ from: from as any, to: to as any, promotion: 'q' });
      if (!move) { triggerIllegal(); return false; }
      setPracticeFen(game.fen());
      if (move.flags.includes('c')) sfxCapture();
      else if (move.flags.includes('k') || move.flags.includes('q')) sfxCastle();
      else if (move.promotion) sfxPromotion();
      else sfxMove();
      if (game.isCheck()) sfxCheck();
      if (game.isGameOver()) {
        setPracticeStatus(game.isDraw() ? 'Draw!' : '✅ You won! Great practice.');
        setPracticeActive(false);
        sfxVictory();
      } else {
        setTimeout(makeBotMove, 500);
      }
      return true;
    } catch { triggerIllegal(); return false; }
  };

  // ─── MULTIPLAYER MODE drop — sends to WS server ───────────────────────────
  const onMultiplayerDrop = async (from: string, to: string) => {
    if (mpState.phase !== 'playing' || !mpState.myTurn) return false;
    const ok = await submitMove(from, to);
    if (!ok) { triggerIllegal(); return false; }

    // Optimistically update local board — server confirms via onSnapshot
    sfxMove();
    return true;
  };

  // ─── Start practice ───────────────────────────────────────────────────────
  const startPractice = () => {
    practiceRef.current = new Chess();
    setPracticeFen(practiceRef.current.fen());
    setPracticeActive(true);
    setPracticeStatus('Practice mode — play freely, no wager.');
    setGameMode('practice');
    playBgMusic('game', bgVolume);
    speak('Practice game started.');
  };

  // ─── Start multiplayer ────────────────────────────────────────────────────
  const startMultiplayer = async () => {
    if (!user?.uid) {
      loginWallet();
      return;
    }
    if (!rateLimits.wager(user.uid)) {
      alert('Too many attempts. Please wait a moment.');
      return;
    }
    setGameMode('multiplayer');
    await joinQueue();
    speak('Searching for a free-play opponent.');
  };

  // ─── Leave / resign ───────────────────────────────────────────────────────
  const handleLeave = async () => {
    if (gameMode === 'multiplayer') {
      if (mpState.phase === 'queuing') await cancelQueue();
      else if (mpState.phase === 'playing') await resign();
    }
    practiceRef.current = new Chess();
    setPracticeFen(practiceRef.current.fen());
    setPracticeActive(false);
    setGameMode('idle');
    stopBgMusic();
    playBgMusic('lobby', bgVolume);
  };

  // ─── Streaming ────────────────────────────────────────────────────────────
  const handleGoLive = async (platformId: string) => {
    if (!streamKey.trim()) { alert('Enter your stream key first.'); return; }
    const confirmed = window.confirm(
      '⚠️ SECURITY: Your stream key is private.\nAries Protocol never stores it.\nNEVER share it in chat.\n\nProceed to start screen capture?'
    );
    if (!confirmed) return;
    const capture = await startScreenCapture();
    if (!capture) return;
    setScreenStream(capture);
    const platform = PLATFORMS.find(p => p.id === platformId);
    if (platform) {
      alert(`✅ Screen capture active!\n\nIn OBS/Restream:\nServer: ${platform.rtmpBase}\nKey: ${streamKey.trim()}`);
    }
    setIsStreaming(true);
  };

  const handleStopStream = () => {
    screenStream?.stop();
    setScreenStream(null);
    setIsStreaming(false);
  };

  // ─── Derived values ───────────────────────────────────────────────────────
  const isInGame = gameMode === 'practice' ? practiceActive
                 : gameMode === 'multiplayer' ? (mpState.phase === 'playing' || mpState.phase === 'queuing')
                 : false;

  const currentFen = gameMode === 'practice'    ? practiceFen
                   : gameMode === 'multiplayer'  ? mpState.fen
                   : new Chess().fen();

  const myTurn = gameMode === 'practice'    ? true
               : gameMode === 'multiplayer' ? mpState.myTurn
               : false;

  const statusText = gameMode === 'idle'          ? 'Choose a mode to begin.'
                   : gameMode === 'practice'       ? practiceStatus
                   : mpState.statusText;

  const myHandle    = profile?.handle || handle;

  return (
    <section className="min-h-full flex flex-col items-center animate-in fade-in duration-300 pb-10">

      {/* Top bar */}
      <div className="w-full flex justify-between items-center mb-4 gap-2 flex-wrap">
        <button onClick={() => { handleLeave(); onNavigate('hub'); }}
          className="text-xs font-black uppercase text-zinc-500 hover:text-white tracking-[0.2em]">
          ← Lobby
        </button>

        <div className="flex items-center gap-2">
          <button onClick={() => setAudioMuted(m => { const n = !m; setMuted(n); if (n) stopBgMusic(); else playBgMusic(isInGame ? 'game' : 'lobby', bgVolume); return n; })}
            className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10">
            {audioMuted ? <VolumeX className="w-4 h-4 text-zinc-500" /> : <Volume2 className="w-4 h-4 text-white" />}
          </button>

          <button onClick={() => setVideoMuted(v => !v)}
            className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10">
            {videoMuted ? <CameraOff className="w-4 h-4 text-zinc-500" /> : <Camera className="w-4 h-4 text-white" />}
          </button>

          <button onClick={() => setShowStreamModal(true)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${isStreaming ? 'bg-red-600 text-white' : 'bg-red-600/20 border border-red-500/30 text-red-400'}`}>
            <MonitorPlay className="w-3 h-3" />
            {isStreaming ? '🔴 LIVE' : 'Go Live'}
          </button>
        </div>
      </div>

      {/* Stream modal */}
      {showStreamModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={() => setShowStreamModal(false)} />
          <div className="glass w-full max-w-md p-6 rounded-3xl relative z-10 border border-white/10 animate-in zoom-in-95">
            <button onClick={() => setShowStreamModal(false)} className="absolute top-4 right-4 text-zinc-500 hover:text-white">✕</button>
            <h3 className="text-lg font-black italic uppercase text-white mb-4">Broadcast Uplink</h3>

            <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex gap-2">
              <Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[8px] text-amber-300 font-mono">Your stream key is entered locally and NEVER sent to Aries servers. Never share it in chat.</p>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4">
              {PLATFORMS.map(p => (
                <button key={p.id} onClick={() => setSelectedPlatform(p.id)}
                  className={`flex items-center gap-2 p-3 rounded-xl border transition-all text-left ${selectedPlatform === p.id ? `${p.color} ${p.borderColor}` : 'bg-white/5 border-white/10'}`}>
                  <span className="text-base">{p.icon}</span>
                  <span className="text-[9px] font-black text-white uppercase">{p.name}</span>
                </button>
              ))}
            </div>

            {selectedPlatform && (
              <div className="space-y-3">
                <input type="password" value={streamKey} onChange={e => setStreamKey(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 text-white p-3 rounded-lg text-[11px] font-mono focus:outline-none focus:border-red-500"
                  placeholder="Paste your stream key here..." />
                <div className="flex gap-2">
                  {!isStreaming
                    ? <button onClick={() => { setShowStreamModal(false); handleGoLive(selectedPlatform!); }}
                        className="flex-1 bg-red-600 hover:bg-red-500 text-white font-black text-[10px] uppercase py-3 rounded-xl">
                        🔴 Start Screen Capture
                      </button>
                    : <button onClick={() => { handleStopStream(); setShowStreamModal(false); }}
                        className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white font-black text-[10px] uppercase py-3 rounded-xl">
                        ⏹ Stop Stream
                      </button>
                  }
                </div>
                <p className="text-[7px] text-zinc-600 font-mono text-center">
                  For all 6 platforms simultaneously: use restream.io with your key above.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main layout */}
      <div className="w-full max-w-6xl flex flex-col lg:flex-row gap-6 items-start justify-center">

        {/* Left panel */}
        <div className="glass p-6 rounded-3xl border border-blue-500/20 w-full lg:w-72 flex-shrink-0 space-y-4">
          <div className="text-center">
            <span className="text-3xl">♞</span>
            <h2 className="text-xl font-black italic mt-1">ARENA</h2>
            <p className="text-[9px] text-zinc-500 font-mono uppercase tracking-widest mt-1">{statusText}</p>
          </div>

          {/* Mode selection — idle */}
          {gameMode === 'idle' && (
            <div className="space-y-3">
              <div className="p-3 rounded-xl border border-blue-500/20 bg-blue-500/5 space-y-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-blue-300">Free-play multiplayer</p>
                <p className="text-[9px] text-zinc-400 font-mono">No real funds are wagered or transferred. On-chain wagering remains disabled until escrow integration is completed and independently reviewed.</p>
              </div>

              <button onClick={startMultiplayer}
                className="w-full bg-blue-600 hover:bg-blue-700 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2">
                <Trophy className="w-4 h-4" />
                {uid ? 'Find Free Opponent' : 'Sign in to Play'}
              </button>

              <button onClick={startPractice}
                className="w-full bg-white/5 hover:bg-white/10 border border-white/10 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2">
                <Bot className="w-4 h-4" />
                Practice vs Bot (Free)
              </button>
            </div>
          )}

          {/* Queuing */}
          {gameMode === 'multiplayer' && mpState.phase === 'queuing' && (
            <div className="space-y-3 text-center">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto" />
              <p className="text-[10px] text-zinc-400 font-mono">Searching for a free-play opponent...</p>
              <button onClick={cancelQueue}
                className="w-full bg-red-600/20 border border-red-500/30 text-red-400 py-2 rounded-xl text-[9px] font-black uppercase">
                Cancel Queue
              </button>
            </div>
          )}

          {/* Active multiplayer game */}
          {gameMode === 'multiplayer' && (mpState.phase === 'playing' || mpState.phase === 'finished') && (
            <div className="space-y-3">
              <div className="p-3 bg-black/40 rounded-xl border border-white/5">
                <p className="text-[8px] font-black uppercase text-blue-300">Free-play match · No financial stake</p>
                {mpState.color && (
                  <p className="text-[8px] font-mono text-zinc-500 mt-2">
                    You play <strong className="text-white">{mpState.color}</strong>
                    {mpState.myTurn ? ' · Your turn' : ` · Waiting for ${mpState.opponentHandle}`}
                  </p>
                )}
              </div>

              {mpState.phase === 'playing' && (
                <button onClick={resign}
                  className="w-full bg-red-600 hover:bg-red-700 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all">
                  Resign & Forfeit
                </button>
              )}

              {mpState.phase === 'finished' && (
                <button onClick={handleLeave}
                  className="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all">
                  Return to Lobby
                </button>
              )}

              {/* Volume slider */}
              <div className="flex items-center gap-2">
                <VolumeX className="w-3 h-3 text-zinc-500 shrink-0" />
                <input type="range" min="0" max="1" step="0.05" value={bgVolume}
                  onChange={e => { const v = parseFloat(e.target.value); setBgVolumeState(v); setVolume(v); }}
                  className="flex-1 accent-red-500" />
                <Volume2 className="w-3 h-3 text-zinc-400 shrink-0" />
              </div>
            </div>
          )}

          {/* Active practice */}
          {gameMode === 'practice' && (
            <div className="space-y-3">
              <div className="p-3 bg-white/5 border border-white/5 rounded-xl text-center">
                <p className="text-[8px] text-zinc-500 font-mono uppercase">Practice Mode</p>
                <p className="text-[10px] text-white font-mono mt-1">No wager · No fee · Random bot</p>
              </div>
              <button onClick={handleLeave}
                className="w-full bg-white/10 hover:bg-white/20 border border-white/10 py-2 rounded-xl text-[9px] font-black uppercase">
                End Practice
              </button>
            </div>
          )}

          {gameMode === 'multiplayer' && mpState.phase === 'playing' && (
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-zinc-300">Player tips paused</p>
              <p className="mt-1 text-[8px] font-mono text-zinc-500">Tips reopen only after a verified on-chain transfer flow is deployed.</p>
            </div>
          )}

          <AdBanner format="square" />
        </div>

        {/* Board + cameras */}
        <div className="flex-1 flex flex-col items-center gap-3">

          {/* Opponent camera */}
          <div className="w-full flex justify-between items-end gap-3">
            <div className="w-24 h-24 bg-zinc-900 rounded-xl border border-red-500/40 flex items-center justify-center overflow-hidden relative">
              <div className="absolute top-1 left-1 bg-black/70 px-1.5 py-0.5 rounded text-[6px] font-black uppercase text-red-400 backdrop-blur">
                {gameMode === 'multiplayer' ? (mpState.opponentHandle || 'Opponent') : 'BOT'}
              </div>
              {isInGame
                ? <div className="w-full h-full flex items-center justify-center bg-black animate-pulse"><span className="text-3xl opacity-20">♔</span></div>
                : <span className="text-[8px] text-red-900/50 uppercase font-black">AWAIT</span>
              }
            </div>

            {/* Move count / status */}
            <div className="flex-1 text-center">
              {gameMode === 'multiplayer' && mpState.phase === 'playing' && (
                <div className="flex items-center justify-center gap-3 text-[8px] font-mono text-zinc-500">
                  <span>Move {mpState.moveCount}</span>
                  <span>·</span>
                  <span className={mpState.myTurn ? 'text-green-400 font-black' : 'text-zinc-500'}>
                    {mpState.myTurn ? '● Your turn' : '○ Waiting'}
                  </span>
                </div>
              )}
            </div>

            {/* Player camera */}
            <div className="w-24 h-24 bg-zinc-900 rounded-xl border border-white/20 overflow-hidden relative">
              <div className="absolute top-1 left-1 bg-black/70 px-1.5 py-0.5 rounded text-[6px] font-black uppercase text-emerald-400 z-10 backdrop-blur flex items-center gap-1">
                <div className="w-1 h-1 rounded-full bg-emerald-500" /> YOU
              </div>
              {!videoMuted
                ? <video ref={userVideoRef} autoPlay playsInline muted className="w-full h-full object-cover -scale-x-100" />
                : <div className="w-full h-full flex items-center justify-center bg-zinc-800">
                    {profile?.avatar ? <img src={profile.avatar} alt="You" className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <span className="text-2xl text-zinc-600">♖</span>}
                  </div>
              }
            </div>
          </div>

          {/* Board */}
          <div className="w-full max-w-[450px] relative">
            {isIllegal && (
              <div className="absolute inset-0 bg-red-600/40 z-20 pointer-events-none rounded-xl border-2 border-red-500 animate-in fade-in duration-75" />
            )}
            <div className="glass-glow p-1.5 rounded-xl border border-zinc-800">
              <Chessboard
                {...({
                  position:           currentFen,
                  onPieceDrop:        gameMode === 'practice' ? onPracticeDrop : onMultiplayerDrop,
                  boardOrientation:   gameMode === 'multiplayer' && mpState.color === 'black' ? 'black' : 'white',
                  customDarkSquareStyle:  { backgroundColor: '#ff1f1f', opacity: 0.85 },
                  customLightSquareStyle: { backgroundColor: '#ececec' },
                  arePiecesDraggable: isInGame && myTurn,
                  customDropSquareStyle: { boxShadow: 'inset 0 0 1px 4px rgba(255,255,255,0.5)' },
                } as any)}
              />
            </div>
          </div>

          {/* Live indicator */}
          {isStreaming && (
            <div className="w-full max-w-[450px] flex items-center gap-2 px-3 py-2 bg-red-600/10 border border-red-500/30 rounded-lg">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[9px] font-black text-red-400 uppercase tracking-widest">LIVE</span>
              <button onClick={handleStopStream} className="ml-auto text-[8px] text-zinc-500 hover:text-white">Stop</button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
