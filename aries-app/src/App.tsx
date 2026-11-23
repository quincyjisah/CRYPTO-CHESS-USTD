import React, { lazy, Suspense, useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './lib/AuthContext';
import Header from './components/Header';
const Hub = lazy(() => import('./components/Hub'));
const Ledger = lazy(() => import('./components/Ledger'));
const ChessArena = lazy(() => import('./components/ChessArena'));
const Vault = lazy(() => import('./components/Vault'));
const CoinFlip = lazy(() => import('./components/CoinFlip'));
import Footer from './components/Footer';
const WalletModal = lazy(() => import('./components/WalletModal'));
const TournamentUI = lazy(() => import('./components/TournamentUI'));
const ReplayViewer = lazy(() => import('./components/ReplayViewer'));
import { playBgMusic, loadSavedPrefs } from './lib/audio';

export type ViewType = 'hub' | 'ledger' | 'chess' | 'vault' | 'coinflip' | 'tournament' | 'replay';

const MainApp = () => {
  const [currentView, setCurrentView] = useState<ViewType>('hub');
  const { user, showWalletModal, setShowWalletModal, connectWalletDirect } = useAuth();

  // Load audio prefs and start lobby music on first interaction
  useEffect(() => {
    loadSavedPrefs();
    const onFirstInteraction = () => {
      playBgMusic('lobby', 0.15);
      window.removeEventListener('click', onFirstInteraction);
      window.removeEventListener('keydown', onFirstInteraction);
    };
    window.addEventListener('click', onFirstInteraction);
    window.addEventListener('keydown', onFirstInteraction);
    return () => {
      window.removeEventListener('click', onFirstInteraction);
      window.removeEventListener('keydown', onFirstInteraction);
    };
  }, []);

  // Switch music track when navigating
  useEffect(() => {
    const gameViews: ViewType[] = ['chess', 'coinflip'];
    if (gameViews.includes(currentView)) {
      playBgMusic('game', 0.15);
    } else {
      playBgMusic('lobby', 0.15);
    }
  }, [currentView]);

  return (
    <div className={`min-h-screen flex flex-col font-sans text-stone-100 selection:bg-red-600 selection:text-white bg-[#050505] overflow-x-hidden ${currentView === 'hub' ? 'page-chess-bg' : ''}`}>
      <Header currentView={currentView} onNavigate={setCurrentView} />

      <main className="flex-1 pt-20 pb-48 px-4 max-w-7xl mx-auto w-full">
        <Suspense fallback={
          <div className="min-h-[45vh] grid place-items-center text-stone-400" role="status" aria-live="polite">
            Loading Aries workspace…
          </div>
        }>
          {currentView === 'hub' && <Hub onNavigate={setCurrentView} />}
          {currentView === 'ledger' && <Ledger onNavigate={setCurrentView} />}
          {currentView === 'chess' && <ChessArena onNavigate={setCurrentView} />}
          {currentView === 'vault' && <Vault onNavigate={setCurrentView} />}
          {currentView === 'coinflip' && <CoinFlip onNavigate={setCurrentView} />}
          {currentView === 'tournament' && <TournamentUI onNavigate={setCurrentView} />}
          {currentView === 'replay' && <ReplayViewer onClose={() => setCurrentView('hub')} playerId={user?.uid} />}
          {showWalletModal && (
            <WalletModal
              onClose={() => setShowWalletModal(false)}
              onConnected={async (address, balance) => {
                await connectWalletDirect(address, balance);
              }}
            />
          )}
        </Suspense>
      </main>

      <Footer />

    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}
