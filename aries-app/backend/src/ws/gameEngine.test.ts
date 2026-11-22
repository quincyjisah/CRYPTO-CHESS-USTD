import type { Redis } from 'ioredis';
import { Chess } from 'chess.js';
import { GameEngine } from './gameEngine';
import type { GameSession } from '../shared/types';

class MemoryRedis {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, ...args: Array<string | number>): Promise<'OK' | null> {
    const nx = args.some((arg) => String(arg).toUpperCase() === 'NX');
    if (nx && this.values.has(key)) return null;
    this.values.set(key, value);
    return 'OK';
  }

  async setex(key: string, _seconds: number, value: string): Promise<'OK'> {
    this.values.set(key, value);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.values.delete(key)) removed += 1;
    }
    return removed;
  }

  async eval(_script: string, _numKeys: number, key: string, expected: string): Promise<number> {
    if (this.values.get(key) !== expected) return 0;
    this.values.delete(key);
    return 1;
  }
}

describe('GameEngine security and state invariants', () => {
  let redis: MemoryRedis;
  let engine: GameEngine;

  const makeSession = (overrides: Partial<GameSession> = {}) => ({
    gameId: 'unit-test-game',
    whiteUid: 'white-user',
    blackUid: 'black-user',
    whiteHandle: 'White',
    blackHandle: 'Black',
    wager: 0,
    currency: 'USDT' as const,
    timeControl: 'blitz' as const,
    initialFen: new Chess().fen(),
    wsNodeId: 'test-node',
    isPublic: false,
    ...overrides,
  });

  beforeEach(() => {
    redis = new MemoryRedis();
    engine = new GameEngine(redis as unknown as Redis);
  });

  it('creates zero-wager games with spectator access disabled by default', async () => {
    const state = await engine.createGame(makeSession());
    expect(state.wager).toBe(0);
    expect(state.fen).toBe(new Chess().fen());
    expect(state.isPublic).toBe(false);
    expect(await engine.getGameState(state.gameId)).toEqual(state);
  });

  it('rejects paid games before writing any state', async () => {
    await expect(engine.createGame(makeSession({ wager: 1 }))).rejects.toThrow(
      'Paid games are disabled',
    );
    expect(await engine.getGameState('unit-test-game')).toBeNull();
  });

  it('allows a legal move and rejects a wrong-turn move', async () => {
    await engine.createGame(makeSession());

    const wrongTurn = await engine.applyMove('unit-test-game', 'black-user', {
      from: 'e7',
      to: 'e5',
    });
    expect(wrongTurn.ok).toBe(false);
    expect(wrongTurn.reason).toBe('Not your turn');

    const move = await engine.applyMove('unit-test-game', 'white-user', {
      from: 'e2',
      to: 'e4',
    });
    expect(move.ok).toBe(true);
    expect(move.move?.san).toBe('e4');
    expect(move.move?.hash).toMatch(/^[a-f0-9]{64}$/);

    const state = await engine.getGameState('unit-test-game');
    expect(state?.turn).toBe('black');
    expect(state?.moves).toHaveLength(1);
    expect(engine.verifyLedgerChain(state!.moves)).toBe(true);
  });

  it('rejects resignation from a non-player and accepts a player resignation', async () => {
    await engine.createGame(makeSession());

    expect(await engine.resignGame('unit-test-game', 'intruder')).toBe(false);
    expect((await engine.getGameState('unit-test-game'))?.status).toBe('active');

    expect(await engine.resignGame('unit-test-game', 'white-user')).toBe(true);
    const state = await engine.getGameState('unit-test-game');
    expect(state?.status).toBe('finished');
    expect(state?.result).toBe('black');
    expect(state?.endReason).toBe('resign');
  });

  it('aborts a game when a stored move hash has been tampered with', async () => {
    await engine.createGame(makeSession());
    const move = await engine.applyMove('unit-test-game', 'white-user', {
      from: 'e2',
      to: 'e4',
    });
    expect(move.ok).toBe(true);

    const state = await engine.getGameState('unit-test-game');
    state!.moves[0].hash = '0'.repeat(64);
    await engine.saveGameState(state!);

    const result = await engine.applyMove('unit-test-game', 'black-user', {
      from: 'e7',
      to: 'e5',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Move ledger integrity check failed');
    expect((await engine.getGameState('unit-test-game'))?.status).toBe('aborted');
  });
});
