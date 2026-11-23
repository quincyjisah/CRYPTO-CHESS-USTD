
import { randomBytes } from 'crypto';

export interface WalletSession {
  address: string;
  nonce: string;
  issuedAt: number;
}

export function generateNonce(): string {
  return randomBytes(16).toString('hex');
}

export function validateSession(
  session: WalletSession,
  maxAgeMs = 1000 * 60 * 15
): boolean {
  return Date.now() - session.issuedAt < maxAgeMs;
}

export function buildSiweMessage(
  domain: string,
  address: string,
  nonce: string
): string {
  return `${domain} wants you to sign in with your Ethereum account:\n${address}\n\nNonce: ${nonce}`;
}
