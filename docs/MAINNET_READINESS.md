# Mainnet Readiness Plan

This document is the lantern at the gate: it names what must be true before Crypto Chess
USTD/USDT can carry real wagers on mainnet. The current app is still a prototype; no
wallet, contract, NFT, livestream, ad, or tipping feature should be called production-ready
until each checklist item is complete and independently reviewed.

## Economic rule

For every two-player wager match:

1. Both players must stake the same supported stablecoin amount.
2. The escrowed pot is `playerStake * 2`.
3. The platform fee is `2%` of the escrowed pot, represented as `200` basis points.
4. The winner payout is `escrowedPot - platformFee`.
5. Example: `10 + 10 USDT = 20 USDT`; platform fee is `0.40 USDT`; winner receives
   `19.60 USDT`.
6. All token math must use integer token units on-chain, never floating-point numbers.

## Game rules that must be finished before money moves

- Legal moves, captures, castling, en passant, promotion, check, checkmate, stalemate, and
  draw rules must be deterministic and exhaustively tested.
- Match clocks, disconnect windows, resignations, abandoned games, disputes, and refunds
  must be encoded in a public rulebook.
- The game engine must produce tamper-evident match records that can be verified before
  settlement.
- Anti-cheat monitoring must be designed without secretly recording users or violating
  platform privacy rules.

## NFT rules that must be finished before minting

- NFTs must be optional, clearly consented to, and never required to withdraw winnings.
- Winner badges may mint only after final settlement.
- NFT metadata must avoid doxxing wallet owners, emails, IP addresses, or private match
  chat.
- Royalties, transferability, supply caps, chain IDs, contract addresses, and metadata
  permanence must be documented before launch.
- NFT contracts need unit tests, fuzzing, static analysis, deployment scripts, and an
  independent audit.

## Wallet, escrow, and smart-contract gates

- Integrate WalletConnect or another audited wallet provider with explicit chain allowlists.
- Show the exact chain, token address, spender, amount, fee, and recipient before every
  signature.
- Never ask for seed phrases, private keys, unlimited approvals, or blind signatures.
- Use audited escrow contracts with reentrancy protection, pause controls, dispute paths,
  timeout paths, and event logs.
- Use integer token units and verified stablecoin token addresses per chain.
- Require testnet deployments, public verification, monitoring, and emergency runbooks
  before mainnet.

## Phishing and exploit defenses

- Put `quincy.j.isah@gmail.com` only in support/documentation contexts; never use email as
  a wallet identity proof.
- Add domain allowlists and warn users before opening external livestream, ad, or social
  links.
- Escape or sanitize all user-controlled names, chat, stream titles, and NFT metadata.
- Rate-limit matchmaking, tipping, chat, login, and wallet actions.
- Add fraud monitoring for wash play, collusion, botting, chargeback-like behavior, and
  tip laundering.
- Add content moderation and reporting for livestreams, chat, usernames, avatars, and NFT
  images.
- Add a real secret scanner in CI and rotate any leaked key immediately.

## Audio, video, livestream, ads, and tipping gates

- Background music and game effects must default to user-controlled playback and support
  mute controls.
- Camera and microphone must default to muted and request permission only after a clear
  user gesture.
- TikTok, Facebook, Instagram, YouTube, Twitch, and X livestreaming require platform
  approvals, OAuth scopes, stream-key protection, moderation, and terms-of-service review.
- Viewer tips must use clear fee disclosures, anti-money-laundering controls where
  required, refund rules, and abuse monitoring.
- Google Ads must not obscure game-critical actions, wallet prompts, fee disclosures, or
  settlement confirmations.

## Scale gates for 10,000 to 1,000,000 users

- Use stateless web/API nodes behind autoscaling load balancers.
- Separate real-time game servers, matchmaking, chat, media signaling, payment indexing,
  and analytics into independently scalable services.
- Use queues for settlement jobs, notifications, moderation, and stream events.
- Add database read replicas, backups, migrations, rate limits, and disaster recovery.
- Add observability: metrics, logs, traces, synthetic checks, alerting, and on-call runbooks.
- Load test the full lifecycle: login, wallet connect, matchmaking, gameplay, tipping,
  streaming, settlement, and withdrawal.

## Final mainnet vow

Do not launch mainnet wagers until contracts, game rules, wallet flows, fee accounting,
NFT minting, tipping, ads, livestreaming, compliance, and operations have all passed testnet
trials and independent security review.
