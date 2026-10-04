---
name: Auction participation and binding bids
description: Product reasoning behind explicit declines, voluntary participation, and the auction cash freeze
---

Auctions require an explicit property decline, not a turn timeout. Participation is voluntary through bidding or permanent withdrawal; there is no separate host approval or room-wide vote.

**Why:** The requested consensual auction should not spend anyone's cash without their own bid, or turn an absent player's skipped turn into a new auction.

**How to apply:** Preserve the distinction between declining and timing out. Any future room rules or auction automation should keep bids explicitly authorized by each participant.

Leading bids are binding, and other cash-changing actions pause until the auction resolves.

**Why:** Validating available cash when bidding is insufficient if a bidder can spend or trade it away before an award. The pause avoids escrow accounting while guaranteeing payment at closure.

**How to apply:** If future work permits property management, trades or resignation during an auction, introduce bid-reservation-aware validation and settlement first; do not simply remove the pause.