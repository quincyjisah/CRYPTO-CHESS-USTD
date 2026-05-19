# CRYPTO-CHESS-USTD

A minimal TypeScript/Vite web app scaffold for a **Crypto Chess USDT wager lobby**.
The current implementation is a front-end prototype only: it renders a match dashboard,
standard chess starting board, player roster, stake totals, and escrow-address format
status. It does **not** move funds, connect wallets, deploy smart contracts, or settle
real wagers.

## Features

- TypeScript domain helpers for chess-board setup, USDT amount formatting, two-player
  escrow fee math, and EVM-style wallet-address validation.
- Vite-powered browser UI for a demo wager lobby with user-triggered slow music,
  move sound effects, mute controls, tipping placeholders, and disabled livestream chips.
- Vitest unit tests for board and wager helpers.
- Reproducible npm install through `package-lock.json`.
- CI workflow for formatting, linting, tests, builds, dependency review, dependency audit,
  and secret scanning.
- Security policy and baseline ignore rules for local secrets and generated artifacts.

## Project structure

```text
.github/workflows/ci.yml  CI quality, dependency, and secret-scan checks
src/chess.ts              Chess and wager domain helpers
src/main.ts               Browser rendering entrypoint
src/styles.css            Application styles
tests/chess.test.ts       Unit tests
AUDIT.md                  Current repository audit
SECURITY.md               Vulnerability reporting and supported-version policy
docs/MAINNET_READINESS.md Mainnet, game, NFT, media, ads, tip, and scale gates
docs/THREAT_MODEL.md      Exploit, phishing, wallet, stream, NFT, and scale recheck
docs/ARCHITECTURE.md       Distributed backend and Redis architecture overview
docs/ADSENSE.md            Safe Google AdSense environment configuration
docs/AUTH.md               Session-token auth design for API and WebSocket actions
.env.example               Public environment variable template
lib/                       Authoritative game, ledger, Redis, oracle, economy, NFT modules
server/                    WebSocket, static app, and matchmaking services
```

## Requirements

- Node.js 20 or newer
- npm 10 or newer

## Getting started

```bash
npm ci
npm run dev
```

The local development server defaults to <http://localhost:5173>.

## Canonical test and verification commands

```bash
npm run format
npm run lint
npm test
npm run build
npm run audit
docker compose config
```

`npm test` is the canonical automated test command for this repository.

## Security and production-readiness notes

This is not a production wagering system. The prototype now documents the intended 2%
platform-fee rule: for example, `10 + 10 USDT = 20 USDT`, `0.40 USDT` goes to the
platform, and `19.60 USDT` goes to the winner. Before handling real assets, add and audit
the missing production components, including wallet connection, chain selection, contract
code, contract tests, oracle/settlement rules, anti-cheat controls, custody/escrow design,
monitoring, incident response, an independent smart-contract security review, and dedicated auth token issuance infrastructure.

See [`SECURITY.md`](SECURITY.md) for vulnerability reporting and supported-version
guidance, [`AUDIT.md`](AUDIT.md) for the current audit status,
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the distributed architecture,
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) for the exploit/phishing recheck, and
[`docs/MAINNET_READINESS.md`](docs/MAINNET_READINESS.md) for the mainnet gate list.
