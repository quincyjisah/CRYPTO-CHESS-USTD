/**
 * stockfish/worker.ts — Aries Protocol Stockfish Analysis Worker
 *
 * Reads from the Redis queue `stockfish:queue`, runs Stockfish evaluation
 * on each move, writes results back to Redis for:
 *   - Anti-cheat engine correlation detection
 *   - Accuracy scores for the replay viewer
 *   - AI coaching centipawn loss per move
 *   - Blunder / mistake / brilliant move classification
 *
 * Runs as a separate Docker container (Dockerfile.stockfish).
 * Scale: 1 worker handles ~200 evals/sec at depth 15.
 * For 1M users, run 10–20 workers horizontally.
 *
 * Install: npm install stockfish
 * The `stockfish` npm package bundles a WASM/JS Stockfish binary.
 * For native performance on Linux, use the stockfish system binary instead.
 */

import Redis from 'ioredis';
import { Chess }        from 'chess.js';
import { logger }       from '../shared/logger';
import { metrics }      from '../shared/metrics';
import type { MoveMetrics } from '../shared/types';

// ─── Stockfish engine wrapper ─────────────────────────────────────────────────

interface EvalResult {
  score:      number;     // Centipawn score (positive = white advantage)
  depth:      number;
  bestMove:   string;     // UCI format: e2e4
  isMate:     boolean;
  mateIn:     number | null;
}

class StockfishEngine {
  private process: any;
  private resolvers: Map<string, (result: EvalResult) => void> = new Map();
  private currentId = 0;
  private ready = false;

  async init(): Promise<void> {
    // Use system stockfish binary on Linux (much faster than WASM)
    // Install: apt-get install -y stockfish
    const { spawn } = await import('child_process');
    this.process = spawn('stockfish', [], { stdio: ['pipe', 'pipe', 'pipe'] });

    this.process.stdout.on('data', (data: Buffer) => {
      this.handleOutput(data.toString());
    });

    this.process.stderr.on('data', (data: Buffer) => {
      logger.warn({ msg: data.toString() }, 'Stockfish stderr');
    });

    this.process.on('close', (code: number) => {
      logger.error({ code }, 'Stockfish process exited — restarting');
      setTimeout(() => this.init(), 1000);
    });

    // Initialize UCI mode
    this.send('uci');
    this.send('setoption name Threads value 4');
    this.send('setoption name Hash value 256');  // 256MB hash table
    this.send('isready');

    await new Promise<void>((resolve) => {
      const checkReady = setInterval(() => {
        if (this.ready) { clearInterval(checkReady); resolve(); }
      }, 50);
    });

    logger.info('Stockfish engine ready');
  }

  private handleOutput(output: string): void {
    const lines = output.split('\n');

    for (const line of lines) {
      if (line === 'readyok') {
        this.ready = true;
        continue;
      }

      // Parse bestmove response
      if (line.startsWith('bestmove')) {
        const parts    = line.split(' ');
        const bestMove = parts[1] || '(none)';

        // Find the pending resolver for this evaluation
        const [id] = [...this.resolvers.keys()];
        if (id) {
          const resolver = this.resolvers.get(id);
          this.resolvers.delete(id);

          // Score is stored in a closure from the info lines
          if (resolver) {
            resolver({
              score:    this.lastScore,
              depth:    this.lastDepth,
              bestMove,
              isMate:   this.lastIsMate,
              mateIn:   this.lastMateIn,
            });
          }
        }
        continue;
      }

      // Parse info line (score cp / mate)
      if (line.startsWith('info') && line.includes('score')) {
        const cpMatch   = line.match(/score cp (-?\d+)/);
        const mateMatch = line.match(/score mate (-?\d+)/);
        const depthMatch = line.match(/depth (\d+)/);

        if (cpMatch)    { this.lastScore = parseInt(cpMatch[1], 10); this.lastIsMate = false; this.lastMateIn = null; }
        if (mateMatch)  { this.lastIsMate = true; this.lastMateIn = parseInt(mateMatch[1], 10); this.lastScore = mateMatch[1].startsWith('-') ? -30000 : 30000; }
        if (depthMatch) { this.lastDepth = parseInt(depthMatch[1], 10); }
      }
    }
  }

  private lastScore  = 0;
  private lastDepth  = 0;
  private lastIsMate = false;
  private lastMateIn: number | null = null;

  async evaluate(fen: string, depth = 15): Promise<EvalResult> {
    const id = String(++this.currentId);

    return new Promise((resolve) => {
      this.resolvers.set(id, resolve);
      this.send('ucinewgame');
      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);

      // Timeout after 5 seconds — move on regardless
      setTimeout(() => {
        if (this.resolvers.has(id)) {
          this.resolvers.delete(id);
          resolve({ score: 0, depth: 0, bestMove: '', isMate: false, mateIn: null });
        }
      }, 5000);
    });
  }

  private send(cmd: string): void {
    this.process?.stdin?.write(cmd + '\n');
  }

  async quit(): Promise<void> {
    this.send('quit');
  }
}

// ─── Classification thresholds (centipawn loss) ───────────────────────────────
const BRILLIANT_THRESHOLD  = -5;    // Better than engine top move by 5cp (sacrifice etc)
const BEST_THRESHOLD       = 5;     // Within 5cp of engine best
const EXCELLENT_THRESHOLD  = 15;
const GOOD_THRESHOLD       = 30;
const INACCURACY_THRESHOLD = 60;
const MISTAKE_THRESHOLD    = 120;
// Above 120cp loss = blunder

type MoveClassification = 'brilliant' | 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

function classifyMove(cpLoss: number): MoveClassification {
  if (cpLoss <= BRILLIANT_THRESHOLD)  return 'brilliant';
  if (cpLoss <= BEST_THRESHOLD)       return 'best';
  if (cpLoss <= EXCELLENT_THRESHOLD)  return 'excellent';
  if (cpLoss <= GOOD_THRESHOLD)       return 'good';
  if (cpLoss <= INACCURACY_THRESHOLD) return 'inaccuracy';
  if (cpLoss <= MISTAKE_THRESHOLD)    return 'mistake';
  return 'blunder';
}

function cpLossToAccuracy(cpLoss: number): number {
  // Lichess-style accuracy formula
  // accuracy = 103.1668 * exp(-0.04354 * cpLoss) - 3.1669
  const accuracy = 103.1668 * Math.exp(-0.04354 * Math.max(0, cpLoss)) - 3.1669;
  return Math.max(0, Math.min(100, accuracy));
}

// ─── Main worker loop ─────────────────────────────────────────────────────────

async function main() {
  const engine = new StockfishEngine();
  await engine.init();

  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: 3 });
  redis.on('error', (err: Error) => logger.error({ err }, 'Redis error'));

  logger.info('Stockfish worker started — listening on stockfish:queue');

  // Processing loop — block on queue pop with 5s timeout
  while (true) {
    try {
      // BLPOP blocks until an item is available (timeout 5s)
      const item = await redis.blpop('stockfish:queue', 5);
      if (!item) continue;

      const move: MoveMetrics = JSON.parse(item[1]);
      metrics.inc('stockfish_evaluations_total');

      const { gameId, uid, moveNumber } = move;

      // We need the FEN before and after the move to compute cp loss
      // The FEN after the move is stored in the game's move history in Redis
      const gameRaw = await redis.get(`game:${gameId}`);
      if (!gameRaw) continue;

      const game      = JSON.parse(gameRaw);
      const moveData  = game.moves?.[moveNumber - 1];
      if (!moveData) continue;

      // Get FEN before this move (position where the player chose their move)
      const fenBefore = moveNumber > 1
        ? game.moves[moveNumber - 2].fen
        : new Chess().fen();

      const fenAfter = moveData.fen;

      // Evaluate the position BEFORE the move to get engine's best score + move
      const [evalBefore, evalAfter] = await Promise.all([
        engine.evaluate(fenBefore, 15),
        engine.evaluate(fenAfter,  15),
      ]);

      // Determine if this player is white or black
      const chess      = new Chess(fenBefore);
      const playerColor = chess.turn(); // 'w' or 'b'

      // Score from the moving player's perspective (positive = good for them)
      const scoreBefore = playerColor === 'w' ? evalBefore.score : -evalBefore.score;
      const scoreAfter  = playerColor === 'w' ? -evalAfter.score : evalAfter.score;

      // CP loss = how much worse the position is after their move vs engine best
      const cpLoss = Math.max(0, scoreBefore - scoreAfter);

      // Did they play the engine's top move?
      const isTopMove = moveData.san === evalBefore.bestMove ||
                        moveData.from + moveData.to === evalBefore.bestMove;

      const classification = classifyMove(cpLoss);
      const accuracy       = cpLossToAccuracy(cpLoss);

      // Write results back to Redis for the anti-cheat oracle and replay viewer
      const pipeline = redis.multi();

      // Anti-cheat oracle reads this
      pipeline.publish('anticheat:stockfish_result', JSON.stringify({
        gameId, uid, moveNumber, isTopMove, cpLoss,
        classification, accuracy,
      }));

      // Move annotation for replay viewer
      pipeline.hset(`replay:moves:${gameId}`, String(moveNumber), JSON.stringify({
        cpLoss, classification, accuracy,
        engineBestMove: evalBefore.bestMove,
        engineScore:    evalBefore.score,
      }));
      pipeline.expire(`replay:moves:${gameId}`, 86400 * 30);

      // Running accuracy tracker for this player in this game
      const accuracyKey = `accuracy_running:${gameId}:${uid}`;
      pipeline.rpush(accuracyKey, String(accuracy));
      pipeline.expire(accuracyKey, 3600);

      // Blunder counter
      if (classification === 'blunder') {
        pipeline.incr(`blunders:${gameId}:${uid}`);
        pipeline.expire(`blunders:${gameId}:${uid}`, 3600);
      }

      // Top-move counter (for engine correlation %)
      if (isTopMove) {
        pipeline.incr(`topmoves:${gameId}:${uid}`);
        pipeline.expire(`topmoves:${gameId}:${uid}`, 3600);
      }

      await pipeline.exec();

      // After each move analysis, update the rolling accuracy for this game
      const allAccuracies = await redis.lrange(accuracyKey, 0, -1);
      if (allAccuracies.length > 0) {
        const avgAcc = allAccuracies.reduce((a, b) => a + parseFloat(b), 0) / allAccuracies.length;
        await redis.set(`accuracy:${gameId}:${uid}`, avgAcc.toFixed(2));

        const topMoves = parseInt(await redis.get(`topmoves:${gameId}:${uid}`) || '0', 10);
        const topPct   = topMoves / allAccuracies.length;
        await redis.set(`topmove_pct:${gameId}:${uid}`, topPct.toFixed(4));
      }

      logger.info({
        gameId, uid, moveNumber, cpLoss, classification, accuracy: accuracy.toFixed(1),
      }, 'Move analyzed');

      metrics.inc(`stockfish_classification_${classification}`);

    } catch (err) {
      logger.error({ err }, 'Stockfish worker error');
      metrics.inc('stockfish_errors');
      await new Promise(r => setTimeout(r, 500)); // Brief backoff on error
    }
  }
}

// ─── Shutdown ─────────────────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
  logger.info('Stockfish worker shutting down');
  process.exit(0);
});

main().catch((err) => {
  logger.error({ err }, 'Stockfish worker fatal error');
  process.exit(1);
});
