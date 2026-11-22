# Aries Protocol — Mainnet Release Gates

**STATUS: BLOCKED — NOT A DEPLOYMENT RUNBOOK.** This replaces the legacy checklist that contained obsolete provider settings, contract examples and deployment steps. Do not execute old deployment snippets or send real funds based on this file.

No production/mainnet deployment is approved. The current repository contains a frontend prototype, backend experiments and local Solidity sources/tests; none of those facts establishes a live, audited wagering service.

## Required gates before any production release

- [ ] Select one canonical app, backend and contract version; publish them to a dedicated repository with a reproducible lockfile and reviewed release tag.
- [ ] Reconcile app, backend, Firebase/Firestore rules, game-state service and escrow contract into one threat-modelled architecture.
- [ ] Complete independent smart-contract audit of `AriesEscrow.sol` and `AriesGenesisNFT.sol`, including role administration, pause/recovery, token compatibility, disputes, timeouts, NFT minting, royalty behaviour and upgrade/admin assumptions.
- [ ] Complete adversarial testnet tests for every state transition, race, timeout, refund, dispute, replay and failure mode. Verify deployed bytecode and constructor/configuration values.
- [ ] Implement and independently review wallet ownership verification, game membership checks, server-issued sessions, key rotation, revocation, rate limits and secure WebSocket authorisation.
- [ ] Verify authoritative chess result/oracle behaviour, anti-cheat policy, game finality, disconnect handling and recovery. Do not rely on browser-submitted winner values.
- [ ] Verify Firebase/Firestore authorization, privacy retention, backups, restore drills and service-account boundaries.
- [ ] Establish multisig control of admin, settler, pauser and treasury roles with distinct operators, emergency procedures and tested role recovery.
- [ ] Establish monitoring, alerting, incident response, dependency maintenance, load testing and operational ownership.
- [ ] Complete legal review for gambling, consumer protection, cryptoasset regulation, AML/sanctions, privacy, age controls and each launch jurisdiction.
- [ ] Review all marketing, game and NFT terms; reconcile them with the exact deployed code and enforceable customer rights.
- [ ] Complete independent application penetration testing and browser/mobile device acceptance testing.

## Current code facts to keep consistent

- Escrow winner fee: 2% of the combined pot in current local Solidity source; draw returns both wagers in full.
- Escrow token support: constructor/admin allow-list; no deployed token addresses are confirmed here.
- NFT local source: maximum 10,000 lifetime supply, up to 1,000 per season, default 5% ERC-2981 royalty, and optional 3% creator override. No auction or holder reward system exists in the checked-in contract.
- The local contracts are not an independent audit and do not prove deployment.

## Safe development commands

Compile and test locally only:

```bash
cd backend/contracts-workspace
npm ci
npm test
npm run compile
```

**Do not run `deploy:sepolia`, `deploy:mainnet`, `verify:mainnet` or any wallet transaction as part of this checklist.** A separate, explicitly approved release process is required after the gates above are closed.
