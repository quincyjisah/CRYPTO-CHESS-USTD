# Aries — Deployment Status and Release Gates

**Product:** Aries / Crypto Chess Arena
**Purpose:** A chess-based Web3 game and smart-contract system exploring verifiable matches, escrow settlement, tournaments and digital collectibles.
**Built for:** Chess players, Web3 game developers, smart-contract engineers and tournament operators.
**Current stage:** Development and test environment only. No production wagering service or mainnet launch is approved.

## Vercel deployment mismatch — blocking

On 2026-11-22, the connected Vercel project `aries-blackjack` (`prj_HEdHWTa9DcQSNxZLOAAUT9ZsU609`) was inspected. Its latest production deployment was built from GitHub repository `quincyjisah/Repository-name-ai-business-automation-platform`, branch `main`, commit `d38ddee237ac1da26cf5e02f771d8a7f275c8834`. That is the LeadPilot repository, not Aries.

The build log confirms Next.js 14.2.15 and ends with `STATIC_BUILD_NO_OUT_DIR`: Vercel expected a static output directory named `public`, which was not produced. The deployment is not a valid Aries build.

The GitHub repository default branch `main` currently contains only the README, `.github` workflow and project cover. The complete Aries workspace is present on the remote development branch `work/aries-source-import`, which was confirmed to match local commit `b1a7634` during this verification. The `aries-app/` directory is tracked on that development branch. This is not yet a reviewed release branch; do not treat the default branch or the Vercel project as a deployable Aries release.

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

The local Aries contract workspace now passes 59 Hardhat tests plus one dependency-lockfile regression test. A clean Hardhat compile regenerated typings and compiled 36 Solidity files successfully. The Aries frontend passes 11 tests, TypeScript type-check and Vite production build; the Functions package passes six tests and TypeScript build; the separate backend experiment passes 12 Jest tests and TypeScript type-check. The full Aries ESLint scan still reports 79 errors and 66 warnings. Firebase Emulator/rules integration tests and a clean root-demo install/build remain unverified. These checks do not prove that the incorrectly linked Vercel project is serving Aries, nor do they constitute an independent contract audit or production acceptance test.

## Additional security configuration verified 2026-11-23

- Firebase Functions deployment now runs the TypeScript build in a predeploy hook and includes the generated `lib/` entrypoint in the upload package.
- App Check is initialized by the web client when a reCAPTCHA v3 site key is supplied. All six callable endpoints support enforcement through `ENFORCE_APP_CHECK=true`; enforcement remains off by default until the matching provider/key is registered and verified. Firestore App Check enforcement is a separate console setting.
- The current wallet utility is read-only: it connects a wallet and reads balances, but does not expose token approval, token transfer or message-signing helpers.

## Deployment policy

No Vercel source-link change, production setting change, deployment, alias promotion, contract deployment, wallet signing or transaction has been performed as part of this audit.
