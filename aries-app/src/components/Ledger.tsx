import React, { useState, useEffect } from 'react';
import { ViewType } from '../App';
import { useAuth } from '../lib/AuthContext';
import { db } from '../lib/firebase';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';

interface LedgerProps {
  onNavigate: (view: ViewType) => void;
}

export default function Ledger({ onNavigate }: LedgerProps) {
  const { user } = useAuth();
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    const pid = user?.uid;
    if (!pid) return;

    const q = query(
      collection(db, 'transactions'),
      where('userId', '==', pid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const txs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setHistory(txs);
    }, (error) => {
      console.error("Ledger fetch error", error);
    });

    return () => unsubscribe();
  }, [user?.uid]);

  return (
    <section id="view-ledger" className="flex flex-col animate-in fade-in duration-300 pb-24">
        <div className="flex justify-between items-center mb-6">
            <div>
                <button onClick={() => onNavigate('hub')} className="text-[9px] font-black text-zinc-500 hover:text-white uppercase tracking-widest cursor-pointer">← Return to Hub</button>
                <h2 className="text-2xl font-black italic uppercase mt-2">Activity Ledger</h2>
            </div>
            <div className="flex gap-2">
                <button disabled className="bg-white/10 text-white px-6 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer hover:bg-white/20">Bridge unavailable</button>
                <button disabled className="bg-red-600 text-white px-6 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest pulse-red transition-all cursor-pointer hover:bg-red-700">Withdraw unavailable</button>
            </div>
        </div>

        <div className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-amber-300">Read-only legacy activity</p>
            <p className="mt-1 text-[9px] font-mono text-zinc-400">Historical app records are not proof of an on-chain transfer or withdrawable balance. Deposits, withdrawals, tips and wagering remain disabled until verified contract and settlement integrations are deployed.</p>
        </div>
        <div className="glass rounded-xl border border-white/10 flex-1 overflow-hidden flex flex-col">
            <div className="grid grid-cols-4 p-4 border-b border-white/5 text-[9px] font-black text-zinc-500 uppercase tracking-widest bg-white/5">
                <span>Transaction</span>
                <span>Type</span>
                <span>Status</span>
                <span className="text-right">Amount</span>
            </div>
            <div className="flex-1 overflow-y-auto">
                {history.length === 0 ? (
                    <div className="p-8 text-center text-zinc-500 text-[10px] uppercase tracking-widest">No transaction history.</div>
                ) : (
                    history.map((tx, idx) => (
                        <div key={idx} className="grid grid-cols-4 p-4 ledger-row text-[10px] items-center">
                            <div className="flex flex-col">
                                <span className="font-bold text-white">{tx.name}</span>
                                <span className="text-[8px] font-mono text-zinc-500 uppercase">{tx.id.slice(0,8)}</span>
                            </div>
                            <span className="text-zinc-400 uppercase font-mono text-[9px]">{tx.type}</span>
                            <span className="text-green-500 text-[8px] font-black uppercase tracking-tighter italic">{tx.status}</span>
                            <span className={`text-right font-bold font-mono ${tx.amount >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                {Number(tx.amount || 0) >= 0 ? '+' : ''}{Number(tx.amount || 0).toFixed(2)} <span className="text-[7px] text-zinc-500 ml-0.5">{tx.currency || 'Unspecified'}</span>
                            </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    </section>
  );
}
