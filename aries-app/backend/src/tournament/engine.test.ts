import type { Redis } from 'ioredis';
import { TournamentEngine } from './engine';
import type { Tournament } from '../shared/types';

class MemoryRedis {
  private readonly values = new Map<string, string>();
  readonly lists = new Map<string, string[]>();
  async get(key: string): Promise<string | null> { return this.values.get(key) ?? null; }
  async setex(key: string, _ttl: number, value: string): Promise<'OK'> {
    this.values.set(key, value);
    return 'OK';
  }
  async zadd(_key: string, _score: number, _value: string): Promise<number> { return 1; }
  async zrange(_key: string, _start: number, _stop: number): Promise<string[]> { return []; }
  async lpush(key: string, ...values: string[]): Promise<number> {
    const existing = this.lists.get(key) ?? [];
    this.lists.set(key, [...values, ...existing]);
    return existing.length + values.length;
  }
}

const redisEngine = () => {
  const redis = new MemoryRedis();
  return { redis, engine: new TournamentEngine(redis as unknown as Redis) };
};

const legacyPaidTournament = (): Tournament => ({
  id: 'legacy-paid',
  name: 'Legacy paid event',
  format: 'swiss',
  status: 'registration',
  entryFee: 10,
  currency: 'USDT',
  prizePool: 100,
  maxPlayers: 16,
  players: ['player-a'],
  rounds: [],
  startsAt: Date.now() + 60_000,
  endsAt: null,
  timeControl: 'blitz',
  createdBy: 'owner',
});

describe('TournamentEngine financial safety', () => {
  it('rejects paid tournament creation', async () => {
    const { engine } = redisEngine();
    await expect(engine.createTournament({
      name: 'Paid event',
      format: 'swiss',
      entryFee: 10,
      currency: 'USDT',
      maxPlayers: 8,
      startsAt: Date.now() + 60_000,
      timeControl: 'blitz',
      createdBy: 'owner',
    })).rejects.toThrow('Paid tournaments are disabled');
  });

  it('rejects registration in a legacy paid tournament without changing its prize pool', async () => {
    const { redis, engine } = redisEngine();
    const tournament = legacyPaidTournament();
    await redis.setex('tournament:' + tournament.id, 604_800, JSON.stringify(tournament));

    await expect(engine.registerPlayer(tournament.id, 'player-b'))
      .resolves.toEqual({ ok: false, reason: 'Paid tournaments are disabled' });

    const saved = JSON.parse((await redis.get('tournament:' + tournament.id))!);
    expect(saved.players).toEqual(['player-a']);
    expect(saved.prizePool).toBe(100);
  });

  it('never creates prize-queue payments for legacy tournament records', async () => {
    const { redis, engine } = redisEngine();
    await engine.distributePrizes(legacyPaidTournament());
    expect(redis.lists.get('prizes:queue') ?? []).toHaveLength(0);
  });
});
