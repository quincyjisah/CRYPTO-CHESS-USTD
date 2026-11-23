export interface LocalRateLimitBucket {
  hits: number;
  resetAt: number;
}

export function consumeRateLimit(
  bucket: LocalRateLimitBucket | null,
  now: number,
  limit: number,
  windowMs: number,
): { allowed: boolean; bucket: LocalRateLimitBucket } {
  if (!bucket || now >= bucket.resetAt) {
    return { allowed: true, bucket: { hits: 1, resetAt: now + windowMs } };
  }

  if (bucket.hits >= limit) {
    return { allowed: false, bucket };
  }

  return {
    allowed: true,
    bucket: { ...bucket, hits: bucket.hits + 1 },
  };
}
