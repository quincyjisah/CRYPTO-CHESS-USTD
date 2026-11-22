import React, { useState, useEffect, useRef } from 'react';
import { ViewType } from '../App';
import Chatroom from './Chatroom';
import Leaderboard from './Leaderboard';
import { useAuth } from '../lib/AuthContext';
import { useProtocolStats } from '../hooks/useProtocolStats';
import { Music, Music2, User as UserIcon, Settings2, Camera, CameraOff, Trophy, History } from 'lucide-react';
import { db } from '../lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import AdBanner from './AdBanner';

const CHESS_AVATARS = [
  { id: 'a1', name: 'Grandmaster King', url: 'https://picsum.photos/seed/chess-king-v1/200' },
  { id: 'a2', name: 'Elite Queen', url: 'https://picsum.photos/seed/chess-queen-v1/200' },
  { id: 'a3', name: 'Shadow Bishop', url: 'https://picsum.photos/seed/chess-bishop-v1/200' },
  { id: 'a4', name: 'Rapid Knight', url: 'https://picsum.photos/seed/chess-knight-v1/200' },
  { id: 'a5', name: 'Ares Vanguard', url: 'https://picsum.photos/seed/chess-pawn-v1/200' },
];

interface HubProps {
  onNavigate: (view: ViewType) => void;
}

export default function Hub({ onNavigate }: HubProps) {
  const { user, walletAddress, walletBalance, profile, loginGoogle, dbRestricted, updateProfile } = useAuth();
  const protocolStats = useProtocolStats();
  const [rightPanel, setRightPanel] = useState<'chat' | 'leaderboard'>('chat');
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  const handleAvatarChange = async (url: string) => {
      await updateProfile({ avatar: url });
      setShowAvatarPicker(false);
  };

  const handleLiveStream = () => {
    alert("Broadcasting your matching directly to Social Media. Getting link...");
  };

  return (
    <section id="view-hub" className="flex flex-col animate-in fade-in duration-300 pb-24">
        {dbRestricted && !user && (
          <div className="mb-4 p-3 bg-red-600/10 border border-red-500/30 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-red-600 animate-pulse"></div>
              <p className="text-[10px] text-red-500 font-black uppercase tracking-widest italic">Database Sync Restricted</p>
              <p className="text-[8px] text-zinc-400 font-mono uppercase">Anonymous Auth is disabled. Persistence requires Google Login.</p>
            </div>
            <button
              onClick={loginGoogle}
              className="px-3 py-1 bg-white text-black text-[9px] font-black uppercase rounded hover:bg-zinc-200 transition-colors"
            >
              Sign In with Google
            </button>
          </div>
        )}

        <div className="mb-4 flex items-center justify-between p-2 px-4 glass glass-glow rounded-lg">
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500 pulse-green"></div>
                    <h2 className="text-[9px] font-bold uppercase tracking-widest">Uplink: <span className="text-green-500 italic">{walletAddress ? 'Active' : 'Standby'}</span></h2>
                </div>
                <div className="h-4 w-[1px] bg-white/10"></div>
                <div className="flex gap-4">
                    <button onClick={() => onNavigate('chess')} className="text-[8px] font-black uppercase text-zinc-400 hover:text-white transition-colors">Quick Play</button>
                    <button onClick={() => onNavigate('ledger')} className="text-[8px] font-black uppercase text-red-500 hover:text-red-400 transition-colors">View Earnings</button>
                    {!user && (
                      <button onClick={loginGoogle} className="text-[8px] font-black uppercase text-blue-400 hover:text-blue-300 transition-colors">Google Sync</button>
                    )}
                </div>
            </div>
            <button onClick={handleLiveStream} className="bg-red-600 hover:bg-red-700 text-white px-4 py-1 rounded text-[8px] font-black uppercase tracking-widest transition-all">Go Live</button>
        </div>

        <div className="flex-1 grid grid-cols-12 gap-4">
            <div className="col-span-12 lg:col-span-8 flex flex-col gap-4">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 h-full overflow-y-auto custom-scrollbar pb-6">

                    <div className="game-box game-box-glow chess-bg p-6 rounded-2xl flex flex-col justify-between">
                        <div className="relative z-10">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <span className="text-[8px] font-black text-white tracking-[0.4em] uppercase bg-black/50 px-2 rounded backdrop-blur">TERMINAL_01</span>
                                    <h3 className="text-2xl font-black italic uppercase tracking-tighter mt-2 text-white drop-shadow-md">CHESS ARENA</h3>
                                </div>
                                <div className="bg-white/10 text-white px-2 py-1 rounded text-[8px] font-bold font-mono backdrop-blur">FREE PLAY</div>
                            </div>
                            <p className="text-[9px] text-zinc-200 font-mono uppercase leading-relaxed bg-black/40 p-2 rounded backdrop-blur border border-white/5">
                                Free-play chess matching with live ratings and public games. On-chain wagering is not enabled in this release.
                            </p>
                        </div>
                        <div className="relative z-10 flex-1 border-y border-white/5 my-4 flex items-center justify-center bg-black/60 rounded-lg backdrop-blur">
                            <div className="text-center">
                                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2">Entry Stake</p>
                                <p className="text-xl font-black font-mono text-green-400">0.00 · FREE</p>
                            </div>
                        </div>
                        <button onClick={() => onNavigate('chess')} className="relative z-10 w-full bg-white text-black py-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all hover:bg-zinc-200 shadow-[0_0_15px_rgba(255,255,255,0.3)]">Find Chess Opponent</button>
                    </div>

                    <div className="game-box game-box-glow p-6 rounded-2xl flex flex-col justify-between bg-zinc-900 border border-white/10 relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 to-transparent"></div>
                        <div className="relative z-10">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <span className="text-[8px] font-black text-blue-400 tracking-[0.4em] uppercase bg-black/50 px-2 rounded backdrop-blur border border-blue-500/30">QUICK MATCH</span>
                                    <h3 className="text-2xl font-black italic uppercase tracking-tighter mt-2 drop-shadow-md text-white">Coin Flip</h3>
                                </div>
                                <div className="bg-blue-600/30 text-blue-300 px-2 py-1 rounded text-[8px] font-bold font-mono backdrop-blur border border-blue-500/30 ">DEMO</div>
                            </div>
                            <p className="text-[9px] text-zinc-200 font-mono uppercase leading-relaxed bg-black/40 p-2 rounded backdrop-blur border border-white/5">
                                Local practice coin flip only. No wallet transaction, wager, payout or smart-contract interaction is enabled.
                            </p>
                        </div>
                        <div className="relative z-10 flex-1 border-y border-white/5 my-4 flex items-center justify-center bg-black/60 rounded-lg backdrop-blur overflow-hidden group">
                           <div className="p-4 flex flex-col items-center">
                               <div className="w-16 h-16 bg-blue-600/20 border-2 border-blue-500/50 rounded-full mb-2 flex items-center justify-center transition-transform group-hover:scale-110 duration-500 shadow-[0_0_20px_rgba(59,130,246,0.4)] relative overflow-hidden animate-[spin_4s_linear_infinite]">
                                  <span className="text-2xl text-blue-400 drop-shadow-[0_0_10px_rgba(59,130,246,1)]">₮</span>
                               </div>
                           </div>
                        </div>
                        <button onClick={() => onNavigate('coinflip')} className="relative z-10 w-full bg-blue-600/50 text-white py-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all hover:bg-blue-600 shadow-[0_0_15px_rgba(59,130,246,0.3)]">Play Coin Flip</button>
                    </div>

                    <div className="game-box game-box-glow chess-bg p-6 rounded-2xl flex flex-col justify-between">
                        <div className="relative z-10">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <span className="text-[8px] font-black text-red-500 tracking-[0.4em] uppercase bg-black/50 px-2 rounded backdrop-blur">3D VR NFT</span>
                                    <h3 className="text-2xl font-black italic uppercase tracking-tighter mt-2 text-white drop-shadow-md">GENESIS BOARD</h3>
                                </div>
                                <div className="bg-red-600/30 text-red-300 px-2 py-1 rounded text-[8px] font-bold font-mono backdrop-blur border border-red-500/30 pulse-red">64 SUPPLY</div>
                            </div>
                            <p className="text-[8px] text-zinc-200 font-mono uppercase leading-relaxed bg-black/40 p-2 rounded backdrop-blur border border-white/5">
                                Read-only NFT gallery. Bidding, transfers and creator royalties are disabled until a verified marketplace contract is deployed.
                            </p>
                        </div>
                        <div className="relative z-10 flex-1 border-y border-white/5 my-4 flex items-center justify-center bg-black/60 rounded-lg backdrop-blur overflow-hidden group">
                           <div className="p-4 flex flex-col items-center">
                               <div className="w-16 h-16 bg-red-600/20 border-2 border-red-500/50 rounded-xl mb-2 flex items-center justify-center transition-transform group-hover:scale-110 duration-500 shadow-[0_0_20px_rgba(255,31,31,0.4)] relative overflow-hidden">
                                  <div className="absolute inset-0 bg-gradient-to-tr from-transparent to-white/20"></div>
                                  <span className="text-2xl drop-shadow-[0_0_10px_rgba(255,31,31,1)]">♔</span>
                               </div>
                               <p className="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-1 drop-shadow-[0_0_5px_rgba(255,31,31,0.5)]">READ-ONLY INDEX</p>
                               <p className="text-xs font-black font-mono text-white text-opacity-80">BIDDING DISABLED</p>
                           </div>
                        </div>
                        <button onClick={() => onNavigate('tournament')} className="relative z-10 w-full bg-yellow-600/20 hover:bg-yellow-600/40 border border-yellow-500/30 py-3 rounded-lg text-[10px] text-yellow-400 font-black uppercase tracking-widest transition-all mb-2 flex items-center justify-center gap-2">
                        <Trophy className="w-3 h-3" /> Tournaments
                    </button>
                    <button onClick={() => onNavigate('replay')} className="relative z-10 w-full bg-white/5 hover:bg-white/10 border border-white/10 py-3 rounded-lg text-[10px] text-zinc-400 font-black uppercase tracking-widest transition-all mb-2 flex items-center justify-center gap-2">
                        <History className="w-3 h-3" /> My Replays
                    </button>
                    <button onClick={() => onNavigate('vault')} className="relative z-10 w-full bg-red-600/50 hover:bg-red-600 py-3 rounded-lg text-[10px] text-white font-black uppercase tracking-widest transition-all shadow-[0_0_10px_rgba(255,31,31,0.3)]">
                          Enter Vault
                        </button>
                    </div>

                </div>
            </div>

            <div className="col-span-12 lg:col-span-4 flex flex-col gap-4">
                <div className="glass glass-glow p-5 rounded-2xl relative overflow-hidden">
                    <div className="flex items-center gap-4 mb-6">
                        <div className="relative group">
                            <div className="w-16 h-16 rounded-xl border-2 border-red-600/30 overflow-hidden bg-zinc-900 flex items-center justify-center">
                                {profile?.avatar ? (
                                    <img src={profile.avatar} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                ) : (
                                    <UserIcon className="w-8 h-8 text-zinc-700" />
                                )}
                            </div>
                            <button
                                onClick={() => setShowAvatarPicker(!showAvatarPicker)}
                                className="absolute -bottom-1 -right-1 bg-zinc-900 border border-white/20 p-1.5 rounded-lg text-white opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <Settings2 className="w-3 h-3" />
                            </button>
                        </div>
                        <div>
                            <h2 className="text-xl font-black italic text-white uppercase tracking-tighter">
                                {profile?.username || (walletAddress ? `${walletAddress.substring(0,6)}...` : (user?.displayName || "COMMANDER"))}
                            </h2>
                            <p className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest mt-1">Status: <span className="text-red-500">BATTLE READY</span></p>
                        </div>
                    </div>

                    {showAvatarPicker && (
                         <div className="mb-6 p-3 bg-black/40 rounded-xl border border-white/5 animate-in slide-in-from-top-2 duration-300">
                             <p className="text-[7px] font-black uppercase text-zinc-500 tracking-widest mb-3">Select Chess Avatar</p>
                             <div className="grid grid-cols-5 gap-2">
                                 {CHESS_AVATARS.map(av => (
                                     <button
                                        key={av.id}
                                        onClick={() => handleAvatarChange(av.url)}
                                        className={`aspect-square rounded-lg overflow-hidden border-2 transition-all hover:scale-110 ${profile?.avatar === av.url ? 'border-red-600' : 'border-transparent'}`}
                                     >
                                         <img src={av.url} alt={av.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                     </button>
                                 ))}
                             </div>
                         </div>
                    )}

                    <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4 flex justify-between">
                        <span>Personal Balance</span>
                        <span className="text-green-500">SECURE</span>
                    </h3>
                    <div className="flex justify-between items-end">
                        <div>
                            <p className="text-3xl font-black italic font-mono tracking-tighter text-white">
                                {walletBalance ? Number(walletBalance).toFixed(4) : "0.00"}
                            </p>
                            <p className="text-[8px] text-zinc-500 font-mono mt-1">AVAILABLE BALANCE {walletBalance ? "ETH" : "USDT"}</p>
                        </div>
                        <button onClick={() => onNavigate('ledger')} className="text-[8px] bg-white/5 border border-white/10 px-3 py-2 rounded uppercase font-black hover:bg-white/10 transition-colors text-white">Wallet</button>
                    </div>
                </div>

                <div className="flex gap-2">
                    <button onClick={() => setRightPanel('chat')} className={`flex-1 py-2 text-[9px] font-black uppercase tracking-widest rounded transition-colors ${rightPanel === 'chat' ? 'bg-red-600/20 text-red-400 border border-red-500/30' : 'bg-black/40 text-zinc-500 border border-white/5 hover:bg-white/5'}`}>Global Chat</button>
                    <button onClick={() => setRightPanel('leaderboard')} className={`flex-1 py-2 text-[9px] font-black uppercase tracking-widest rounded transition-colors ${rightPanel === 'leaderboard' ? 'bg-red-600/20 text-red-400 border border-red-500/30' : 'bg-black/40 text-zinc-500 border border-white/5 hover:bg-white/5'}`}>Leaderboard</button>
                </div>

                {rightPanel === 'chat' ? <Chatroom /> : <Leaderboard />}

                <div className="mt-4">
                  <AdBanner />
                </div>
            </div>
        </div>
    </section>
  );
}
