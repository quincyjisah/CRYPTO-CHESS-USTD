# Aries Protocol — Solidity Contract Test Workspace

**Purpose:** Hardhat compile/test environment for the local Aries escrow and Genesis NFT Solidity sources.
**Built for:** Smart-contract engineers, security reviewers and maintainers validating game escrow, refund/dispute flows, token safety and cosmetic NFT controls.
**Stage:** Local development and testing only. No production deployment or independent contract audit is confirmed.

## Source files

Contracts are kept in the parent directory `../contracts/`:

- `AriesEscrow.sol` — ERC-20 wager locks, winner settlement, draw return, disputes, timeout refunds and role controls.
- `AriesGenesisNFT.sol` — cosmetic ERC-721 issuance, role-gated minting, seasonal/lifetime caps, cooldown and ERC-2981 royalties.
- `MockERC20.sol` and `MockFeeOnTransferERC20.sol` — test tokens for standard and non-exact transfer behaviour.

## Local verification

Requirements: Node.js 20+ and npm.

```bash
npm ci
npm test
npm run compile
```

## Current source-level parameters

- Escrow winner fee: 200 basis points (2%) on the combined pot; draw settlement returns both stakes in full.
- Escrow deadline limit: seven days from start; unstarted lock window and dispute timeout are 24 hours and seven days respectively.
- NFT maximum supply: 10,000; maximum seasonal cap: 1,000.
- NFT default ERC-2981 royalty: 500 basis points (5%); distinct creator token override: 300 basis points (3%).

These values are source constants/defaults and may be changed by reviewed code or configuration before a future release. They are not deployed network settings or customer terms.

## Deployment safety

Do not run `deploy:sepolia`, `deploy:mainnet`, contract verification or wallet transaction scripts during ordinary testing. These commands require a separately approved release process, dedicated deployment secrets, testnet adversarial verification and independent security review. Never commit private keys or wallet material.
