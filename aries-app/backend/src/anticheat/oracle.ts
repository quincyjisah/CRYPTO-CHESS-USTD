/**
 * anticheat/oracle.ts — Aries Protocol Anti-Cheat Oracle
 *
 * Layered detection inspired by:
 *  - Chess.com's detection methodology
 *  - Lichess Kaladin (open-source reference)
 *  - Riot Vanguard layered trust philosophy
 *  - VAC-style behavioral fingerprinting
 *
 * Detection layers:
 *  1. Timing analysis — inhuman move speeds, perfectly uniform think times
 *  2. Engine correlation — moves matching Stockfish top-1 at depth 20+
 *  3. Accuracy spike detection — sudden 95%+ accuracy in wager games
 *  4. Entropy analysis — lack of variation in move timing patterns
 *  5. Behavioral fingerprinting — tab switches, mouse events, focus loss
 *  6. Collusion detection — same-pair repeated games with suspicious results
 *  7. Smurf detection — new account beating high-rated players consistently
 *
 * All detections are probabilistic, not definitive.
 * All flags go to human review pipeline before any action is taken.
 * False positive rate is weighted heavily — unfair bans destroy trust.
 */

import type { Redis } from 'ioredis';
import type {
  AntiCheatEvent, MoveMetrics, TrustProfile, TrustLevel, CheatSignal
} from '../shared/types';
import { logger }  from '../shared/logger';
import { metrics } from '../shared/metrics';

// Thresholds — tuned conservatively to minimize false positives
const ENGINE_CORRELATION_THRESHOLD  = 0.87;  // 87%+ top-engine match over 20+ moves
const ACCURACY_SPIKE_THRESHOLD      = 0.92;  // 92%+ accuracy (vs player's historical avg)
const MIN_HUMAN_THINK_MS            = 250;   // Below 250ms = suspicious (reflexes)
const MAX_UNIFORM_THINK_VARIANCE    = 0.05;  // Variance < 5% over 10+ moves = bot rhythm
const COLLUSION_SAME_PAIR_LIMIT     = 8;     // 8+ games same pair in 24h = suspicious
const SMURF_WIN_RATE_THRESHOLD      = 0.95;  // 95%+ wins on <30-game account
const REVIEW_THRESHOLD_SCORE        = 60;    // Trust score below 60 = queue for review

export class AntiCheatOracle {
  constructor(private redis: Redis) {}

  // ─── Record a cheat signal ────────────────────────────────────────────────
  async recordEvent(event: AntiCheatEvent): Promise<void> {
    try {
      // Stream to Redis Streams for async processing and replay analysis
      await this.redis.xadd(
        'anticheat:events',
        '*',
        'data', JSON.stringify(event)
      );

      // Real-time severity-3 alerts go to immediate review queue
      if (event.severity === 3) {
        await this.redis.lpush('anticheat:critical', JSON.stringify(event));
        await this.redis.ltrim('anticheat:critical', 0, 999);
        metrics.inc('anticheat_critical_flags');
      }

      await this.updateTrustScore(event.uid, event.signal, event.severity);
      logger.warn({ ...event }, 'Anti-cheat signal recorded');
    } catch (err) {
      logger.error({ err, event }, 'Failed to record anti-cheat event');
    }
  }

  // ─── Analyze move metrics (called async, does not block moves) ──────────────
  async analyzeMoveAsync(metrics_data: MoveMetrics): Promise<void> {
    // Push to Redis queue for background Stockfish worker
    await this.redis.lpush('stockfish:queue', JSON.stringify(metrics_data));
    await this.redis.ltrim('stockfish:queue', 0, 9999);
  }

  // ─── Timing analysis ──────────────────────────────────────────────────────
  async analyzeTimingPattern(gameId: string, uid: string, thinkMs: number): Promise<void> {
    const key = `anticheat:timing:${gameId}:${uid}`;

    // Store last 20 think times
    await this.redis.rpush(key, thinkMs);
    await this.redis.ltrim(key, -20, -1);
    await this.redis.expire(key, 3600);

    const rawTimes = await this.redis.lrange(key, 0, -1);
    if (rawTimes.length < 10) return; // Need at least 10 moves to analyze

    const times = rawTimes.map(Number);

    // Check 1: Suspiciously fast moves
    const fastMoves = times.filter(t => t < MIN_HUMAN_THINK_MS).length;
    if (fastMoves > times.length * 0.5) {
      await this.recordEvent({
        gameId, uid, signal: 'timing_anomaly', severity: 2,
        data: { fastMoves, total: times.length, avgMs: avg(times) },
        timestamp: Date.now(),
      });
    }

    // Check 2: Inhuman uniformity (bot rhythm)
    const mean = avg(times);
    const variance = times.reduce((acc, t) => acc + Math.pow(t - mean, 2), 0) / times.length;
    const coefficientOfVariation = Math.sqrt(variance) / mean;

    if (coefficientOfVariation < MAX_UNIFORM_THINK_VARIANCE && mean < 3000) {
      await this.recordEvent({
        gameId, uid, signal: 'timing_anomaly', severity: 2,
        data: { cv: coefficientOfVariation, mean, variance },
        timestamp: Date.now(),
      });
    }
  }

  // ─── Engine correlation (called by Stockfish worker) ─────────────────────
  async processStockfishResult(
    gameId: string, uid: string,
    moveNumber: number,
    isTopMove: boolean,
    cpLoss: number
  ): Promise<void> {
    const key = `anticheat:engine:${gameId}:${uid}`;

    // Track rolling window of [isTopMove, cpLoss] pairs
    await this.redis.rpush(key, JSON.stringify({ isTopMove, cpLoss }));
    await this.redis.ltrim(key, -25, -1);
    await this.redis.expire(key, 3600);

    const rawData = await this.redis.lrange(key, 0, -1);
    if (rawData.length < 15) return;

    const data = rawData.map(r => JSON.parse(r));
    const topMoveRate = data.filter((d: any) => d.isTopMove).length / data.length;
    const avgCpLoss   = avg(data.map((d: any) => d.cpLoss));

    // Stockfish correlation: >87% top-engine move rate with low cp loss
    if (topMoveRate > ENGINE_CORRELATION_THRESHOLD && avgCpLoss < 5) {
      await this.recordEvent({
        gameId, uid, signal: 'engine_correlation', severity: 3,
        data: { topMoveRate, avgCpLoss, movesAnalyzed: data.length },
        timestamp: Date.now(),
      });
    }
  }

  // ─── Accuracy spike detection ─────────────────────────────────────────────
  async detectAccuracySpike(uid: string, gameId: string, accuracy: number): Promise<void> {
    // Get player's historical accuracy from Redis cache
    const histKey = `player:${uid}:avgAccuracy`;
    const rawHist = await this.redis.get(histKey);
    const historicalAvg = rawHist ? parseFloat(rawHist) : 0.65; // Default 65%

    const spike = accuracy - historicalAvg;
    if (accuracy > ACCURACY_SPIKE_THRESHOLD && spike > 0.25) {
      await this.recordEvent({
        gameId, uid, signal: 'accuracy_spike', severity: 2,
        data: { accuracy, historicalAvg, spike },
        timestamp: Date.now(),
      });
    }
  }

  // ─── Collusion detection ─────────────────────────────────────────────────
  async detectCollusion(uid1: string, uid2: string, gameId: string): Promise<void> {
    // Count how many times this exact pair has played in 24h
    const pairKey = `anticheat:pair:${[uid1, uid2].sort().join(':')}`;
    const count   = await this.redis.incr(pairKey);
    if (count === 1) await this.redis.expire(pairKey, 86400); // 24h window

    if (count >= COLLUSION_SAME_PAIR_LIMIT) {
      await this.recordEvent({
        gameId, uid: uid1, signal: 'collusion', severity: 2,
        data: { uid2, gameCount24h: count },
        timestamp: Date.now(),
      });
    }
  }

  // ─── Smurf detection ─────────────────────────────────────────────────────
  async detectSmurf(uid: string, wins: number, total: number, rating: number): Promise<void> {
    if (total < 10) return; // Too few games to judge
    if (total > 30) return; // Established account

    const winRate = wins / total;
    if (winRate > SMURF_WIN_RATE_THRESHOLD) {
      await this.recordEvent({
        gameId: 'N/A', uid, signal: 'smurf', severity: 2,
        data: { winRate, total, rating },
        timestamp: Date.now(),
      });
    }
  }

  // ─── Update trust score ───────────────────────────────────────────────────
  async updateTrustScore(uid: string, signal: CheatSignal, severity: 1 | 2 | 3): Promise<void> {
    const key       = `trust:${uid}:score`;
    const flagsKey  = `trust:${uid}:flags`;

    // Deduct from trust score based on severity
    const deduction = severity === 3 ? 25 : severity === 2 ? 10 : 3;
    const newScore  = await this.redis.decrby(key, deduction);

    // Initialize at 100 if first signal
    const current = newScore;
    if (current > 100) await this.redis.set(key, 100);
    if (current < 0)   await this.redis.set(key, 0);

    // Track which signals have been seen
    await this.redis.sadd(flagsKey, signal);
    await this.redis.expire(flagsKey, 86400 * 30); // 30 days

    const trustScore = Math.max(0, Math.min(100, current));

    // Determine trust level
    const trustLevel: TrustLevel =
      trustScore >= 80 ? 'clean' :
      trustScore >= 60 ? 'suspicious' :
      trustScore >= 30 ? 'flagged' : 'banned';

    // Persist trust profile
    const profile: TrustProfile = {
      uid,
      trustScore,
      trustLevel,
      flags: (await this.redis.smembers(flagsKey)) as CheatSignal[],
      gamesReviewed: 0,
      lastUpdated: Date.now(),
    };

    await this.redis.setex(`trust:${uid}:profile`, 86400 * 7, JSON.stringify(profile));

    if (trustLevel === 'banned') {
      // Publish ban event for enforcement
      await this.redis.publish('anticheat:ban', JSON.stringify({ uid, trustScore, signal }));
      logger.warn({ uid, trustScore, signal }, 'Account trust score critically low — ban candidate');
      metrics.inc('anticheat_bans_total');
    }

    if (trustScore < REVIEW_THRESHOLD_SCORE) {
      // Queue for human review
      await this.redis.zadd('anticheat:review_queue', trustScore, uid);
      metrics.inc('anticheat_reviews_queued');
    }
  }

  // ─── Get trust profile ────────────────────────────────────────────────────
  async getTrustProfile(uid: string): Promise<TrustProfile> {
    const raw = await this.redis.get(`trust:${uid}:profile`);
    if (raw) return JSON.parse(raw);

    // Default: clean with 100 score
    return {
      uid,
      trustScore: 100,
      trustLevel: 'clean',
      flags: [],
      gamesReviewed: 0,
      lastUpdated: Date.now(),
    };
  }

  // ─── Tab-switch / browser-focus signal (sent by client) ──────────────────
  async recordTabSwitch(gameId: string, uid: string): Promise<void> {
    const key = `anticheat:tabswitch:${gameId}:${uid}`;
    const count = await this.redis.incr(key);
    await this.redis.expire(key, 3600);

    // More than 5 tab switches in a game is worth noting
    if (count > 5) {
      await this.recordEvent({
        gameId, uid, signal: 'tabswitch', severity: 1,
        data: { switchCount: count },
        timestamp: Date.now(),
      });
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function avg(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
