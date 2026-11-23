import { useState } from 'react';
import { ViewType } from '../App';

interface CoinFlipProps {
  onNavigate: (view: ViewType) => void;
}

export default function CoinFlip({ onNavigate }: CoinFlipProps) {
  const [inGame, setInGame] = useState(false);
  const [statusText, setStatusText] = useState('Demo only — no funds are wagered.');
  const [isFlipping, setIsFlipping] = useState(false);
  const [result, setResult] = useState<'heads' | 'tails' | null>(null);

  const speak = (text: string) => {
      const speech = new SpeechSynthesisUtterance(text);
      speech.rate = 0.9;
      speech.pitch = 0.5;
      speech.volume = 1;
      window.speechSynthesis.speak(speech);
  };

  const handleFlip = (choice: 'heads' | 'tails') => {
    if (inGame) return;
    setInGame(true);
    setIsFlipping(true);
    setResult(null);
    setStatusText('Demo flip in progress — no payment, wallet transaction or ledger entry.');

    window.setTimeout(() => {
      const values = new Uint32Array(1);
      window.crypto.getRandomValues(values);
      const outcome = values[0] % 2 === 0 ? 'heads' : 'tails';
      setResult(outcome);
      setIsFlipping(false);
      setInGame(false);
      const won = choice === outcome;
      setStatusText('Demo result: ' + outcome.toUpperCase() + '. ' +
        (won ? 'Your prediction matched.' : 'Your prediction did not match.') +
        ' No funds were moved.');
      speak(won ? 'Demo prediction correct.' : 'Demo prediction missed.');
    }, 1800);
  };

  return (
    <section id="view-coinflip" className="min-h-full flex flex-col md:flex-row gap-6 animate-in fade-in duration-300 pb-10">
        <div className="w-full md:w-1/3 flex flex-col gap-6 relative z-10">
            <div className="flex items-center gap-3">
                <button onClick={() => onNavigate('hub')} className="text-[9px] font-black text-zinc-500 hover:text-white uppercase tracking-widest cursor-pointer">← Core</button>
                <div className="w-2 h-2 rounded-full bg-red-600 pulse-red"></div>
            </div>

            <div>
                <h2 className="text-4xl font-black italic uppercase tracking-tighter text-white drop-shadow-[0_0_10px_rgba(255,31,31,0.5)] leading-none">DEMO ONLY</h2>
                <h3 className="text-xl font-bold font-mono text-zinc-400 mt-1 uppercase">Practice Coin Flip</h3>
            </div>

            <div className="glass glass-glow p-4 rounded-xl flex flex-col gap-3">
                 <div className="flex items-center gap-2 mb-2">
                    <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-ping"></div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-white">System Status</p>
                 </div>
                 <p className="text-xs font-mono text-zinc-300 bg-black/50 p-2 rounded border border-white/5 h-20 overflow-y-auto custom-scrollbar">
                    {statusText}
                 </p>
            </div>

            <div className="glass p-4 rounded-xl border border-white/10 flex flex-col gap-4">
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-amber-300">Practice mode only</p>
                    <p className="mt-1 text-[9px] font-mono text-zinc-400">No USDT, USDC, DAI or ETH is wagered. This demo does not connect to escrow or create financial ledger records.</p>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                    <button
                       onClick={() => handleFlip('heads')}
                       disabled={inGame || isFlipping}
                       className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white font-black py-4 rounded-lg uppercase tracking-widest transition-all border border-white/10 hover:border-red-500/50"
                    >
                        Heads
                    </button>
                    <button
                       onClick={() => handleFlip('tails')}
                       disabled={inGame || isFlipping}
                       className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white font-black py-4 rounded-lg uppercase tracking-widest transition-all border border-white/10 hover:border-red-500/50"
                    >
                        Tails
                    </button>
                </div>
            </div>
        </div>

        <div className="flex-1 flex justify-center items-center relative z-10 p-4">
             <div className={`w-64 h-64 md:w-96 md:h-96 rounded-full border-8 shadow-[0_0_50px_rgba(255,31,31,0.5)] flex items-center justify-center transition-all duration-1000 ${isFlipping ? 'animate-[spin_0.2s_linear_infinite] border-red-500/50 bg-black/80' : 'border-zinc-800 bg-zinc-900'}`}>
                  {isFlipping ? (
                      <span className="text-8xl text-red-500 drop-shadow-[0_0_10px_rgba(255,31,31,1)]">?</span>
                  ) : result ? (
                      <div className="text-center animate-in zoom-in duration-500">
                          <span className="text-6xl md:text-8xl text-white font-black uppercase tracking-tighter drop-shadow-[0_0_10px_rgba(255,255,255,1)]">
                              {result === 'heads' ? 'H' : 'T'}
                          </span>
                      </div>
                  ) : (
                      <span className="text-4xl md:text-5xl text-zinc-700 font-black italic">FLIP COIN</span>
                  )}
             </div>
        </div>
    </section>
  );
}
