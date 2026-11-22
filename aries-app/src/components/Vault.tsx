import React, { useState, useEffect } from 'react';
import { ViewType } from '../App';
import { fetchContractNFTs, NftToken } from '../lib/nft';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';

interface VaultProps {
  onNavigate: (view: ViewType) => void;
}

export default function Vault({ onNavigate }: VaultProps) {
  const [nfts, setNfts] = useState<NftToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNft, setSelectedNft] = useState<NftToken | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchNFTs = async () => {
    setLoading(true);
    setError(null);
    try {
      const tokens = await fetchContractNFTs(64);
      setNfts(tokens);
    } catch (e) {
      setError('Failed to load NFTs. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchNFTs(); }, []);

  return (
    <section className="flex flex-col animate-in fade-in duration-300 pb-20">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <button onClick={() => onNavigate('hub')} className="text-[9px] font-black text-zinc-500 hover:text-white uppercase tracking-widest cursor-pointer">← Hub</button>
            <span className="text-[8px] bg-red-600 text-white px-2 py-0.5 rounded uppercase font-black tracking-widest">Read-only index</span>
          </div>
          <h2 className="text-3xl font-black italic uppercase mt-2 drop-shadow-[0_0_10px_rgba(255,31,31,0.5)]">The Genesis Board</h2>
          <p className="text-xs text-zinc-400 font-mono mt-1 max-w-xl">
            Read-only NFT index. Trading and creator royalties are not active in this release.
          </p>
        </div>
        <button onClick={fetchNFTs} className="flex items-center gap-2 bg-white/5 border border-white/10 px-4 py-2 rounded-lg text-[9px] font-black uppercase text-zinc-400 hover:text-white hover:bg-white/10 transition-all">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-600/10 border border-red-500/30 rounded-lg text-[10px] text-red-400 font-mono">{error}</div>}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <Loader2 className="w-8 h-8 text-red-500 animate-spin" />
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Loading on-chain NFTs via Alchemy...</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-4">
          {nfts.map((nft) => (
            <div key={nft.id} className="bg-zinc-900 border border-white/5 rounded-xl overflow-hidden hover:border-red-500/30 transition-all cursor-pointer group" onClick={() => setSelectedNft(nft)}>
              <div className="aspect-square bg-zinc-800 overflow-hidden relative">
                <img src={nft.image} alt={nft.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy"
                  onError={(e) => { (e.target as HTMLImageElement).src = `https://picsum.photos/seed/nft-${nft.id}/400`; }} />
                <div className="absolute top-1 left-1 bg-black/70 px-1.5 py-0.5 rounded text-[7px] font-black text-zinc-400 backdrop-blur">#{String(nft.id).padStart(2, '0')}</div>
                {nft.owner && <div className="absolute bottom-1 right-1 bg-green-600/70 px-1.5 py-0.5 rounded text-[7px] font-black text-white backdrop-blur">OWNED</div>}
              </div>
              <div className="p-3">
                <p className="text-[10px] font-black text-white uppercase tracking-tight truncate">{nft.name}</p>
                <p className="text-[8px] text-zinc-500 font-mono mt-0.5">Trading disabled</p>
                <p className="mt-2 text-center text-[8px] font-black uppercase tracking-widest text-zinc-500">Trading disabled</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedNft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" onClick={() => setSelectedNft(null)}></div>
          <div className="glass glass-glow w-full max-w-lg p-6 rounded-3xl relative z-10 border border-white/10 animate-in zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto">
            <button onClick={() => setSelectedNft(null)} className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors z-10">✕</button>
            <div className="aspect-square w-full rounded-xl overflow-hidden mb-4 bg-zinc-800">
              <img src={selectedNft.image} alt={selectedNft.name} className="w-full h-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).src = `https://picsum.photos/seed/nft-${selectedNft.id}/600`; }} />
            </div>
            <h3 className="text-xl font-black italic uppercase text-white">{selectedNft.name}</h3>
            <p className="text-[9px] font-mono text-zinc-500 mt-0.5">Token #{String(selectedNft.id).padStart(2, '0')}</p>
            <p className="text-xs text-zinc-400 mt-3 leading-relaxed">{selectedNft.description}</p>
            {selectedNft.attributes.length > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {selectedNft.attributes.map((attr, i) => (
                  <div key={i} className="bg-white/5 rounded-lg p-2 border border-white/5">
                    <p className="text-[8px] text-zinc-500 uppercase font-black">{attr.trait_type}</p>
                    <p className="text-[10px] text-white font-mono mt-0.5">{String(attr.value)}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 flex gap-3">
              <p className="flex-1 py-3 text-center text-[9px] font-black uppercase tracking-widest text-zinc-500">Trading disabled</p>
              {selectedNft.openseaUrl && (
                <a href={selectedNft.openseaUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 bg-blue-600/20 border border-blue-500/30 text-blue-400 font-black text-[10px] uppercase tracking-widest px-4 py-3 rounded-xl hover:bg-blue-600/30 transition-colors">
                  <ExternalLink className="w-3 h-3" /> OpenSea
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
