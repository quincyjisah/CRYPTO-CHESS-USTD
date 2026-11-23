import React from 'react';
import { ViewType } from '../App';
import { useAuth } from '../lib/AuthContext';
import { useProtocolStats } from '../hooks/useProtocolStats';
import { Wallet, LogOut, User, Trophy, History } from 'lucide-react';
import RatingBadge from './RatingBadge';

interface HeaderProps {
  currentView: ViewType;
  onNavigate: (view: ViewType) => void;
}

export default function Header({ currentView, onNavigate }: HeaderProps) {
  const {
    user, profile, walletAddress, walletBalance,
    loginGoogle, loginWallet, logout
  } = useAuth();
  const stats = useProtocolStats();

  const shortWallet = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : null;

  const displayName = user?.displayName || user?.email?.split('@')[0] || shortWallet || null;
  const isConnected = !!(user || walletAddress);

  return (
    <header className="fixed top-0 w-full z-[100] glass border-b border-white/10 px-4 md:px-6 py-3 flex justify-between items-center gap-3">

      {/* Logo */}
      <div className="flex items-center gap-3 cursor-pointer shrink-0" onClick={() => onNavigate('hub')}>
        <div className="w-8 h-8 bg-red-600 rounded flex items-center justify-center font-black italic text-xl">A</div>
        <div className="leading-tight hidden sm:block">
          <h1 className="text-sm font-black italic uppercase tracking-tighter">ARIES PROTOCOL</h1>
          <p className="text-[7px] font-mono text-zinc-500 uppercase tracking-widest">Sovereign Layer</p>
        </div>
      </div>

      {/* Stats */}
      <div className="hidden lg:flex gap-6">
        <div className="flex flex-col items-center min-w-[70px]">
          <p className="text-[7px] font-mono text-zinc-500 uppercase">Verified Matches</p>
          <p className="text-[10px] font-bold text-white font-mono">
            {stats.loaded ? stats.totalMatches.toLocaleString() : '—'}
          </p>
        </div>
        <div className="flex flex-col items-center min-w-[70px]">
          <p className="text-[7px] font-mono text-zinc-500 uppercase">Live Matches</p>
          <p className="text-[10px] font-bold text-red-400 font-mono">
            {stats.loaded ? stats.activeMatches : '—'}
          </p>
        </div>
        <div className="flex flex-col items-center min-w-[70px]">
          <p className="text-[7px] font-mono text-zinc-500 uppercase">Rating</p>
          {profile?.rating
            ? <RatingBadge rating={profile.rating} rd={profile.rd} size="sm" showBand={false} />
            : <p className="text-[10px] font-bold text-zinc-500 font-mono">—</p>
          }
        </div>
        <div className="flex flex-col items-center min-w-[70px]">
          <p className="text-[7px] font-mono text-zinc-500 uppercase">Balance</p>
          <p className="text-[10px] font-bold text-green-400 font-mono">
            {walletBalance ? `$${parseFloat(walletBalance).toFixed(2)}` : '—'}
          </p>
        </div>
      </div>

      {/* Nav + auth */}
      <div className="flex items-center gap-2">
        <button onClick={() => onNavigate('tournament')}
          className="hidden md:flex items-center gap-1 bg-yellow-600/20 border border-yellow-500/40 text-yellow-400 px-3 py-1.5 rounded text-[8px] font-black uppercase hover:bg-yellow-600/30 transition-all">
          <Trophy className="w-3 h-3" /> Tournaments
        </button>
        <button onClick={() => onNavigate('vault')}
          className="hidden sm:block bg-red-600/20 border border-red-500/40 text-red-400 px-3 py-1.5 rounded text-[8px] font-black uppercase hover:bg-red-600/30 transition-all">
          NFT Vault
        </button>
        <button onClick={() => onNavigate('ledger')}
          className="hidden sm:block bg-zinc-900 border border-white/10 text-white px-3 py-1.5 rounded text-[8px] font-black uppercase hover:bg-zinc-800 transition-all">
          Ledger
        </button>

        {!isConnected ? (
          <div className="flex items-center gap-2">
            <button
              onClick={loginGoogle}
              className="flex items-center gap-1.5 bg-white text-black px-3 py-1.5 rounded text-[8px] font-black uppercase hover:bg-gray-200 transition-all"
            >
              <User className="w-3 h-3" /> Google
            </button>
            <button
              onClick={loginWallet}
              className="flex items-center gap-1.5 bg-[#f6851b] hover:bg-[#e2761b] text-white px-3 py-1.5 rounded text-[8px] font-black uppercase transition-all shadow-[0_0_10px_rgba(246,133,27,0.3)]"
            >
              <Wallet className="w-3 h-3" /> Connect
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 px-3 py-1.5 rounded">
              <div className="w-2 h-2 rounded-full bg-green-500 pulse-green" />
              <span className="text-[8px] font-mono text-zinc-300 max-w-[100px] truncate">{displayName}</span>
            </div>
            <button
              onClick={logout}
              title="Disconnect"
              className="p-1.5 bg-white/5 border border-white/10 rounded hover:bg-red-600/20 hover:border-red-500/30 transition-colors"
            >
              <LogOut className="w-3 h-3 text-zinc-400 hover:text-red-400" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
