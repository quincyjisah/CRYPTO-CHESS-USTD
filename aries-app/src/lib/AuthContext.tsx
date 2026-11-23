import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, signInWithGoogle, signOutUser, onAuthStateChanged, User, signInAnonymously } from './firebase';
import { db } from './firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

interface AuthContextType {
  user: User | null;
  walletAddress: string | null;
  walletBalance: string | null;
  profile: any | null;
  dbRestricted: boolean;
  isLoading: boolean;
  showWalletModal: boolean;
  loginGoogle: () => Promise<void>;
  loginWallet: () => Promise<void>;          // opens the modal
  connectWalletDirect: (address: string, balance: string) => Promise<void>; // called by modal
  refreshBalance: () => Promise<string | null>;
  updateProfile: (data: any) => Promise<void>;
  logout: () => Promise<void>;
  setShowWalletModal: (v: boolean) => void;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [dbRestricted, setDbRestricted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showWalletModal, setShowWalletModal] = useState(false);

  // ─── Firebase Auth listener ──────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const ref = doc(db, 'profiles', currentUser.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          setProfile(snap.data());
        } else {
          // Sanitize Google displayName into a valid handle
          const rawName = currentUser.displayName || '';
          const sanitizedHandle = rawName
            .replace(/[^a-zA-Z0-9_]/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 32);
          const handle = sanitizedHandle.length >= 3
            ? sanitizedHandle
            : ('OPERATIVE_' + currentUser.uid.slice(0, 5));

          const initialProfile = {
            id: currentUser.uid,
            handle,
            avatar: currentUser.photoURL || `https://picsum.photos/seed/${currentUser.uid}/200`,
            rank: 'Recruit',
            exp: 0,
            matches: 0,
            victories: 0,
            wins: 0,
            losses: 0,
            profit: 0,
            rating: 1500,
            rd: 350,
            volatility: 0.06,
            ratingBand: 'Unrated',
            joinedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          await setDoc(ref, initialProfile);
          setProfile(initialProfile);
        }
      } else {
        setProfile(null);
      }
      setIsLoading(false);
    });
    return () => unsub();
  }, []);

  // ─── Google login ────────────────────────────────────────────────────────
  const loginGoogle = async () => { await signInWithGoogle(); };

  // ─── Wallet login — opens the modal ─────────────────────────────────────
  const loginWallet = async () => { setShowWalletModal(true); };

  // ─── Called by WalletModal once a wallet is connected ───────────────────
  const connectWalletDirect = async (address: string, balance: string) => {
    // Wallet data is read locally only. Persisting an address as verified
    // identity requires a server-verified signature challenge (not implemented).
    setWalletAddress(address);
    setWalletBalance(balance);

    if (!auth.currentUser) {
      try {
        await signInAnonymously(auth);
      } catch (error: any) {
        console.warn('[Auth] Anonymous sign-in failed — DB features limited:', error.message);
        setDbRestricted(true);
      }
    }
  };

  // ─── Watch wallet account/chain changes ──────────────────────────────────────
  useEffect(() => {
    if (!walletAddress) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    void import('./ethers')
      .then(({ watchWalletEvents, getAllBalances }) => {
        if (disposed) return;
        cleanup = watchWalletEvents(
          async (accounts) => {
            if (accounts.length === 0) {
              setWalletAddress(null);
              setWalletBalance(null);
              return;
            }

            setWalletAddress(accounts[0]);
            const balances = await getAllBalances(accounts[0]);
            setWalletBalance(balances.USDT !== '0.00' ? balances.USDT : balances.ETH);
          },
          (chainId) => {
            const id = parseInt(chainId, 16);
            if (id !== 1) {
              alert('Wallet switched to a non-Mainnet network. Please switch back to Ethereum Mainnet.');
            }
          },
        );
      })
      .catch((error: unknown) => {
        console.warn('[Auth] Wallet monitoring could not be loaded:', error);
      });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [walletAddress]);

  // ─── Refresh balance ─────────────────────────────────────────────────────
  const refreshBalance = async (): Promise<string | null> => {
    if (!walletAddress) return walletBalance;
    try {
      const { ethers } = await import('ethers');
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
      const abi = ['function balanceOf(address) view returns (uint256)'];
      const contract = new ethers.Contract(USDT, abi, provider);
      const raw = await contract.balanceOf(walletAddress);
      const bal = parseFloat(ethers.formatUnits(raw, 6)).toFixed(2);
      setWalletBalance(bal);
      return bal;
    } catch {
      return walletBalance;
    }
  };

  // ─── Update profile ──────────────────────────────────────────────────────
  const updateProfile = async (data: any) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const ref = doc(db, 'profiles', uid);
    await setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true });
    setProfile((prev: any) => ({ ...prev, ...data }));
  };

  // ─── Logout ──────────────────────────────────────────────────────────────
  const logout = async () => {
    await signOutUser();
    setWalletAddress(null);
    setWalletBalance(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{
      user, walletAddress, walletBalance, profile,
      dbRestricted, isLoading, showWalletModal,
      loginGoogle, loginWallet, connectWalletDirect,
      refreshBalance, updateProfile, logout, setShowWalletModal
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
