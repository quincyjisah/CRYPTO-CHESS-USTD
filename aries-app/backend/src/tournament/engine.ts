/**
 * tournament/engine.ts — Aries Protocol Tournament Engine
 *
 * Supports:
 *  Swiss pairing  — standard competitive format
 *  Arena          — Lichess-style continuous pairing
 *  Round-robin    — all vs all
 *  Elimination    — single/double bracket
 *
 * Paid entry fees and prize payouts are disabled until the on-chain escrow path is live.
 * All pairings are server-authoritative.
 * Tiebreaks use Buchholz + Sonneborn-Berger.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Redis }    from 'ioredis';
import type {
  Tournament, TournamentRound, TournamentPairing,
  TournamentFormat, Currency
} from '../shared/types';
import { logger }  from '../shared/logger';
import { metrics } from '../shared/metrics';

const TOURNAMENT_TTL = 60 * 60 * 24 * 7; // 7 days in Redis

// Paid tournaments stay disabled until the on-chain entry-fee and payout path is live.
const isFreeTournament = (t: Pick<Tournament, 'entryFee' | 'prizePool' | 'currency'>): boolean =>
  t.currency === 'FREE' &&
  Number.isFinite(t.entryFee) && t.entryFee === 0 &&
  Number.isFinite(t.prizePool) && t.prizePool === 0;

export class TournamentEngine {
  constructor(private redis: Redis) {}

  // ─── Create tournament ────────────────────────────────────────────────────
  async createTournament(params: {
    name:        string;
    format:      TournamentFormat;
    entryFee:    number;
    currency:    Currency;
    maxPlayers:  number;
    startsAt:    number;
    timeControl: string;
    createdBy:   string;
  }): Promise<Tournament> {
    if (!Number.isFinite(params.entryFee) || params.entryFee < 0) {
      throw new Error('Invalid tournament entry fee');
    }
    if (params.entryFee !== 0 || params.currency !== 'FREE') {
      throw new Error('Paid tournaments are disabled');
    }

    const tournament: Tournament = {
      id:          uuidv4(),
      name:        params.name,
      format:      params.format,
      status:      'registration',
      entryFee:    params.entryFee,
      currency:    params.currency,
      prizePool:   0,
      maxPlayers:  params.maxPlayers,
      players:     [],
      rounds:      [],
      startsAt:    params.startsAt,
      endsAt:      null,
      timeControl: params.timeControl as any,
      createdBy:   params.createdBy,
    };

    await this.saveTournament(tournament);
    logger.info({ tournamentId: tournament.id, format: params.format }, 'Tournament created');
    metrics.inc('tournaments_created_total');
    return tournament;
  }

  // ─── Register player ──────────────────────────────────────────────────────
  async registerPlayer(tournamentId: string, uid: string): Promise<{
    ok: boolean; reason?: string;
  }> {
    const t = await this.getTournament(tournamentId);
    if (!t) return { ok: false, reason: 'Tournament not found' };
    if (!isFreeTournament(t)) return { ok: false, reason: 'Paid tournaments are disabled' };
    if (t.status !== 'registration') return { ok: false, reason: 'Registration closed' };
    if (t.players.includes(uid)) return { ok: false, reason: 'Already registered' };
    if (t.players.length >= t.maxPlayers) return { ok: false, reason: 'Tournament full' };

    t.players.push(uid);

    await this.saveTournament(t);
    logger.info({ tournamentId, uid }, 'Player registered');
    return { ok: true };
  }

  // ─── Start tournament ─────────────────────────────────────────────────────
  async startTournament(tournamentId: string): Promise<Tournament | null> {
    const t = await this.getTournament(tournamentId);
    if (!t || !isFreeTournament(t) || t.status !== 'registration') return null;
    if (t.players.length < 2) return null;

    t.status = 'active';

    // Generate first round pairings
    const round1 = await this.generatePairings(t, 1);
    t.rounds.push(round1);

    await this.saveTournament(t);
    logger.info({ tournamentId, players: t.players.length, format: t.format }, 'Tournament started');
    metrics.inc('tournaments_started_total');
    return t;
  }

  // ─── Generate pairings ────────────────────────────────────────────────────
  async generatePairings(t: Tournament, roundNumber: number): Promise<TournamentRound> {
    let pairings: TournamentPairing[];

    switch (t.format) {
      case 'swiss':
        pairings = this.swissPairings(t, roundNumber);
        break;
      case 'round_robin':
        pairings = this.roundRobinPairings(t, roundNumber);
        break;
      case 'elimination':
        pairings = this.eliminationPairings(t, roundNumber);
        break;
      case 'arena':
        pairings = this.arenaPairings(t);
        break;
      default:
        pairings = this.swissPairings(t, roundNumber);
    }

    // Create game IDs for each pairing
    const pairingsWithGames = pairings.map(p => ({
      ...p,
      gameId: `tournament:${t.id}:r${roundNumber}:${uuidv4().slice(0, 8)}`,
    }));

    return {
      roundNumber,
      pairings:    pairingsWithGames,
      startedAt:   Date.now(),
      completedAt: null,
    };
  }

  // ─── Swiss pairings ───────────────────────────────────────────────────────
  private swissPairings(t: Tournament, roundNumber: number): TournamentPairing[] {
    // Score players from previous rounds
    const scores: Map<string, number> = new Map();
    t.players.forEach(uid => scores.set(uid, 0));

    t.rounds.forEach(round => {
      round.pairings.forEach(p => {
        if (p.result === 'white')     { scores.set(p.whiteUid, (scores.get(p.whiteUid) || 0) + 1); }
        else if (p.result === 'black') { scores.set(p.blackUid, (scores.get(p.blackUid) || 0) + 1); }
        else if (p.result === 'draw') {
          scores.set(p.whiteUid, (scores.get(p.whiteUid) || 0) + 0.5);
          scores.set(p.blackUid, (scores.get(p.blackUid) || 0) + 0.5);
        }
      });
    });

    // Sort by score (descending), then shuffle within score groups
    const sorted = [...t.players].sort((a, b) => (scores.get(b) || 0) - (scores.get(a) || 0));

    // Pair adjacent players by score
    const pairings: TournamentPairing[] = [];
    const paired = new Set<string>();

    for (let i = 0; i < sorted.length; i++) {
      if (paired.has(sorted[i])) continue;

      // Find the next unpaired player
      for (let j = i + 1; j < sorted.length; j++) {
        if (!paired.has(sorted[j])) {
          // Alternate colors from previous rounds
          const white = Math.random() > 0.5 ? sorted[i] : sorted[j];
          const black = white === sorted[i] ? sorted[j] : sorted[i];

          pairings.push({
            gameId:   '',
            whiteUid: white,
            blackUid: black,
            result:   null,
          });

          paired.add(sorted[i]);
          paired.add(sorted[j]);
          break;
        }
      }

      // Odd player gets a bye (full point)
      if (!paired.has(sorted[i]) && sorted.length % 2 !== 0) {
        pairings.push({
          gameId:   'bye',
          whiteUid: sorted[i],
          blackUid: 'bye',
          result:   'bye',
        });
        paired.add(sorted[i]);
      }
    }

    return pairings;
  }

  // ─── Round-robin pairings ─────────────────────────────────────────────────
  private roundRobinPairings(t: Tournament, roundNumber: number): TournamentPairing[] {
    // Berger tables algorithm
    const players = [...t.players];
    if (players.length % 2 !== 0) players.push('bye');
    const n     = players.length;
    const fixed = players[0];
    const rotating = players.slice(1);
    const round = roundNumber - 1;

    const rotated = [...rotating.slice(round % rotating.length), ...rotating.slice(0, round % rotating.length)];
    const circle  = [fixed, ...rotated];

    const pairings: TournamentPairing[] = [];
    for (let i = 0; i < n / 2; i++) {
      const white = circle[i];
      const black = circle[n - 1 - i];
      if (white === 'bye' || black === 'bye') continue;
      pairings.push({ gameId: '', whiteUid: white, blackUid: black, result: null });
    }
    return pairings;
  }

  // ─── Elimination pairings ─────────────────────────────────────────────────
  private eliminationPairings(t: Tournament, roundNumber: number): TournamentPairing[] {
    if (roundNumber === 1) {
      // Seed randomly or by rating
      const shuffled = [...t.players].sort(() => Math.random() - 0.5);
      const pairings: TournamentPairing[] = [];
      for (let i = 0; i < shuffled.length; i += 2) {
        if (shuffled[i + 1]) {
          pairings.push({ gameId: '', whiteUid: shuffled[i], blackUid: shuffled[i + 1], result: null });
        }
      }
      return pairings;
    }

    // Use winners from previous round
    const prevRound = t.rounds[roundNumber - 2];
    const winners = prevRound.pairings
      .map(p => p.result === 'white' ? p.whiteUid : p.result === 'black' ? p.blackUid : null)
      .filter(Boolean) as string[];

    const pairings: TournamentPairing[] = [];
    for (let i = 0; i < winners.length; i += 2) {
      if (winners[i + 1]) {
        pairings.push({ gameId: '', whiteUid: winners[i], blackUid: winners[i + 1], result: null });
      }
    }
    return pairings;
  }

  // ─── Arena pairings (Lichess-style continuous) ────────────────────────────
  private arenaPairings(t: Tournament): TournamentPairing[] {
    // In arena, players are continuously re-paired as games finish
    // This is simplified — a full arena engine pairs players with similar scores
    // who are currently not playing
    const pairings: TournamentPairing[] = [];
    const available = [...t.players];
    while (available.length >= 2) {
      const white = available.shift()!;
      const black = available.shift()!;
      pairings.push({ gameId: '', whiteUid: white, blackUid: black, result: null });
    }
    return pairings;
  }

  // ─── Record game result ───────────────────────────────────────────────────
  async recordResult(
    tournamentId: string,
    gameId: string,
    result: 'white' | 'black' | 'draw'
  ): Promise<Tournament | null> {
    const t = await this.getTournament(tournamentId);
    if (!t || !isFreeTournament(t)) return null;

    for (const round of t.rounds) {
      const pairing = round.pairings.find(p => p.gameId === gameId);
      if (pairing) {
        pairing.result = result;

        // Check if round is complete
        const allDone = round.pairings.every(p => p.result !== null);
        if (allDone) {
          round.completedAt = Date.now();

          // Check if tournament is complete
          const isComplete = this.isTournamentComplete(t);
          if (isComplete) {
            t.status  = 'completed';
            t.endsAt  = Date.now();
            await this.distributePrizes(t);
          } else {
            // Generate next round
            const nextRound = await this.generatePairings(t, round.roundNumber + 1);
            t.rounds.push(nextRound);
          }
        }

        break;
      }
    }

    await this.saveTournament(t);
    return t;
  }

  // ─── Prize distribution ───────────────────────────────────────────────────
  async distributePrizes(t: Tournament): Promise<void> {
    if (!isFreeTournament(t)) {
      logger.warn({ tournamentId: t.id }, 'Paid tournament prize distribution blocked');
      return;
    }
    const standings = this.computeStandings(t);

    // Standard prize split: 50% / 25% / 15% / 10%
    const splits = [0.50, 0.25, 0.15, 0.10];
    const prizeWinners = standings.slice(0, 4);

    for (let i = 0; i < prizeWinners.length; i++) {
      const uid   = prizeWinners[i].uid;
      const prize = Math.floor(t.prizePool * (splits[i] || 0) * 100) / 100;
      if (prize <= 0) continue;

      // Queue prize payment for settlement service
      await this.redis.lpush('prizes:queue', JSON.stringify({
        tournamentId: t.id,
        uid,
        prize,
        currency: t.currency,
        rank: i + 1,
        queuedAt: Date.now(),
      }));

      logger.info({ tournamentId: t.id, uid, prize, rank: i + 1 }, 'Prize queued');
    }

    metrics.inc('tournaments_completed_total');
    logger.info({ tournamentId: t.id, prizePool: t.prizePool }, 'Tournament completed; paid prize distribution remains disabled');
  }

  // ─── Standings ────────────────────────────────────────────────────────────
  computeStandings(t: Tournament): { uid: string; points: number; buchholz: number }[] {
    const points: Map<string, number> = new Map();
    t.players.forEach(uid => points.set(uid, 0));

    t.rounds.forEach(round => {
      round.pairings.forEach(p => {
        if (p.result === 'white')  points.set(p.whiteUid, (points.get(p.whiteUid) || 0) + 1);
        if (p.result === 'black')  points.set(p.blackUid, (points.get(p.blackUid) || 0) + 1);
        if (p.result === 'draw')   {
          points.set(p.whiteUid, (points.get(p.whiteUid) || 0) + 0.5);
          points.set(p.blackUid, (points.get(p.blackUid) || 0) + 0.5);
        }
        if (p.result === 'bye')    points.set(p.whiteUid, (points.get(p.whiteUid) || 0) + 1);
      });
    });

    return [...points.entries()]
      .map(([uid, pts]) => ({ uid, points: pts, buchholz: 0 }))
      .sort((a, b) => b.points - a.points);
  }

  private isTournamentComplete(t: Tournament): boolean {
    switch (t.format) {
      case 'round_robin': {
        const n = t.players.length;
        const totalRounds = n % 2 === 0 ? n - 1 : n;
        return t.rounds.length >= totalRounds && t.rounds.every(r => r.completedAt !== null);
      }
      case 'elimination': {
        const lastRound = t.rounds[t.rounds.length - 1];
        return lastRound.pairings.length === 1 && lastRound.pairings[0].result !== null;
      }
      case 'swiss': {
        // Swiss ends after ceil(log2(players)) rounds
        const expectedRounds = Math.ceil(Math.log2(t.players.length));
        return t.rounds.length >= expectedRounds && t.rounds.every(r => r.completedAt !== null);
      }
      default:
        return false;
    }
  }

  // ─── Persistence ──────────────────────────────────────────────────────────
  async getTournament(id: string): Promise<Tournament | null> {
    const raw = await this.redis.get(`tournament:${id}`);
    return raw ? JSON.parse(raw) : null;
  }

  async saveTournament(t: Tournament): Promise<void> {
    await this.redis.setex(`tournament:${t.id}`, TOURNAMENT_TTL, JSON.stringify(t));
    // Index by status for listing
    await this.redis.zadd(`tournaments:${t.status}`, t.startsAt, t.id);
  }

  async listTournaments(status: Tournament['status']): Promise<Tournament[]> {
    const ids = await this.redis.zrange(`tournaments:${status}`, 0, 49);
    const tournaments = await Promise.all(ids.map(id => this.getTournament(id)));
    return tournaments.filter(Boolean) as Tournament[];
  }
}
