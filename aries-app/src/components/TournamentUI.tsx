import React, { useState, useEffect, useCallback } from 'react';
import { ViewType } from '../App';
import { useAuth } from '../lib/AuthContext';
import { db } from '../lib/firebase';
import {
  collection, doc, getDoc, getDocs, onSnapshot,
  setDoc, serverTimestamp, query, where, orderBy, limit
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { rateLimits } from '../lib/security';
import RatingBadge from './RatingBadge';
import AdBanner from './AdBanner';
import {
  Trophy, Users, Clock, ChevronRight, Crown,
  Loader2, AlertTriangle, Calendar, Swords,
  Star, Lock, CheckCircle2, XCircle, Medal
} from 'lucide-react';

// ─── Types (mirrored from backend) ───────────────────────────────────────────

type TournamentFormat  = 'swiss' | 'round_robin' | 'elimination' | 'arena';
type TournamentStatus  = 'upcoming' | 'registration' | 'active' | 'completed';

interface Tournament {
  id:          string;
  name:        string;
  format:      TournamentFormat;
  status:      TournamentStatus;
  entryFee:    number;
  currency:    string;
  prizePool:   number;
  maxPlayers:  number;
  players:     string[];
  rounds:      TournamentRound[];
  startsAt:    number;
  endsAt:      number | null;
  timeControl: string;
  createdBy:   string;
}

interface TournamentRound {
  roundNumber:  number;
  pairings:     TournamentPairing[];
  startedAt:    number | null;
  completedAt:  number | null;
}

interface TournamentPairing {
  gameId:    string;
  whiteUid:  string;
  blackUid:  string;
  result:    'white' | 'black' | 'draw' | 'bye' | null;
}

interface Standing {
  rank:    number;
  uid:     string;
  handle:  string;
  points:  number;
  rating?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FORMAT_LABELS: Record<TournamentFormat, string> = {
  swiss:        'Swiss',
  round_robin:  'Round Robin',
  elimination:  'Elimination',
  arena:        'Arena',
};

const FORMAT_DESCRIPTIONS: Record<TournamentFormat, string> = {
  swiss:        'Paired by score each round. Buchholz tiebreak.',
  round_robin:  'Everyone plays everyone. Most points wins.',
  elimination:  'Single bracket. Lose once and you\'re out.',
  arena:        'Continuous pairing. Score as many points in time.',
};

const STATUS_COLORS: Record<TournamentStatus, string> = {
  upcoming:     'bg-zinc-800 text-zinc-400 border-zinc-700',
  registration: 'bg-green-500/10 text-green-400 border-green-500/30',
  active:       'bg-red-600/10 text-red-400 border-red-500/30',
  completed:    'bg-blue-600/10 text-blue-400 border-blue-500/30',
};


// ─── Cloud Function callers ───────────────────────────────────────────────────

const functions = getFunctions(undefined, 'us-central1');
const registerPlayerFn  = httpsCallable(functions, 'registerTournamentPlayer');
const startTournamentFn = httpsCallable(functions, 'startTournament');
const createTournamentFn = httpsCallable(functions, 'createTournament');

// ─── Main component ───────────────────────────────────────────────────────────

interface TournamentUIProps {
  onNavigate: (view: ViewType) => void;
}

export default function TournamentUI({ onNavigate }: TournamentUIProps) {
  const { user, profile, loginWallet } = useAuth();
  const uid = user?.uid || null;

  const [view,               setView]               = useState<'list' | 'detail'>('list');
  const [tournaments,        setTournaments]         = useState<Tournament[]>([]);
  const [selected,           setSelected]            = useState<Tournament | null>(null);
  const [standings,          setStandings]           = useState<Standing[]>([]);
  const [handles,            setHandles]             = useState<Map<string, string>>(new Map());
  const [statusFilter,       setStatusFilter]        = useState<TournamentStatus | 'all'>('registration');
  const [registering,        setRegistering]         = useState(false);
  const [registerError,      setRegisterError]       = useState<string | null>(null);
  const [loading,            setLoading]             = useState(true);
  const [activeRound,        setActiveRound]         = useState(0);
  const [showCreate,         setShowCreate]          = useState(false);
  const [creating,           setCreating]            = useState(false);
  const [createError,        setCreateError]         = useState<string | null>(null);
  const [createForm,         setCreateForm]          = useState({
    name:        '',
    format:      'swiss' as TournamentFormat,
    entryFee:    0,
    currency:    'FREE',
    maxPlayers:  16,
    timeControl: 'blitz',
    startsAt:    new Date(Date.now() + 86400000).toISOString().slice(0, 16),
  });

  const isRegistered = selected && uid ? selected.players.includes(uid) : false;

  // ─── Load tournament list ────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);

    const statuses: TournamentStatus[] = statusFilter === 'all'
      ? ['upcoming', 'registration', 'active', 'completed']
      : [statusFilter];

    const unsubscribers: (() => void)[] = [];
    const tournamentMap = new Map<string, Tournament>();

    statuses.forEach(status => {
      const q = query(
        collection(db, 'tournaments'),
        where('status', '==', status),
        orderBy('startsAt', 'desc'),
        limit(20)
      );

      const unsub = onSnapshot(q, (snap) => {
        snap.docs.forEach(d => {
          const tournament = d.data() as Tournament;
          if (tournament.entryFee !== 0 || tournament.currency !== 'FREE') return;
          tournamentMap.set(d.id, { id: d.id, ...tournament });
        });
        const sorted = [...tournamentMap.values()].sort((a, b) => b.startsAt - a.startsAt);
        setTournaments(sorted);
        setLoading(false);
      });

      unsubscribers.push(unsub);
    });

    return () => unsubscribers.forEach(u => u());
  }, [statusFilter]);

  // ─── Subscribe to selected tournament ───────────────────────────────────
  useEffect(() => {
    if (!selected?.id) return;

    const unsub = onSnapshot(doc(db, 'tournaments', selected.id), (snap) => {
      if (!snap.exists()) return;
      const updated = { id: snap.id, ...snap.data() } as Tournament;
      setSelected(updated);
      computeStandings(updated);
    });

    return () => unsub();
  }, [selected?.id]);

  // ─── Fetch player handles for bracket display ────────────────────────────
  const fetchHandles = useCallback(async (uids: string[]) => {
    const missing = uids.filter(u => u && u !== 'bye' && !handles.has(u));
    if (missing.length === 0) return;

    const fetched = new Map<string, string>(handles);
    await Promise.all(
      missing.map(async (uid) => {
        try {
          const snap = await getDoc(doc(db, 'profiles_public', uid));
          fetched.set(uid, snap.data()?.handle || uid.slice(0, 8));
        } catch {
          fetched.set(uid, uid.slice(0, 8));
        }
      })
    );
    setHandles(fetched);
  }, [handles]);

  useEffect(() => {
    if (!selected) return;
    const allUids = selected.players;
    fetchHandles(allUids);
  }, [selected?.players?.length]);

  // ─── Compute standings ────────────────────────────────────────────────────
  const computeStandings = (t: Tournament) => {
    const points = new Map<string, number>();
    t.players.forEach(uid => points.set(uid, 0));

    t.rounds.forEach(round => {
      round.pairings.forEach(p => {
        if (p.result === 'white')  { points.set(p.whiteUid, (points.get(p.whiteUid) || 0) + 1); }
        if (p.result === 'black')  { points.set(p.blackUid, (points.get(p.blackUid) || 0) + 1); }
        if (p.result === 'draw')   {
          points.set(p.whiteUid, (points.get(p.whiteUid) || 0) + 0.5);
          points.set(p.blackUid, (points.get(p.blackUid) || 0) + 0.5);
        }
        if (p.result === 'bye')    { points.set(p.whiteUid, (points.get(p.whiteUid) || 0) + 1); }
      });
    });

    const sorted = [...points.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([uid, pts], i) => ({
        rank:   i + 1,
        uid,
        handle: handles.get(uid) || uid.slice(0, 8),
        points: pts,
      }));

    setStandings(sorted);
  };

  // ─── Register for tournament ──────────────────────────────────────────────
  const handleCreate = async () => {
    if (!uid) { loginWallet(); return; }
    if (!createForm.name.trim()) { setCreateError('Tournament name is required.'); return; }
    setCreating(true);
    setCreateError(null);
    try {
      const result: any = await createTournamentFn({
        ...createForm,
        startsAt:  new Date(createForm.startsAt).getTime(),
        entryFee:  Number(createForm.entryFee),
        maxPlayers: Number(createForm.maxPlayers),
      });
      if (result.data?.ok) {
        setShowCreate(false);
        setStatusFilter('registration');
      } else {
        setCreateError(result.data?.reason || 'Failed to create tournament.');
      }
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create tournament.');
    } finally {
      setCreating(false);
    }
  };

  const handleRegister = async () => {
    if (!uid) { loginWallet(); return; }
    if (!selected) return;

    if (!rateLimits.wager(uid)) {
      setRegisterError('Too many attempts. Please wait a moment.');
      return;
    }

    setRegistering(true);
    setRegisterError(null);

    try {
      const result: any = await registerPlayerFn({
        tournamentId: selected.id,
        uid,
      });

      if (!result.data?.ok) {
        setRegisterError(result.data?.reason || 'Registration failed.');
      }
    } catch (err: any) {
      setRegisterError(err.message || 'Registration failed. Please try again.');
    } finally {
      setRegistering(false);
    }
  };

  // ─── Open tournament detail ───────────────────────────────────────────────
  const openTournament = (t: Tournament) => {
    setSelected(t);
    setActiveRound(Math.max(0, t.rounds.length - 1));
    setView('detail');
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const formatDate = (ts: number) => new Date(ts).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const formatCountdown = (ts: number) => {
    const diff = ts - Date.now();
    if (diff <= 0) return 'Starting now';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
    return `${h}h ${m}m`;
  };

  // ─── Render: Tournament List ──────────────────────────────────────────────
  if (view === 'list') {
    return (
      <section className="animate-in fade-in duration-300 pb-20">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
          <div>
            <button onClick={() => onNavigate('hub')}
              className="text-[9px] font-black text-zinc-500 hover:text-white uppercase tracking-widest mb-2">
              ← Hub
            </button>
            <h2 className="text-3xl font-black italic uppercase drop-shadow-[0_0_10px_rgba(255,31,31,0.4)]">
              Tournaments
            </h2>
            <p className="text-xs text-zinc-400 font-mono mt-1">
              Compete, climb and improve your rating. Current tournaments are free-play only.
            </p>
          </div>

          {/* Status filter */}
          <div className="flex gap-1.5 flex-wrap">
            {(['all', 'registration', 'active', 'upcoming', 'completed'] as const).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest border transition-all ${
                  statusFilter === s
                    ? 'bg-red-600 text-white border-red-600'
                    : 'bg-white/5 text-zinc-400 border-white/10 hover:border-white/20'
                }`}>
                {s === 'all' ? 'All' : s}
              </button>
            ))}
          </div>

          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-yellow-600/20 border border-yellow-500/30 text-yellow-400 px-3 py-1.5 rounded-lg text-[8px] font-black uppercase hover:bg-yellow-600/30 transition-all">
            + Create Tournament
          </button>
        </div>

        {/* Create Tournament Modal */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={() => setShowCreate(false)} />
            <div className="glass w-full max-w-md p-6 rounded-3xl relative z-10 border border-white/10 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
              <button onClick={() => setShowCreate(false)} className="absolute top-4 right-4 text-zinc-500 hover:text-white">✕</button>
              <h3 className="text-lg font-black italic uppercase text-white mb-5">Create Tournament</h3>

              <div className="space-y-3">
                <div>
                  <label className="text-[8px] font-black text-zinc-500 uppercase mb-1 block">Name</label>
                  <input type="text" maxLength={64} value={createForm.name}
                    onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full bg-black/50 border border-white/10 text-white p-2.5 rounded-lg text-[11px] font-mono focus:outline-none focus:border-yellow-500"
                    placeholder="Aries Weekly Blitz #1" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[8px] font-black text-zinc-500 uppercase mb-1 block">Format</label>
                    <select value={createForm.format} onChange={e => setCreateForm(f => ({ ...f, format: e.target.value as TournamentFormat }))}
                      className="w-full bg-black/50 border border-white/10 text-white p-2.5 rounded-lg text-[10px] font-mono focus:outline-none focus:border-yellow-500">
                      <option value="swiss">Swiss</option>
                      <option value="round_robin">Round Robin</option>
                      <option value="elimination">Elimination</option>
                      <option value="arena">Arena</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[8px] font-black text-zinc-500 uppercase mb-1 block">Time Control</label>
                    <select value={createForm.timeControl} onChange={e => setCreateForm(f => ({ ...f, timeControl: e.target.value }))}
                      className="w-full bg-black/50 border border-white/10 text-white p-2.5 rounded-lg text-[10px] font-mono focus:outline-none focus:border-yellow-500">
                      <option value="bullet">Bullet (1+0)</option>
                      <option value="blitz">Blitz (3+2)</option>
                      <option value="rapid">Rapid (10+5)</option>
                      <option value="classical">Classical (30+0)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[8px] font-black text-zinc-500 uppercase mb-1 block">Entry Fee (disabled)</label>
                    <div className="flex gap-1.5">
                      <input type="number" min="0" max="0" value={0} disabled
                        onChange={e => setCreateForm(f => ({ ...f, entryFee: Number(e.target.value) }))}
                        className="flex-1 bg-black/50 border border-white/10 text-white p-2.5 rounded-lg text-[10px] font-mono focus:outline-none focus:border-yellow-500" />
                      <span className="bg-black/50 border border-white/10 text-zinc-400 px-3 py-2.5 rounded-lg text-[9px] font-mono">FREE</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[8px] font-black text-zinc-500 uppercase mb-1 block">Max Players</label>
                    <select value={createForm.maxPlayers} onChange={e => setCreateForm(f => ({ ...f, maxPlayers: Number(e.target.value) }))}
                      className="w-full bg-black/50 border border-white/10 text-white p-2.5 rounded-lg text-[10px] font-mono focus:outline-none focus:border-yellow-500">
                      {[4,8,16,32,64,128].map(n => <option key={n} value={n}>{n} players</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[8px] font-black text-zinc-500 uppercase mb-1 block">Start Date & Time</label>
                  <input type="datetime-local" value={createForm.startsAt}
                    onChange={e => setCreateForm(f => ({ ...f, startsAt: e.target.value }))}
                    className="w-full bg-black/50 border border-white/10 text-white p-2.5 rounded-lg text-[10px] font-mono focus:outline-none focus:border-yellow-500" />
                </div>


                {createError && <p className="text-[8px] text-red-400 font-mono">{createError}</p>}

                <button onClick={handleCreate} disabled={creating}
                  className="w-full bg-yellow-600 hover:bg-yellow-500 disabled:bg-zinc-700 text-black font-black text-[10px] uppercase tracking-widest py-3 rounded-xl transition-all flex items-center justify-center gap-2">
                  {creating ? <Loader2 className="w-4 h-4 animate-spin text-black" /> : <Trophy className="w-4 h-4" />}
                  {creating ? 'Creating...' : 'Create Tournament'}
                </button>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-48 gap-3">
            <Loader2 className="w-6 h-6 text-red-500 animate-spin" />
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Loading tournaments...</p>
          </div>
        ) : tournaments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <Trophy className="w-10 h-10 text-zinc-700" />
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest">No tournaments found.</p>
            <p className="text-[8px] text-zinc-600 font-mono">Check back soon or change the filter.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {tournaments.map(t => (
              <button key={t.id} onClick={() => openTournament(t)}
                className="glass border border-white/10 hover:border-white/20 rounded-2xl p-5 text-left transition-all hover:bg-white/5 group">

                {/* Header row */}
                <div className="flex justify-between items-start mb-3">
                  <span className={`text-[7px] font-black uppercase px-2 py-1 rounded border tracking-widest ${STATUS_COLORS[t.status]}`}>
                    {t.status === 'active' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse mr-1" />}
                    {t.status}
                  </span>
                  <span className="text-[8px] text-zinc-500 font-mono">{FORMAT_LABELS[t.format]}</span>
                </div>

                {/* Name */}
                <h3 className="text-sm font-black text-white uppercase tracking-tight mb-1 group-hover:text-red-400 transition-colors">
                  {t.name}
                </h3>
                <p className="text-[8px] text-zinc-500 font-mono mb-4">{FORMAT_DESCRIPTIONS[t.format]}</p>

                {/* Stats grid */}
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="bg-black/40 rounded-lg p-2 text-center">
                    <p className="text-[7px] text-zinc-500 uppercase font-black">Prize</p>
                    <p className="text-[10px] font-black text-green-400 font-mono">
                      No cash prizes
                    </p>
                  </div>
                  <div className="bg-black/40 rounded-lg p-2 text-center">
                    <p className="text-[7px] text-zinc-500 uppercase font-black">Players</p>
                    <p className="text-[10px] font-black text-white font-mono">
                      {t.players.length}/{t.maxPlayers}
                    </p>
                  </div>
                  <div className="bg-black/40 rounded-lg p-2 text-center">
                    <p className="text-[7px] text-zinc-500 uppercase font-black">Entry</p>
                    <p className="text-[10px] font-black text-white font-mono">
                      Free
                    </p>
                  </div>
                </div>

                {/* Time */}
                <div className="flex items-center gap-2 text-[8px] font-mono text-zinc-500">
                  <Calendar className="w-3 h-3" />
                  {t.status === 'upcoming' || t.status === 'registration'
                    ? <span>Starts {formatDate(t.startsAt)} · <span className="text-yellow-400">{formatCountdown(t.startsAt)}</span></span>
                    : t.status === 'completed' && t.endsAt
                    ? <span>Ended {formatDate(t.endsAt)}</span>
                    : <span className="text-red-400">● Live now</span>
                  }
                </div>

                {/* Progress bar */}
                <div className="mt-3 bg-zinc-900 rounded-full h-1 overflow-hidden">
                  <div className="bg-red-600 h-full transition-all"
                    style={{ width: `${(t.players.length / t.maxPlayers) * 100}%` }} />
                </div>

                <div className="flex justify-end mt-2">
                  <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-white transition-colors" />
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="mt-8"><AdBanner format="banner" /></div>
      </section>
    );
  }

  // ─── Render: Tournament Detail ────────────────────────────────────────────
  if (!selected) return null;

  const currentRound = selected.rounds[activeRound];
  const totalRounds  = selected.rounds.length;

  return (
    <section className="animate-in fade-in duration-300 pb-20">

      {/* Back button */}
      <button onClick={() => { setView('list'); setSelected(null); }}
        className="text-[9px] font-black text-zinc-500 hover:text-white uppercase tracking-widest mb-4">
        ← Back to Tournaments
      </button>

      {/* Header */}
      <div className="glass border border-white/10 rounded-2xl p-6 mb-6">
        <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <span className={`text-[7px] font-black uppercase px-2 py-1 rounded border tracking-widest ${STATUS_COLORS[selected.status]}`}>
                {selected.status === 'active' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse mr-1" />}
                {selected.status}
              </span>
              <span className="text-[8px] text-zinc-500 font-mono">{FORMAT_LABELS[selected.format]}</span>
            </div>
            <h2 className="text-2xl font-black italic uppercase text-white mb-1">{selected.name}</h2>
            <p className="text-[8px] text-zinc-500 font-mono">{FORMAT_DESCRIPTIONS[selected.format]}</p>
          </div>

          {/* Registration CTA */}
          <div className="flex flex-col items-end gap-2">
            {selected.status === 'registration' && !isRegistered && (
              <div className="space-y-2">
                <button onClick={handleRegister} disabled={registering}
                  className="flex items-center gap-2 bg-red-600 hover:bg-red-500 disabled:bg-zinc-700 text-white font-black text-[10px] uppercase tracking-widest px-5 py-2.5 rounded-xl transition-all">
                  {registering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Swords className="w-4 h-4" />}
                  {registering ? 'Registering...' : 'Register (Free)'}
                </button>
                {registerError && (
                  <p className="text-[8px] text-red-400 font-mono text-right">{registerError}</p>
                )}
              </div>
            )}
            {isRegistered && selected.status === 'registration' && (
              <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 text-green-400 text-[9px] font-black uppercase px-4 py-2 rounded-xl">
                <CheckCircle2 className="w-4 h-4" /> Registered
              </div>
            )}
            {!uid && selected.status === 'registration' && (
              <button onClick={loginWallet}
                className="flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-black text-[9px] uppercase px-4 py-2 rounded-xl transition-all">
                Sign in to Register
              </button>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {[
            { label: 'Prize Pool',  value: 'No cash prizes',   icon: <Trophy className="w-4 h-4 text-yellow-400" /> },
            { label: 'Players',     value: `${selected.players.length} / ${selected.maxPlayers}`,                             icon: <Users  className="w-4 h-4 text-blue-400"   /> },
            { label: 'Entry Fee',   value: 'Free',              icon: <Star   className="w-4 h-4 text-green-400"  /> },
            { label: 'Time Control',value: selected.timeControl,                                                              icon: <Clock  className="w-4 h-4 text-zinc-400"   /> },
          ].map(s => (
            <div key={s.label} className="bg-black/40 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">{s.icon}<p className="text-[7px] text-zinc-500 uppercase font-black">{s.label}</p></div>
              <p className="text-[11px] font-black text-white font-mono">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Player fill progress */}
        <div className="mt-3">
          <div className="bg-zinc-900 rounded-full h-1.5 overflow-hidden">
            <div className="bg-red-600 h-full transition-all duration-700"
              style={{ width: `${(selected.players.length / selected.maxPlayers) * 100}%` }} />
          </div>
          <p className="text-[7px] text-zinc-600 font-mono mt-1">
            {selected.maxPlayers - selected.players.length} spots remaining
          </p>
        </div>
      </div>

      {/* Main content: Bracket + Standings + Prize */}
      <div className="flex flex-col xl:flex-row gap-6">

        {/* ── Bracket / Rounds ─────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          {selected.rounds.length === 0 ? (
            <div className="glass border border-white/10 rounded-2xl p-8 text-center">
              <Lock className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
              <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest">
                {selected.status === 'registration' ? 'Bracket generated at start' : 'No rounds yet'}
              </p>
              <p className="text-[8px] text-zinc-600 font-mono mt-1">
                {selected.status === 'registration'
                  ? `Waiting for ${selected.maxPlayers - selected.players.length} more player${selected.maxPlayers - selected.players.length !== 1 ? 's' : ''}`
                  : 'Tournament will begin soon'}
              </p>
            </div>
          ) : (
            <div className="glass border border-white/10 rounded-2xl overflow-hidden">
              {/* Round tabs */}
              <div className="flex overflow-x-auto border-b border-white/5 bg-black/20">
                {selected.rounds.map((r, i) => (
                  <button key={i} onClick={() => setActiveRound(i)}
                    className={`flex-shrink-0 px-4 py-3 text-[8px] font-black uppercase tracking-widest transition-colors border-b-2 ${
                      activeRound === i
                        ? 'border-red-500 text-white'
                        : 'border-transparent text-zinc-500 hover:text-zinc-300'
                    }`}>
                    Round {r.roundNumber}
                    {r.completedAt && <CheckCircle2 className="w-3 h-3 inline ml-1 text-green-500" />}
                  </button>
                ))}
              </div>

              {/* Pairings */}
              {currentRound && (
                <div className="p-4 space-y-2">
                  {currentRound.pairings.map((pairing, i) => {
                    const whiteHandle = pairing.whiteUid === 'bye' ? 'BYE' : (handles.get(pairing.whiteUid) || pairing.whiteUid.slice(0, 8));
                    const blackHandle = pairing.blackUid === 'bye' ? 'BYE' : (handles.get(pairing.blackUid) || pairing.blackUid.slice(0, 8));
                    const isMyGame    = uid && (pairing.whiteUid === uid || pairing.blackUid === uid);

                    return (
                      <div key={i}
                        className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                          isMyGame
                            ? 'bg-red-600/10 border-red-500/30'
                            : 'bg-white/2 border-white/5 hover:bg-white/5'
                        }`}>

                        {/* White player */}
                        <div className="flex-1 flex items-center gap-2 min-w-0">
                          <div className="w-5 h-5 rounded bg-white flex items-center justify-center text-[8px] text-black shrink-0">♔</div>
                          <span className={`text-[10px] font-mono truncate ${pairing.result === 'white' ? 'text-white font-black' : 'text-zinc-300'}`}>
                            {whiteHandle}
                            {pairing.whiteUid === uid && <span className="ml-1 text-[7px] text-red-400">(you)</span>}
                          </span>
                        </div>

                        {/* Result */}
                        <div className="shrink-0 w-16 text-center">
                          {pairing.result === null ? (
                            <span className="text-[9px] text-zinc-600 font-mono">vs</span>
                          ) : pairing.result === 'draw' ? (
                            <span className="text-[9px] text-zinc-400 font-black">½-½</span>
                          ) : pairing.result === 'bye' ? (
                            <span className="text-[9px] text-zinc-500 font-mono">BYE</span>
                          ) : (
                            <div className="flex items-center justify-center gap-1">
                              <span className={`text-[9px] font-black ${pairing.result === 'white' ? 'text-white' : 'text-zinc-600'}`}>1</span>
                              <span className="text-[8px] text-zinc-600">-</span>
                              <span className={`text-[9px] font-black ${pairing.result === 'black' ? 'text-white' : 'text-zinc-600'}`}>0</span>
                            </div>
                          )}
                        </div>

                        {/* Black player */}
                        <div className="flex-1 flex items-center justify-end gap-2 min-w-0">
                          <span className={`text-[10px] font-mono truncate text-right ${pairing.result === 'black' ? 'text-white font-black' : 'text-zinc-300'}`}>
                            {pairing.blackUid === uid && <span className="mr-1 text-[7px] text-red-400">(you)</span>}
                            {blackHandle}
                          </span>
                          <div className="w-5 h-5 rounded bg-zinc-800 border border-zinc-600 flex items-center justify-center text-[8px] shrink-0">♚</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right column: Standings + Prize ──────────────────────────── */}
        <div className="xl:w-72 space-y-4 shrink-0">

          <div className="glass border border-white/10 rounded-2xl p-3">
            <p className="text-[9px] font-black text-zinc-400 uppercase">Prize Policy</p>
            <p className="text-[8px] font-mono text-zinc-500 mt-1">Free-play competition only. No cash or token prizes are collected or paid.</p>
          </div>

          {/* Live standings */}
          {(selected.status === 'active' || selected.status === 'completed') && standings.length > 0 && (
            <div className="glass border border-white/10 rounded-2xl overflow-hidden">
              <div className="p-3 border-b border-white/5 bg-black/20 flex justify-between items-center">
                <p className="text-[9px] font-black text-zinc-400 uppercase">Standings</p>
                {selected.status === 'active' && (
                  <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-[7px] text-red-400 font-mono uppercase">Live</span>
                  </div>
                )}
              </div>
              <div className="p-2 space-y-1 max-h-80 overflow-y-auto custom-scrollbar">
                {standings.map((s) => (
                  <div key={s.uid}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${
                      s.uid === uid ? 'bg-red-600/10 border border-red-500/20' : 'hover:bg-white/5'
                    }`}>

                    <span className={`text-[9px] font-black w-5 text-center shrink-0 ${
                      s.rank === 1 ? 'text-yellow-400' :
                      s.rank === 2 ? 'text-zinc-300' :
                      s.rank === 3 ? 'text-amber-600' : 'text-zinc-600'
                    }`}>#{s.rank}</span>

                    <span className="text-[9px] font-mono text-zinc-200 flex-1 truncate">
                      {s.handle}
                      {s.uid === uid && <span className="text-[7px] text-red-400 ml-1">(you)</span>}
                    </span>

                    <span className="text-[10px] font-black text-white font-mono shrink-0">
                      {s.points % 1 === 0 ? s.points.toFixed(0) : s.points.toFixed(1)}pt
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Registered players (during registration) */}
          {selected.status === 'registration' && selected.players.length > 0 && (
            <div className="glass border border-white/10 rounded-2xl overflow-hidden">
              <div className="p-3 border-b border-white/5 bg-black/20">
                <p className="text-[9px] font-black text-zinc-400 uppercase">
                  Registered ({selected.players.length})
                </p>
              </div>
              <div className="p-2 space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
                {selected.players.map((playerUid) => (
                  <div key={playerUid} className="flex items-center gap-2 px-2 py-1 rounded text-[9px] font-mono text-zinc-400">
                    <Users className="w-3 h-3 text-zinc-600 shrink-0" />
                    <span className="truncate">
                      {handles.get(playerUid) || playerUid.slice(0, 10)}
                      {playerUid === uid && <span className="text-red-400 ml-1">(you)</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <AdBanner format="square" />
        </div>
      </div>
    </section>
  );
}
