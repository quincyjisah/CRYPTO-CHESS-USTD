import React, { useState } from 'react';
import { Shield, ChevronRight, Loader2, AlertTriangle, X } from 'lucide-react';

/**
 * WalletModal — Aries Protocol multi-wallet connect modal
 *
 * Supported wallets:
 *   MetaMask        — most common desktop wallet
 *   Coinbase Wallet — mobile-first, beginner-friendly
 *   WalletConnect   — 400+ mobile wallets via QR code
 *   Rabby           — power-user multi-chain wallet
 *   Browser Wallet  — any injected EIP-1193 provider
 *
 * Security:
 *   - Phishing warning shown on every open
 *   - All connections are EIP-1193 (window.ethereum / provider)
 *   - No private keys ever touched
 *   - Domain verified in MetaMask by the user before signing
 */

interface WalletOption {
  id: string;
  name: string;
  description: string;
  icon: string;
  badge?: string;
  available: () => boolean;
  connect: () => Promise<{ address: string; balance: string } | null>;
}

interface WalletModalProps {
  onClose: () => void;
  onConnected: (address: string, balance: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getUSDTBalance(provider: any, address: string): Promise<string> {
  try {
    const { ethers } = await import('ethers');
    const ethProvider = new ethers.BrowserProvider(provider);
    const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
    const abi  = ['function balanceOf(address) view returns (uint256)'];
    const contract = new ethers.Contract(USDT, abi, ethProvider);
    const raw = await contract.balanceOf(address);
    return parseFloat(ethers.formatUnits(raw, 6)).toFixed(2);
  } catch {
    try {
      const { ethers } = await import('ethers');
      const ethProvider = new ethers.BrowserProvider(provider);
      const bal = await ethProvider.getBalance(address);
      return parseFloat((await import('ethers')).ethers.formatEther(bal)).toFixed(4) + ' ETH';
    } catch {
      return '0.00';
    }
  }
}

async function connectInjected(providerGetter: () => any): Promise<{ address: string; balance: string } | null> {
  try {
    const provider = providerGetter();
    if (!provider) return null;
    const accounts: string[] = await provider.request({ method: 'eth_requestAccounts' });
    if (!accounts || accounts.length === 0) return null;
    const address = accounts[0];

    // Enforce Ethereum Mainnet (chainId 1)
    const chainIdHex: string = await provider.request({ method: 'eth_chainId' });
    const chainId = parseInt(chainIdHex, 16);
    if (chainId !== 1) {
      try {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x1' }],
        });
      } catch {
        alert('Please switch your wallet to Ethereum Mainnet before connecting.');
        return null;
      }
    }

    const balance = await getUSDTBalance(provider, address);
    return { address, balance };
  } catch (err: any) {
    if (err.code === 4001) return null; // User rejected
    console.error('[Wallet] Connection error:', err);
    return null;
  }
}

async function connectWalletConnect(): Promise<{ address: string; balance: string } | null> {
  try {
    // Dynamically import WalletConnect to avoid bundle bloat for non-users
    // Requires: npm install @walletconnect/ethereum-provider
    // VITE_WALLETCONNECT_PROJECT_ID must be set in .env.local
    // Get a free project ID at https://cloud.walletconnect.com
    const projectId = (import.meta as any).env?.VITE_WALLETCONNECT_PROJECT_ID;
    if (!projectId) {
      alert('WalletConnect project ID not configured. Add VITE_WALLETCONNECT_PROJECT_ID to your .env.local file.\nGet a free ID at https://cloud.walletconnect.com');
      return null;
    }

    const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
    const wcProvider = await EthereumProvider.init({
      projectId,
      chains: [1],
      showQrModal: true,
      metadata: {
        name: 'Aries Protocol',
        description: 'Aries Protocol — connect a wallet for identity and read-only balance inspection. No wagering is enabled.',
        url: window.location.origin,
        icons: [`${window.location.origin}/favicon.ico`],
      },
    });

    await wcProvider.connect();
    const accounts = wcProvider.accounts;
    if (!accounts || accounts.length === 0) return null;
    const address = accounts[0];
    const balance = await getUSDTBalance(wcProvider, address);
    return { address, balance };
  } catch (err: any) {
    if (err.message?.includes('User rejected')) return null;
    console.error('[WalletConnect] Error:', err);
    alert('WalletConnect failed. Make sure @walletconnect/ethereum-provider is installed:\nnpm install @walletconnect/ethereum-provider');
    return null;
  }
}

// ─── Wallet definitions ───────────────────────────────────────────────────────

function getMetaMaskProvider(): any {
  const w = window as any;
  if (w.ethereum?.isMetaMask) return w.ethereum;
  if (w.ethereum?.providers) return w.ethereum.providers.find((p: any) => p.isMetaMask);
  return null;
}

function getCoinbaseProvider(): any {
  const w = window as any;
  if (w.coinbaseWalletExtension) return w.coinbaseWalletExtension;
  if (w.ethereum?.isCoinbaseWallet) return w.ethereum;
  if (w.ethereum?.providers) return w.ethereum.providers.find((p: any) => p.isCoinbaseWallet);
  return null;
}

function getRabbyProvider(): any {
  const w = window as any;
  if (w.rabby) return w.rabby;
  if (w.ethereum?.isRabby) return w.ethereum;
  return null;
}

function getBrowserProvider(): any {
  return (window as any).ethereum || null;
}

const WALLETS: WalletOption[] = [
  {
    id: 'metamask',
    name: 'MetaMask',
    description: 'Most popular browser wallet',
    icon: '🦊',
    badge: 'Recommended',
    available: () => !!getMetaMaskProvider(),
    connect: () => connectInjected(getMetaMaskProvider),
  },
  {
    id: 'coinbase',
    name: 'Coinbase Wallet',
    description: 'Beginner-friendly · Mobile & desktop',
    icon: '🔵',
    available: () => !!getCoinbaseProvider(),
    connect: () => connectInjected(getCoinbaseProvider),
  },
  {
    id: 'walletconnect',
    name: 'WalletConnect',
    description: '400+ mobile wallets via QR code',
    icon: '🔗',
    badge: 'Mobile',
    available: () => true, // Always shown — opens QR modal
    connect: connectWalletConnect,
  },
  {
    id: 'rabby',
    name: 'Rabby Wallet',
    description: 'Multi-chain power wallet',
    icon: '🐰',
    available: () => !!getRabbyProvider(),
    connect: () => connectInjected(getRabbyProvider),
  },
  {
    id: 'browser',
    name: 'Browser Wallet',
    description: 'Any injected EIP-1193 wallet',
    icon: '🌐',
    available: () => !!getBrowserProvider(),
    connect: () => connectInjected(getBrowserProvider),
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function WalletModal({ onClose, onConnected }: WalletModalProps) {
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async (wallet: WalletOption) => {
    setError(null);
    setConnecting(wallet.id);
    try {
      const result = await wallet.connect();
      if (result) {
        onConnected(result.address, result.balance);
        onClose();
      } else {
        setError('Connection cancelled or failed. Please try again.');
      }
    } catch (err: any) {
      setError(err.message || 'Connection failed.');
    } finally {
      setConnecting(null);
    }
  };

  const availableWallets = WALLETS.filter(w => w.available());
  const unavailableWallets = WALLETS.filter(w => !w.available() && w.id !== 'walletconnect');

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={onClose} />

      <div className="glass glass-glow w-full max-w-sm rounded-3xl border border-white/10 relative z-10 animate-in zoom-in-95 duration-300 overflow-hidden">

        {/* Header */}
        <div className="p-6 pb-0 flex justify-between items-start">
          <div>
            <h2 className="text-lg font-black italic uppercase text-white tracking-tighter">Connect Wallet</h2>
            <p className="text-[9px] text-zinc-500 font-mono uppercase mt-0.5">Ethereum Mainnet · USDT / USDC / DAI</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Phishing warning */}
        <div className="mx-6 mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[8px] text-amber-300 leading-relaxed font-mono">
            You are connecting to <strong>ariesprotocol.app</strong> — verify this URL before approving.
            Aries Protocol will never ask for your seed phrase or private key.
          </p>
        </div>

        {/* Wallet list */}
        <div className="p-6 space-y-2">
          {availableWallets.map(wallet => (
            <button
              key={wallet.id}
              onClick={() => handleConnect(wallet)}
              disabled={!!connecting}
              className="w-full flex items-center gap-4 p-4 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-2xl transition-all group disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <span className="text-2xl w-8 text-center">{wallet.icon}</span>
              <div className="flex-1 text-left">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-black text-white uppercase">{wallet.name}</span>
                  {wallet.badge && (
                    <span className="text-[7px] bg-red-600/80 text-white px-1.5 py-0.5 rounded font-black uppercase">
                      {wallet.badge}
                    </span>
                  )}
                </div>
                <span className="text-[8px] text-zinc-500 font-mono">{wallet.description}</span>
              </div>
              {connecting === wallet.id ? (
                <Loader2 className="w-4 h-4 text-white animate-spin" />
              ) : (
                <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-white transition-colors" />
              )}
            </button>
          ))}

          {/* Unavailable wallets (greyed out with install link) */}
          {unavailableWallets.map(wallet => (
            <a
              key={wallet.id}
              href={
                wallet.id === 'metamask' ? 'https://metamask.io/download/' :
                wallet.id === 'coinbase' ? 'https://www.coinbase.com/wallet/downloads' :
                wallet.id === 'rabby'    ? 'https://rabby.io/' :
                '#'
              }
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center gap-4 p-4 bg-white/2 border border-white/5 rounded-2xl opacity-40 hover:opacity-60 transition-opacity"
            >
              <span className="text-2xl w-8 text-center">{wallet.icon}</span>
              <div className="flex-1 text-left">
                <span className="text-[11px] font-black text-white uppercase">{wallet.name}</span>
                <p className="text-[8px] text-zinc-500 font-mono">Not installed · Click to download</p>
              </div>
              <ChevronRight className="w-4 h-4 text-zinc-700" />
            </a>
          ))}

          {error && (
            <div className="p-3 bg-red-600/10 border border-red-500/30 rounded-xl">
              <p className="text-[9px] text-red-400 font-mono">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex items-center gap-2">
          <Shield className="w-3 h-3 text-zinc-600" />
          <p className="text-[7px] text-zinc-600 font-mono leading-relaxed">
            Non-custodial. Your keys, your coins. Aries Protocol never holds your private keys.
          </p>
        </div>
      </div>
    </div>
  );
}
