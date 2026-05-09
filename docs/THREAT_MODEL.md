# Threat Model and Recheck

The codebase was rechecked for weakness classes requested by the project owner: exploits,
phishing, wallet abuse, fee mistakes, NFT risk, livestream abuse, ad risk, tipping abuse,
and scale failure.

## Current protections in the prototype

- User-facing strings rendered from match data are HTML-escaped before insertion.
- The 2% platform-fee rule is centralized and unit tested.
- Livestream destinations are visible but disabled until platform-approved backends exist.
- NFT rules are documented but minting is disabled.
- Audio playback requires a user gesture and can be muted.
- CI runs formatting, linting, tests, build, dependency audit, dependency review, and secret
  scanning.

## Critical risks still open

| Area             | Risk                                                             | Required control before mainnet                                                            |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Wallets          | Fake prompts, wrong chain, unlimited approvals, blind signatures | Wallet provider integration, chain allowlists, exact transaction previews, approval limits |
| Escrow           | Reentrancy, stuck funds, bad fee math, malicious token behavior  | Audited contracts, integer token math, formal tests, emergency pause, withdrawal paths     |
| Chess settlement | Cheating, forged wins, disconnect griefing                       | Deterministic game engine, signed moves, server arbitration, replayable match logs         |
| Phishing         | Fake social links, impersonated support, malicious ads           | Domain allowlists, signed announcements, support policy, ad placement review               |
| Tips             | Laundering, spam, mistaken transfers                             | Rate limits, clear disclosures, monitoring, refund/dispute rules                           |
| Livestream       | Stream-key theft, harassment, illegal content                    | Server-side key custody, moderation, reporting, platform policy review                     |
| NFTs             | Doxxing metadata, stolen art, misleading rewards                 | Metadata review, consent, takedowns, audited mint contracts                                |
| Scale            | Matchmaking collapse, hot partitions, delayed settlement         | Load tests, queues, cache strategy, autoscaling, observability                             |

## Mainnet verdict

The repository is healthier than a blank scaffold, but the crown is not yet mainnet. It is
ready for prototype demos and testnet planning; it is not ready to custody funds or settle
real wagers until the controls in `docs/MAINNET_READINESS.md` are complete.
