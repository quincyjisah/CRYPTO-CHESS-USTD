# Aries Protocol source review — 2026-11-19

## Scope and source of truth
Reviewed the saved `crypto_chess_arena_v11_LAUNCH_READY.zip` archive. The GitHub repository's current default branch contains only a generic README; the reviewed application and contract source are not yet present in this repository. This document records source-based findings only. No Solidity compile, Hardhat/Forge tests, deployment or transaction was run.

## Release decision
**NO-GO for real funds or mainnet deployment.**

## Verified blockers

### P0 — a player can refund a fully locked game after 24 hours
`AriesEscrow.refund()` accepts both `WhiteLocked` and `BothLocked`. After `LOCK_TIMEOUT`, either participant can refund even after both wagers are locked. This contradicts the function comment, which describes timeout refund as the opponent never locking, and allows unilateral cancellation of a live game.

Remediation: restrict the timeout refund to the one-sided lock state. Add explicit game-start, completion and settlement deadlines, and a separate governed cancellation/dispute path for games where both players locked.

### P0 — disputed escrow has no terminal path
`disputeGame()` moves a `BothLocked` game to `Disputed`, but this contract version has no resolver or refund/settlement function for that state. Funds can remain locked indefinitely.

Remediation: add a separately governed dispute resolver and a bounded fallback path. Every escrow state must have a defined, testable terminal transition.

### P1 — operational roles are concentrated
The constructor grants DEFAULT_ADMIN, SETTLER, PAUSER and TREASURY roles to `msg.sender`. The treasury destination is a separate address, but the role holder is not.

Remediation: define distinct governance-controlled addresses, preferably multisigs, with documented role transfer and recovery procedures.

### P1 — token allowlist lifecycle is incomplete
`addToken(address(0))` is not rejected. `removeToken()` can disable a token while open games or collected fees still reference it.

Remediation: reject zero address and block removal while outstanding obligations or fees exist.

### P1 — NFT batch mint bypasses validation
`AriesGenesisNFT.batchMint()` does not enforce the same recipient, piece-type, rarity, IPFS URI or per-season cap checks as `mint()`.

Remediation: share validation logic between mint paths and add adversarial tests for invalid recipients, enum values, metadata URIs and season-cap exhaustion.

### P0 — Hardhat source path excludes the production contracts
The saved Hardhat workspace sets `paths.sources = ./contracts` relative to `backend/contracts-workspace`. That directory contains only `MockERC20.sol`; `AriesEscrow.sol` and `AriesGenesisNFT.sol` are located in `backend/contracts`. The tests and deployment script request production artifacts that this workspace cannot generate as configured.

Remediation: move/copy the reviewed production contracts into the configured source directory or correct the source path; regenerate TypeChain artifacts; run a clean compile and test suite.

## Correction to earlier review
The inspected archive version has no `credit()`, `totalLiability` or balance-credit function. Any earlier reserve-double-pledge claim based on those symbols does not apply to this specific archive version.

## Required verification
1. Align the Hardhat workspace and production source.
2. Add regression tests for the timeout-refund and dispute-state bugs.
3. Add token lifecycle and NFT batch-mint adversarial tests.
4. Run clean compile, unit, fuzz and invariant tests.
5. Complete independent contract audit and testnet end-to-end lifecycle.
6. Deploy only with multisig governance after all gates pass.

Do not treat historical checklist ticks or prior build claims as fresh verification for this archive.
