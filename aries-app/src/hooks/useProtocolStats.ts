import { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';

export interface ProtocolStats {
  totalMatches: number;
  activeMatches: number;
  loaded: boolean;
}

export const useProtocolStats = () => {
  const [stats, setStats] = useState<ProtocolStats>({
    totalMatches: 0,
    activeMatches: 0,
    loaded: false,
  });

  useEffect(() => {
    const statsRef = doc(db, 'protocol', 'stats');
    const unsubscribe = onSnapshot(statsRef, (snapshot) => {
      const data = snapshot.exists() ? snapshot.data() : {};
      setStats({
        totalMatches: typeof data.totalMatches === 'number' ? data.totalMatches : 0,
        activeMatches: typeof data.activeMatches === 'number' ? data.activeMatches : 0,
        loaded: true,
      });
    }, (error) => {
      console.error('[ProtocolStats] Could not load public counters:', error);
      setStats({ totalMatches: 0, activeMatches: 0, loaded: true });
    });
    return () => unsubscribe();
  }, []);

  return stats;
};
