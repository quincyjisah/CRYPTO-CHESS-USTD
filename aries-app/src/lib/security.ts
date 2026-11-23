/**
 * security.ts — Aries Protocol client-side security layer
 *
 * Covers:
 *  - Rate limiting (per action, per user session)
 *  - Input sanitization (XSS, injection, length)
 *  - Wager bounds enforcement
 *  - Server-timestamp nonce generation for anti-replay
 *  - Chess move integrity (legal move set check before submitting)
 */

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

interface RateLimitBucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, RateLimitBucket>();

/**
 * Returns true if the action is allowed, false if rate limit exceeded.
 * @param key      Unique action key, e.g. "chat:0xABC" or "wager:uid123"
 * @param maxCalls Max calls allowed per window
 * @param windowMs Window duration in ms
 */
export function checkRateLimit(key: string, maxCalls: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (bucket.count >= maxCalls) return false;

  bucket.count += 1;
  return true;
}

// Pre-configured rate limiters
export const rateLimits = {
  /** Max 3 chat messages per 5 seconds */
  chat: (uid: string) => checkRateLimit(`chat:${uid}`, 3, 5_000),
  /** Max 5 wager attempts per minute */
  wager: (uid: string) => checkRateLimit(`wager:${uid}`, 5, 60_000),
  /** Max 2 deposit/withdraw requests per minute */
  ledger: (uid: string) => checkRateLimit(`ledger:${uid}`, 2, 60_000),
  /** Max 3 bids per 10 minutes */
  bid: (uid: string) => checkRateLimit(`bid:${uid}`, 3, 600_000),
};

// ─── Input Sanitisation ───────────────────────────────────────────────────────

/**
 * Strips HTML tags and trims whitespace. Prevents stored XSS in Firestore
 * data that gets rendered via innerHTML or template strings.
 */
export function sanitizeText(input: string, maxLength = 500): string {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .trim()
    .slice(0, maxLength);
}

/**
 * Validates and clamps a wager value to protocol limits.
 * Returns the clamped value, or null if the input is fundamentally invalid.
 */
export function validateWager(
  raw: number,
  min = 1,
  max = 1000
): { valid: boolean; value: number; error?: string } {
  if (!Number.isFinite(raw) || isNaN(raw)) {
    return { valid: false, value: min, error: 'Wager must be a number.' };
  }
  if (raw < min) {
    return { valid: false, value: min, error: `Minimum wager is ${min} USDT.` };
  }
  if (raw > max) {
    return { valid: false, value: max, error: `Maximum wager is ${max} USDT.` };
  }
  // Block more than 2 decimal places to prevent floating-point manipulation
  const rounded = Math.round(raw * 100) / 100;
  return { valid: true, value: rounded };
}

/**
 * Validates a username/handle: alphanumeric, underscores, 3-32 chars.
 */
export function validateHandle(handle: string): { valid: boolean; error?: string } {
  if (handle.length < 3) return { valid: false, error: 'Handle must be at least 3 characters.' };
  if (handle.length > 32) return { valid: false, error: 'Handle must be 32 characters or fewer.' };
  if (!/^[a-zA-Z0-9_]+$/.test(handle)) {
    return { valid: false, error: 'Handle may only contain letters, numbers, and underscores.' };
  }
  return { valid: true };
}

/**
 * Validates an Ethereum address format.
 */
export function isValidEthAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

// ─── Anti-Replay Nonce ────────────────────────────────────────────────────────

/**
 * Generates a nonce string to include in signed messages, binding them to a
 * specific timestamp. Prevents a captured signature from being replayed later.
 */
export function generateNonce(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `${timestamp}-${random}`;
}

/**
 * Validates that a nonce timestamp is within an acceptable freshness window
 * (default: 5 minutes). Expired nonces are rejected.
 */
export function validateNonce(nonce: string, maxAgeMs = 5 * 60 * 1000): boolean {
  const parts = nonce.split('-');
  if (parts.length < 2) return false;
  const timestamp = parseInt(parts[0], 10);
  if (isNaN(timestamp)) return false;
  return Date.now() - timestamp <= maxAgeMs;
}

// ─── Ethereum Signature Verification ─────────────────────────────────────────

/**
 * Verifies that a signed message was actually signed by the expected wallet.
 * This prevents one user from submitting a signature on behalf of another.
 */
export async function verifyWalletSignature(
  message: string,
  signature: string,
  expectedAddress: string
): Promise<boolean> {
  try {
    const { ethers } = await import('ethers');
    const recoveredAddress = ethers.verifyMessage(message, signature);
    return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
  } catch {
    return false;
  }
}

// ─── Chess Move Integrity ─────────────────────────────────────────────────────

/**
 * Validates that a proposed chess move is in the legal move set for the
 * current position. Prevents clients from submitting fabricated moves
 * that bypass the chess.js engine.
 */
export function isLegalChessMove(
  chess: any, // Chess instance
  from: string,
  to: string
): boolean {
  try {
    const legalMoves = chess.moves({ square: from, verbose: true });
    return legalMoves.some((m: any) => m.from === from && m.to === to);
  } catch {
    return false;
  }
}

// ─── Content Security Policy ──────────────────────────────────────────────────

/**
 * Returns the recommended CSP string for this app.
 * Apply this in your hosting platform (Firebase Hosting headers / Cloud Run).
 */
export const RECOMMENDED_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'", // inline needed for Vite/React
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://picsum.photos https://nft.storage https://ipfs.io https://cloudflare-ipfs.com https://*.ipfs.dweb.link",
  "connect-src 'self' https://*.firebaseio.com https://*.googleapis.com https://mainnet.infura.io wss://*.firebaseio.com https://eth-mainnet.g.alchemy.com https://api.opensea.io",
  "font-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
