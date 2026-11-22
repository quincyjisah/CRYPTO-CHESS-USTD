# Aries Protocol — Deployment Status and Safe Release Process

**Current release status: BLOCKED.** This document describes the verified source layout and the gates for a future deployment. It is not authorisation to deploy, sign transactions, fund a wallet or enable wagering.

## Source layout

- Frontend: `aries-app/` (Vite, React and TypeScript).
- Solidity: `aries-app/backend/contracts/`.
- Hardhat workspace: `aries-app/backend/contracts-workspace/`.
- Experimental realtime/backend service: `aries-app/backend/src/`.
- Firebase configuration and rules: `aries-app/firebase.json`, `firestore.rules` and related configuration.

These are separate development components. A passing frontend build or contract test does not prove they are deployed, correctly wired or operational together.

## Local verification

From `aries-app/`:

```bash
npm ci
npm test
npm run lint
npm run build
```

From `aries-app/backend/contracts-workspace/`:

```bash
npm ci
npm test
npm run compile
```

These commands compile/test source locally. They do not deploy contracts, connect a funded wallet, verify a production domain, or complete application acceptance testing.

## Current deployment facts

- The Solidity source is present locally. No verified production or mainnet contract addresses are recorded by this workspace.
- The public GitHub repository `CRYPTO-CHESS-USTD` contains a project concept/documentation scaffold; it does not contain the complete private Aries application and contract source.
- The existing Vercel project named `aries-blackjack` was previously found linked to the LeadPilot GitHub repository and its build configuration was not an Aries release. Do not treat its deployment status or URL as the Aries application.
- No real deposit, withdrawal, payout or production wagering flow is enabled in the current frontend.

## Deployment prerequisites

1. Publish one reviewed canonical source repository and pin the exact release commit.
2. Establish separate staging/prod projects, build commands, roots, domains and environment allow-lists for frontend, backend and contracts.
3. Complete independent app and contract security review before testnet deployment.
4. Verify role holders, treasury, settler, pause authority, accepted tokens and deployed bytecode using a controlled testnet release.
5. Run integration tests against deployed contracts and disposable backend/database environments.
6. Establish multisig administration, monitoring, key custody, incident response and rollback/recovery procedures.
7. Complete jurisdiction-specific legal, privacy and consumer review.
8. Only then prepare a separate production release approval with the user.

## Secret handling

Never place private keys, seed phrases, wallet exports or service-role credentials in source control, frontend variables, build artefacts or chat. Use a dedicated deployment wallet with minimal test funds for testnet and an independently reviewed custody process for any later production deployment.

For the complete current gate list, see [`MAINNET_CHECKLIST.md`](MAINNET_CHECKLIST.md) and the parent [`README.md`](../README.md).
