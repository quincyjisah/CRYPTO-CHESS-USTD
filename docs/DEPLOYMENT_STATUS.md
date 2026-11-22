# Aries — Deployment Status and Release Gates

**Product:** Aries / Crypto Chess Arena
**Purpose:** A chess-based Web3 game and smart-contract system exploring verifiable matches, escrow settlement, tournaments and digital collectibles.
**Built for:** Chess players, Web3 game developers, smart-contract engineers and tournament operators.
**Current stage:** Development and test environment only. No production wagering service or mainnet launch is approved.

## Vercel deployment mismatch — blocking

On 2026-11-22, the connected Vercel project `aries-blackjack` (`prj_HEdHWTa9DcQSNxZLOAAUT9ZsU609`) was inspected. Its latest production deployment was built from GitHub repository `quincyjisah/Repository-name-ai-business-automation-platform`, branch `main`, commit `d38ddee237ac1da26cf5e02f771d8a7f275c8834`. That is the LeadPilot repository, not Aries.

The build log confirms Next.js 14.2.15 and ends with `STATIC_BUILD_NO_OUT_DIR`: Vercel expected a static output directory named `public`, which was not produced. The deployment is not a valid Aries build.

The Aries source currently exists in the local `aries-app/` workspace. The public `CRYPTO-CHESS-USTD` repository currently contains only a README and `.github` directory; it does not contain the full Aries application workspace required by the Vercel project. The local `aries-app/` folder is untracked in this workspace and has not been published to GitHub.

**Do not relink or redeploy this Vercel project until the intended source repository and production build configuration are reviewed.** A correct release path is:

1. Reconcile the complete, reviewed Aries application and backend into a dedicated, correctly named GitHub repository.
2. Ensure secrets, private configuration, wallet material, generated data and local-only files are excluded.
3. Establish reproducible install, lint, test, frontend build and backend build commands from a clean clone.
4. Configure Vercel against the intended repository and exact frontend root directory, with the correct Vite framework/output directory. Keep backend deployment separate unless its runtime architecture is deliberately designed for Vercel.
5. Deploy a preview, inspect build and runtime logs, test critical workflows, and obtain explicit production-release approval before promotion.

## Smart-contract and game release gates

- Contract source and tests must be reconciled with the application ABI and deployment configuration.
- Independent smart-contract audit and adversarial testnet exercise remain mandatory.
- No mainnet contract deployment or real-value wagering is authorised by this status record.
- Wallet authentication, session binding, player identity and replay resistance must be independently verified.
- Game outcome, anti-cheat, settlement, disputes, refunds, timeouts and recovery require end-to-end tests.
- Key custody, multisig governance, pause/recovery procedures, monitoring and incident response must be documented and rehearsed.
- Legal and platform-policy review is required before any real-value game or public launch.

## Verification boundary

The private Aries contract workspace has previously passed 54 automated tests and Solidity compilation. These checks do not prove that the incorrectly linked Vercel project is serving Aries, nor do they constitute an independent contract audit or production acceptance test.

## Deployment policy

No Vercel source-link change, production setting change, deployment, alias promotion, contract deployment, wallet signing or transaction has been performed as part of this audit.
