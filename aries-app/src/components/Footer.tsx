import React from 'react';
import { useProtocolStats } from '../hooks/useProtocolStats';

export default function Footer() {
  const [time, setTime] = React.useState(new Date().toLocaleTimeString([], {hour12: false}));
  const stats = useProtocolStats();

  React.useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date().toLocaleTimeString([], {hour12: false}));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <footer className="fixed bottom-0 w-full glass border-t border-red-500/10 px-6 py-2 flex flex-col sm:flex-row justify-between items-center z-[150] gap-2 sm:gap-6 text-center sm:text-left">
        <div className="flex items-center gap-6 justify-center flex-wrap">
            <div className="flex flex-col">
                <span className="text-[7px] font-black text-zinc-500 uppercase">Verified Matches</span>
            {stats.loaded ? stats.totalMatches.toLocaleString() : '—'}
            </div>
            <div className="h-6 w-[1px] bg-white/10 hidden sm:block"></div>
            <div className="flex flex-col">
                <span className="text-[7px] font-black text-zinc-500 uppercase">Active Arenas</span>
                <span className="text-[10px] font-black font-mono text-zinc-300">{stats.activeMatches}</span>
            </div>
        </div>
        <div className="text-[10px] font-black text-white font-mono bg-red-600/20 px-3 py-1 rounded border border-red-500/30 w-full sm:w-auto mt-2 sm:mt-0">{time} - FREE PLAY · NO STAKES</div>
    </footer>
  );
}
