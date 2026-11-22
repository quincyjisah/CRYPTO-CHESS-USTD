import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
const auth = readFileSync(resolve(process.cwd(), 'src/lib/AuthContext.tsx'), 'utf8');

describe('Aries application loading boundaries', () => {
  it('loads secondary views only when the selected view is rendered', () => {
    for (const view of ['Hub', 'Ledger', 'ChessArena', 'Vault', 'CoinFlip', 'TournamentUI', 'ReplayViewer', 'WalletModal']) {
      expect(app).toMatch(new RegExp(`const ${view}\\s*=\\s*lazy\\(\\(\\)\\s*=>\\s*import\\(['"]\\.\\/components\\/${view}['"]\\)`));
    }
    expect(app).toMatch(/<Suspense\s+fallback=/);
  });

  it('defers ethers monitoring until a wallet is connected', () => {
    expect(auth).toMatch(/import\(['"]\.\/ethers['"]\)/);
    expect(auth).not.toMatch(/^import\s+\{\s*watchWalletEvents,\s*getAllBalances\s*\}\s+from\s+['"]\.\/ethers['"];?/m);
  });
});

it('keeps the WalletConnect modal dependency families in separate vendor chunks', () => {
  const config = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
  for (const chunk of [
    'vendor-reown-controllers',
    'vendor-reown-ui',
    'vendor-walletconnect',
    'vendor-viem',
    'vendor-ox',
    'vendor-crypto-primitives',
  ]) {
    expect(config).toContain(chunk);
  }
});
