# Aries Protocol — Proposed Game and Escrow Rules

**DRAFT — NOT EFFECTIVE.** These are product-design notes, not current customer terms or an offer to wager. No production contract deployment, funded match flow, live payout service or regulated wagering approval is in place. Do not use this document to invite deposits or advertise real-value matches.

## 1. Product scope

The intended product explores chess matches with optional crypto-native escrow. The current frontend supports free-play and prototype UI flows; it does not accept match stakes, initiate escrow deposits or pay out winners.

## 2. Current local escrow-source behaviour

The following describes the local `AriesEscrow.sol` source, not a deployed contract or live service:

- The escrow accepts only ERC-20 token addresses added to its allow-list by the contract administrator. Actual supported token addresses depend on deployment configuration and are not established here.
- Both participants must lock the same token and the same per-player amount. Exact token receipt is checked; fee-on-transfer tokens are rejected.
- A second player must match the first player's declared opponent and the original lock window.
- A trusted `SETTLER_ROLE` starts the match with a deadline no more than seven days from start. The contract itself does not validate chess moves, operate a per-move clock or independently determine a winner.
- A winner settlement deducts **2% from the combined pot**. The remaining pot is transferred to the selected participant.
- A draw settlement (`winner == address(0)`) returns each wager in full and charges no fee.
- A player can raise a dispute while the started game is before its deadline. A trusted settler may resolve the dispute within seven days; after the dispute timeout, either participant can claim a refund.
- If the second player does not lock within 24 hours, or a fully locked game is not started within its 24-hour lock window, either participant can recover the locked amount. A participant can also recover after the active game deadline.
- The trusted settler can cancel an unstarted game, but cannot use the refund path to unilaterally cancel a started match.

These rules are enforced only by the checked-in contract code and tests. They are not available to users until a selected contract version is independently reviewed, deployed and tested.

## 3. Gameplay policies still to be specified

A production game specification must separately define chess clocks, disconnect handling, resignation, draw offers, anti-cheat evidence, server failure recovery, match finality, appeals and the authority used to attest the outcome. None of these should be advertised as contract-enforced unless the deployed architecture actually enforces it.

## 4. Fee and settlement example — source model only

For a hypothetical 10 + 10 unit match, the pot is 20 units. A winner settlement takes 0.4 units (2%) and pays 19.6 units to the winner. A draw settlement returns 10 units to each participant with no fee. This is an illustration of the local contract's current constants, not a live price or customer offer.

## 5. Launch requirements

Independent contract audit, deployment verification, verified wallet ownership, strict player/game authorisation, authoritative anti-cheat and match-finality policy, idempotent settlement, monitoring, incident response, consumer terms and jurisdiction-specific legal review are mandatory before real-value play.
