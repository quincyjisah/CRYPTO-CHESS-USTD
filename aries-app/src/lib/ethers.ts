/**
 * ethers.ts — Aries Protocol Web3 utilities
 *
 * Read-only wallet utilities for the current free-play prototype.
 *  - Connects an EIP-1193 wallet and reads public stablecoin balances
 *  - Does not request token approvals or submit token transfers
 *  - No deposit, wager, payout or withdrawal flow is enabled
 */

import { ethers } from 'ethers';

const ALCHEMY_RPC   = `https://eth-mainnet.g.alchemy.com/v2/${import.meta.env.VITE_ALCHEMY_API_KEY || ''}`;
const USDT_ADDRESS  = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const USDC_ADDRESS  = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const DAI_ADDRESS   = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const MAINNET_ID    = 1;

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

// ─── Enforce Mainnet ──────────────────────────────────────────────────────────
export async function enforceMainnet(): Promise<boolean> {
  const w = window as any;
  if (!w.ethereum) {
    alert('No Web3 wallet detected. Please install MetaMask or Coinbase Wallet.');
    return false;
  }
  try {
    const chainId = parseInt(await w.ethereum.request({ method: 'eth_chainId' }), 16);
    if (chainId !== MAINNET_ID) {
      try {
        await w.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x1' }],
        });
        return true;
      } catch {
        alert('Please switch your wallet to Ethereum Mainnet before playing.');
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

// ─── Get stablecoin balance ───────────────────────────────────────────────────
export async function getStablecoinBalance(
  address: string,
  token: 'USDT' | 'USDC' | 'DAI' = 'USDT'
): Promise<string> {
  try {
    const provider = new ethers.JsonRpcProvider(ALCHEMY_RPC);
    const tokenAddress = token === 'USDT' ? USDT_ADDRESS
                       : token === 'USDC' ? USDC_ADDRESS
                       : DAI_ADDRESS;
    const decimals = token === 'DAI' ? 18 : 6;

    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const raw      = await contract.balanceOf(address);
    return parseFloat(ethers.formatUnits(raw, decimals)).toFixed(2);
  } catch {
    return '0.00';
  }
}

// ─── Get all stablecoin balances at once ─────────────────────────────────────
export async function getAllBalances(address: string): Promise<{
  USDT: string; USDC: string; DAI: string; ETH: string;
}> {
  try {
    const provider = new ethers.JsonRpcProvider(ALCHEMY_RPC);
    const [usdt, usdc, dai, ethBal] = await Promise.all([
      getStablecoinBalance(address, 'USDT'),
      getStablecoinBalance(address, 'USDC'),
      getStablecoinBalance(address, 'DAI'),
      provider.getBalance(address).then(b => parseFloat(ethers.formatEther(b)).toFixed(4)),
    ]);
    return { USDT: usdt, USDC: usdc, DAI: dai, ETH: ethBal };
  } catch {
    return { USDT: '0.00', USDC: '0.00', DAI: '0.00', ETH: '0.0000' };
  }
}

// ─── Connect wallet ───────────────────────────────────────────────────────────
export async function connectWallet(): Promise<{
  address: string;
  balance: string;
  balances: { USDT: string; USDC: string; DAI: string; ETH: string };
} | null> {
  if (typeof window === 'undefined') return null;

  const w = window as any;
  const ethereum = w.ethereum || w.coinbaseWalletExtension || w.rabby;
  if (!ethereum) {
    alert('Please install MetaMask, Coinbase Wallet, or Rabby.');
    return null;
  }

  try {
    const provider = new ethers.BrowserProvider(ethereum);
    await provider.send('eth_requestAccounts', []);
    const signer  = await provider.getSigner();
    const address = await signer.getAddress();

    const isMainnet = await enforceMainnet();
    if (!isMainnet) return null;

    const balances = await getAllBalances(address);
    const balance  = balances.USDT !== '0.00' ? balances.USDT : balances.ETH;

    return { address, balance, balances };
  } catch (err: any) {
    if (err.code === 4001 || err.code === 'ACTION_REJECTED') return null;
    console.error('[Wallet] Connection failed:', err);
    return null;
  }
}

// ─── Listen for account / chain changes ──────────────────────────────────────
export function watchWalletEvents(
  onAccountChange: (accounts: string[]) => void,
  onChainChange: (chainId: string) => void
) {
  const w = window as any;
  if (!w.ethereum) return () => {};

  w.ethereum.on('accountsChanged', onAccountChange);
  w.ethereum.on('chainChanged', onChainChange);

  return () => {
    w.ethereum.removeListener('accountsChanged', onAccountChange);
    w.ethereum.removeListener('chainChanged', onChainChange);
  };
}
