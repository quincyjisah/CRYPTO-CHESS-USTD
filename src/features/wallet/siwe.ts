export interface WalletSession {
  address: string;
  chainId: number;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

const SUPPORTED_CHAINS = new Set([1, 137, 8453, 42161]);

export function assertSupportedChain(chainId: number): void {
  if (!SUPPORTED_CHAINS.has(chainId)) {
    throw new Error(`Unsupported chainId ${chainId}.`);
  }
}

export function assertValidNonce(nonce: string): void {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) {
    throw new Error("Invalid SIWE nonce format.");
  }
}

export function validateWalletSession(
  session: WalletSession,
  now = Date.now(),
): void {
  assertSupportedChain(session.chainId);
  assertValidNonce(session.nonce);
  if (!/^0x[a-fA-F0-9]{40}$/.test(session.address)) {
    throw new Error("Invalid wallet address in session.");
  }
  if (session.issuedAt > now + 60_000) {
    throw new Error("Session issuedAt is in the future.");
  }
  if (session.expiresAt <= now) {
    throw new Error("Wallet session expired.");
  }
}
