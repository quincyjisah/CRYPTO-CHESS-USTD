// shared/redis.ts — Redis connection pool for all services
import Redis from 'ioredis';
import { logger } from './logger';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const opts = {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
  retryStrategy: (times: number) => Math.min(times * 100, 3000),
};

export const redis    = new Redis(REDIS_URL, { ...opts, db: 0 });
export const redisPub = new Redis(REDIS_URL, { ...opts, db: 0 });
export const redisSub = new Redis(REDIS_URL, { ...opts, db: 0 });

redis.on('error',    (err) => logger.error({ err }, 'Redis main error'));
redisPub.on('error', (err) => logger.error({ err }, 'Redis pub error'));
redisSub.on('error', (err) => logger.error({ err }, 'Redis sub error'));
redis.on('ready',    () => logger.info('Redis main connected'));
