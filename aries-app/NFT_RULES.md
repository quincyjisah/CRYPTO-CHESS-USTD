# Aries Genesis Board — Proposed NFT Specification

**DRAFT — NOT EFFECTIVE.** No production Aries Genesis NFT collection or public mint/auction service is confirmed. This document describes the checked-in contract design only. It is not a token offer, holder-rights agreement, guarantee of marketplace royalties or legal IP licence.

## 1. Current local contract design

`AriesGenesisNFT.sol` currently defines:

- ERC-721 token name `Aries Genesis Board`, symbol `ARIESG`.
- A maximum total supply of **10,000**, not 64.
- A per-season cap of up to **1,000** tokens; the admin opens and closes seasons.
- Token metadata URIs are required to use `ipfs://` and are assigned during minting. An IPFS URI alone does not independently prove file permanence or authenticity.
- Minting is restricted to `MINTER_ROLE`; the contract is not an open public mint. Batch mint is a role-gated reward/airdrop path.
- Rarity-based mint prices are configured in the constructor: Common 0 ETH, Rare 0.02 ETH, Epic 0.08 ETH, Legendary 0.25 ETH and Genesis 1.00 ETH. These are local source defaults, not an active sale or accepted commercial price list.
- A default 5% ERC-2981 royalty is configured for the treasury. When a distinct creator is supplied at mint, that token receives a 3% creator royalty override. The admin can change the default royalty up to 10%. ERC-2981 is a royalty signal; payment is not guaranteed on marketplaces that do not honour it.
- NFTs are cosmetic and do not alter gameplay statistics. Transfers have a 24-hour post-mint/transfer cooldown and are blocked while the contract is paused.

## 2. Features not implemented by this contract

The contract does not implement auctions, bidding, outbid refunds, automatic marketplace listings, holder fee tiers, Genesis/Elite/Sovereign badges, governance voting or automatic match-fee discounts. Those ideas must not be represented as existing holder rights or benefits.

## 3. Ownership and licensing

Token ownership, copyright, commercial display rights, revenue limits, branding licences and derivative-work restrictions need a separately drafted and reviewed legal agreement. The smart contract does not establish the commercial terms described in earlier versions of this document.

## 4. Launch requirements

A selected release needs an independent contract audit, an approved deployment and treasury/governance design, verified IPFS metadata and artwork rights, a reviewed royalty policy, marketplace disclosure, consumer terms and applicable jurisdictional legal review. No mint, auction or holder benefit is live until those conditions are satisfied and independently verified.
