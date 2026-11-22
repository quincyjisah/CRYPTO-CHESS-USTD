<div align="center"><img src="assets/project-cover.svg" alt="Crypto Chess project cover" width="100%"></div>

**Purpose:** Chess-focused Web3 product research covering wager accounting, escrow contracts, disputes, timeout recovery and cosmetic NFTs.
**Built for:** Chess players, Web3 game builders and smart-contract engineers.
**Stage:** Prototype and contract development. The local Solidity suite has 54 passing tests, but there is no verified production deployment, independent smart-contract audit or live wagering service. Do not use real funds.

---

<div align="center">
  <img src="aries-app/public/project-cover.svg" alt="Aries Protocol — Crypto Chess Arena" width="100%">
</div>

# Aries Protocol / Crypto Chess — Development Workspace

**Purpose:** A multi-part development workspace exploring a chess game product, Web3 wallet connectivity, token/NFT concepts, and a separately tested ERC-20 escrow contract.

| | Project brief |
|---|---|
| **Built for** | Chess players, Web3 game developers, smart-contract engineers and reviewers of crypto-native game systems. |
| **Current stage** | Development prototypes and local smart-contract tests. Not a production wagering platform. |
| **Value transfer** | No real deposits, withdrawals or payouts are enabled by the current frontend. No production contract deployment is approved. |
| **Payment design** | Crypto-only is the intended direction for any later real-value feature; there is no live checkout or funded match flow. |

## This workspace contains separate components

### 1. Root Crypto Chess demo

The top-level Vite application is a demo wager-lobby interface with chess helpers, player/match presentation and simulated escrow/economy modules. Its game UI is not a live wallet or settlement integration. The root `lib/` and `server/` directories contain experimental game-state, Redis, ledger, oracle and WebSocket services; these are not an authenticated, production-integrated wagering backend.

### 2. Aries Protocol application — `aries-app/`

A separate Vite/React application with free-play chess/tournament concepts, Firebase-backed prototype data and wallet connection/read-only balance inspection. It does not enable on-chain deposits, withdrawals, payouts or live wagering.

### 3. Solidity contracts — `aries-app/backend/contracts/`

- `AriesEscrow.sol`: ERC-20 wager-lock, settle, dispute and timeout-refund contract source.
- `AriesGenesisNFT.sol`: cosmetic chess-piece NFT source with role-controlled minting, seasonal caps, transfer cooldown and ERC-2981 royalties.
- `MockERC20.sol` and `MockFeeOnTransferERC20.sol`: local test assets.

The Hardhat test workspace is `aries-app/backend/contracts-workspace/`. Its tests exercise local contract behaviour only; a green local test run is not an independent audit or evidence of a deployed contract.

### 4. Backend and integration experiments

`aries-app/backend/` contains separate API, WebSocket, replay, anti-cheat and tournament experiments. Integration, deployment, authentication/session management and production operations must be verified independently before connecting these services to a public frontend.

## Source-aligned contract behaviour

The current local escrow source defines a **2% fee on a winner settlement** and returns both wagers in full on a draw. It requires equal token/wager amounts from the two players, a trusted `SETTLER_ROLE` to start and settle games, and provides timeout/dispute recovery paths. These are source-code facts, not live service terms; the contracts are not approved for real funds.

The current NFT source has a 10,000-token total ceiling, a maximum 1,000-token seasonal cap, 5% default ERC-2981 royalty (with a 3% per-token creator override when a distinct creator is set), and role-controlled minting. It does not implement an auction or automatic holder-benefit/governance system. Exact behaviour must be confirmed against the contract version selected for any future deployment.

## Local development

Requirements: Node.js 20+ and npm.

Root demo:

```bash
npm ci
npm test
npm run lint
npm run build
```

Aries app:

```bash
cd aries-app
npm ci
npm test
npm run lint
npm run build
```

Contracts:

```bash
cd aries-app/backend/contracts-workspace
npm ci
npm test
npm run compile
```

Do not run deployment scripts as part of ordinary development. Test compilation and tests only.

## Release boundary

- No production/mainnet contract deployment has been approved.
- No real-value wagering, deposit, payout or withdrawal service is active.
- Contract source has not received an independent smart-contract security audit.
- App, backend, Firebase rules, escrow and wallet verification still need independent end-to-end adversarial testing.
- `GAME_RULES.md`, `NFT_RULES.md`, `MAINNET_CHECKLIST.md` and `DEPLOYMENT.md` are draft release documents; see their status notices.
- Gambling, consumer, privacy, sanctions/AML and cryptoasset regulatory advice is required before any real-value feature is considered.

See [`AUDIT.md`](AUDIT.md), [`SECURITY.md`](SECURITY.md), [`docs/MAINNET_READINESS.md`](docs/MAINNET_READINESS.md) and [`aries-app/README.md`](aries-app/README.md).
