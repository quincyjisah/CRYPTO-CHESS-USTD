/**
 * Leaderboard.tsx — reads from the /cache/leaderboard document
 * pre-built by the bundleLeaderboard Cloud Function every 5 minutes.
 *
 * At 1M users, a live ordered query on /profiles would cost
 * millions of Firestore reads per day. This cache reduces that to
 * one document read per user session.
 */
import React, { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import RatingBadge from './RatingBadge';

interface Leader {
  rank: number;
  uid: string;
  handle: string;
  avatar: string;
  wins: number;
  matches: number;
  rating?: number;
  rd?: number;
}

export default function Leaderboard() {
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Read from the pre-bundled cache document — single read, not a query
    const unsub = onSnapshot(doc(db, 'cache', 'leaderboard'), (snap) => {
      if (snap.exists()) {
        setLeaders(snap.data().leaders || []);
        const ts = snap.data().cachedAt?.toDate();
        if (ts) setCachedAt(ts.toLocaleTimeString([], { hour12: false }));
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  return (
    <div className="glass glass-glow flex-1 rounded-2xl overflow-hidden flex flex-col h-[400px]">
      <div className="p-3 border-b border-white/5 bg-black/40 flex justify-between items-center z-10 relative backdrop-blur">
        <div>
          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Global Leaderboard</span>
          {cachedAt && (
            <span className="text-[7px] text-zinc-600 font-mono ml-2">updated {cachedAt}</span>
          )}
        </div>
        <div className="bg-green-500/20 text-green-400 px-2 flex items-center gap-2 rounded text-[8px] font-black font-mono border border-green-500/30">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 pulse-green" />
          FREE-PLAY RATINGS
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[9px] text-zinc-500 uppercase tracking-widest animate-pulse">Loading...</p>
          </div>
        ) : leaders.length === 0 ? (
          <p className="text-[9px] text-zinc-500 text-center mt-10 uppercase tracking-widest">
            Awaiting First Matches...
          </p>
        ) : (
          leaders.map((p) => (
            <div
              key={p.uid}
              className="flex justify-between items-center bg-zinc-900/50 p-3 rounded-lg border border-white/5 hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className={`text-[10px] font-black w-5 text-center shrink-0 ${
                  p.rank === 1 ? 'text-yellow-400 drop-shadow-[0_0_5px_rgba(250,204,21,0.5)]' :
                  p.rank === 2 ? 'text-zinc-300' :
                  p.rank === 3 ? 'text-amber-600' : 'text-zinc-600'
                }`}>#{p.rank}</span>
                {p.avatar && (
                  <img
                    src={p.avatar}
                    alt={p.handle}
                    className="w-6 h-6 rounded-full object-cover border border-white/10"
                    referrerPolicy="no-referrer"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
                <div className="flex flex-col">
                  <span className="text-[10px] font-mono text-zinc-200 truncate max-w-[100px]">{p.handle}</span>
                  <span className="text-[7px] text-zinc-500 uppercase font-black">
                    {p.matches} matches · {p.matches ? Math.round((p.wins / p.matches) * 100) : 0}% win
                  </span>
                </div>
              </div>
              <RatingBadge rating={p.rating || 1500} rd={p.rd || 350} size="sm" />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
