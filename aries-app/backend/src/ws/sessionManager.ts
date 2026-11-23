// ws/sessionManager.ts — JWT + Firebase token verification
import type { Redis } from 'ioredis';
import { createHash } from 'crypto';
import { logger } from '../shared/logger';

interface VerifiedSession {
  uid:    string;
  email?: string;
}

export class SessionManager {
  constructor(private redis: Redis) {}

  async verifyToken(token: string): Promise<VerifiedSession | null> {
    if (typeof token !== 'string' || token.length < 100 || token.length > 8192) return null;

    const cacheKey = 'session:' + createHash('sha256').update(token).digest('hex');
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as VerifiedSession;

      const apiKey = process.env.FIREBASE_API_KEY;
      if (!apiKey) {
        logger.error('FIREBASE_API_KEY is not configured; refusing WebSocket authentication.');
        return null;
      }

      const res = await fetch(
        'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(apiKey),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: token }),
          signal: AbortSignal.timeout(5_000),
        }
      );

      if (!res.ok) return null;
      const data = await res.json() as { users?: Array<{ localId?: string; email?: string }> };
      const user = data.users?.[0];
      if (!user?.localId) return null;

      const verified: VerifiedSession = { uid: user.localId, email: user.email };
      await this.redis.setex(cacheKey, 60, JSON.stringify(verified));
      return verified;
    } catch (err) {
      logger.error({ err }, 'Token verification failed');
      return null;
    }
  }
}
