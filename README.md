# Aries Protocol / Crypto Chess Arena

This repository is being prepared as the canonical source repository for the Aries Protocol crypto chess application.

**Current status: NOT READY FOR REAL FUNDS.** The application and Solidity sources reviewed on 2026-11-19 are still in a saved project archive and have not yet been imported into this repository. Do not assume this repository's default branch contains the launch archive or production contracts.

## Security review

See [SECURITY_REVIEW_2026-11-19.md](SECURITY_REVIEW_2026-11-19.md) on the audit branch for the source-based escrow, NFT and Hardhat workspace findings. The key release blockers are:
- A player can refund a fully locked game after the 24-hour timeout.
- Disputed escrow has no resolution path.
- Administrative roles are concentrated.
- NFT batch mint bypasses validation and seasonal cap checks.
- The saved Hardhat workspace excludes the production contracts from its configured source directory.

No mainnet deployment, real-fund acceptance or production release is authorised by this repository state.

## Source import required

The reviewed archive is named `crypto_chess_arena_v11_LAUNCH_READY.zip` in the project Library. Import the exact reviewed source into this repository only after the contract blockers are fixed and the build/test toolchain is reproducible. Keep deployment secrets and private keys out of Git history.

## Historical scaffold

This project was initially generated from Google AI Studio. That scaffold README is not a statement of current implementation or release readiness.
