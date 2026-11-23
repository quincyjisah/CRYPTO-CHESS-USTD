import React from 'react';

interface TipSystemProps {
  gameId: string;
  whiteUid: string;
  blackUid: string;
  whiteHandle: string;
  blackHandle: string;
  isSpectator?: boolean;
}

export default function TipSystem(_props: TipSystemProps) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <p className="text-[9px] font-black uppercase tracking-widest text-zinc-300">Player tips paused</p>
      <p className="mt-1 text-[8px] font-mono text-zinc-500">
        Tips reopen after a verified on-chain transfer flow is deployed. No money is collected or credited here.
      </p>
    </div>
  );
}
