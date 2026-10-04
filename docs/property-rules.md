# Property Pursuit: development, mortgages, and trades

Development, mortgages, and trades work on both the original saved 28-space games
and the main project's new 40-space Monopoly board. The main project's branding,
classic board, doubles, Jail choices, and separate card decks remain intact.
Existing in-progress 28-space games keep their deeds, positions and anonymous seats.
Saved waiting rooms also retain their original board when started.

## Voluntary property auctions

- After rolling onto any unowned purchasable deed (colored property, railroad or
  utility), the active player may buy at list price or explicitly decline and open
  an auction. Declining works even when list price is unaffordable. A normal turn
  timeout does not open an auction; it still skips the turn.
- All live, non-resigned seated players may bid, including the decliner, players
  in Jail, and away players who reconnect. Spectators and bankrupt players cannot.
  Nobody is required to bid. No separate room vote or host approval is needed.
- The opening bid is at least $10. Each later bid must be at least $10 above the
  current highest bid. Amounts are whole dollars, at most $1,000,000 and no more
  than the bidder's current cash. Borrowing and mortgaging during bidding are not
  allowed. Only the winner pays; all money goes to the bank.
- Withdrawal is permanent for that auction. A leading bidder cannot withdraw or
  raise their own bid. Once outbid, they may bid again or withdraw.
- The auction has a persisted 30-second deadline, restarted by each accepted bid
  (not by withdrawals). It closes immediately when every player other than the
  leader has withdrawn, or when the deadline expires. With no leader, all players
  must withdraw for early closure; otherwise timeout closes it unsold. Away seats
  do not block timeout. The highest bidder pays exactly once and gets the deed;
  with no bids it remains unowned. Outcome and bids appear in table history.
- The normal turn timer pauses. Rolling, buying, ending a turn, managing property,
  trading and resignation are blocked during the auction. Pending trades retain
  their usual validation and may become invalid after the winner pays.
- Closure completes the declined landing and advances to the next live player
  with a fresh 90 seconds. On the classic board, an earned doubles roll instead
  resumes for the original player with their saved time; an unsold property does
  not reopen an auction on that resolved landing.
- Auction ID, bids, eligible players, withdrawals, deadline and remaining turn
  time are stored in the room JSON. Anonymous session tokens authorize actions,
  and auction IDs reject stale/repeated requests. Room row locks serialize bids
  and awards with timer expiry. One-second room polling refreshes all sessions;
  reloads restore the same auction, and the server closes it without any browser.

## Development

- Normally only the active, non-bankrupt player may manage property, before or after
  rolling. During a debt pause only the debtor may sell buildings or mortgage deeds,
  including a debtor who owes money off-turn because of a card.
- Only colored properties can be developed. Own every property in the color group,
  with no mortgages anywhere in that group.
- Build one level at a time, evenly: choose a property at the group's lowest level.
  Levels 1–4 represent houses; level 5 represents one hotel replacing four houses.
- Building cost per level: Copper $50; Coral/Garden $100; Violet/Sapphire $150;
  Rose/Gold $200 in legacy rooms. On the classic board: Brown/Light blue $50,
  Pink/Orange $100, Red/Yellow $150, Green/Dark blue $200.
  There is no limited bank supply of buildings.
- Base rent multiplies by 2 for an undeveloped complete, unmortgaged group.
  In legacy rooms, rent with 1/2/3/4 houses is 3/5/7/9 times base rent; a hotel is
  12 times base. On the classic board, each deed has its standard house/hotel rent
  schedule (shown in the deed detail); Boardwalk's hotel rent is $2,000.
  Chance and Community Chest repair cards charge per house or hotel owned.
- Sell one level at a time from a property at the group's highest level, receiving
  half the building cost. Selling a hotel returns it to four houses.

## Mortgages

- Mortgage an owned property or station for half its purchase price (rounded down).
  A colored group must have no buildings before any of its properties is mortgaged.
- Mortgaged properties collect no rent. A mortgage anywhere in a colored group
  removes that group's undeveloped complete-group rent bonus. Mortgaged stations
  do not count toward station rent. Mortgaged utilities do not count toward the
  two-utility multiplier; normal utility rent still uses the actual landing dice.
- Redeem for the mortgage advance plus 10%, rounded up, when affordable.

## Debt resolution and bankruptcy

- Rent, taxes, Jail/Detention fines, repairs and other card payments that exceed
  cash enter a debt-resolution pause instead of causing automatic bankruptcy.
  No partial payment is taken. The full amount and creditor (or bank) are saved.
- Only the debtor can sell buildings evenly or mortgage undeveloped deeds.
  Building, redeeming, buying, rolling, passing, trading and seat resignation are
  blocked for everyone during the pause. Existing offers still undergo normal
  asset validation but cannot be accepted during debt resolution.
- Once enough cash is raised, the debtor explicitly pays the full saved amount.
  Repeated or stale settlement requests cannot pay again: each debt has its own ID,
  checked under the same database row lock as every other room mutation.
- The debtor may instead confirm permanent bankruptcy. All remaining cash, deeds
  and held Jail cards transfer to the creditor. Inherited deeds retain buildings
  and mortgages; deeds returned to the bank lose both, and held cards return to
  their decks. The bankrupt player is out; the last live player wins.
- The turn timer pauses without a debt deadline and survives reloads and restarts.
  After resolution, the original turn resumes with its saved remaining time.
  A bankrupt active player is skipped and the next player gets a full turn.
  An off-turn debtor does not take over the active player's turn.
- Cards involving multiple players save remaining obligations and resolve them
  in player order, one debt at a time. Bankruptcy cancels later obligations of
  the bankrupt player. A forced Jail fine pauses movement; payment resumes the
  already rolled move exactly once, including any new landing payment.
  Choosing to pay before rolling instead releases the player without rolling.

## Consensual trades

- The active player may propose one pending outgoing offer to another live player.
  An offer contains cash and/or property IDs on either side; at least one side
  must offer something. Cash is nonnegative whole dollars.
- A property cannot be traded while any property in its colored group has buildings.
  Stations and mortgaged, undeveloped properties may be traded.
- Mortgages stay attached with no transfer fee. The recipient owes the normal
  redemption price; mortgage status is displayed in the offer.
- Offers do not reserve cash or property. Only the recipient can accept or reject;
  only the proposer can cancel. Responses can occur outside the recipient's turn.
- Acceptance rechecks phase, live seats, cash, ownership, group buildings, and the
  offered mortgage statuses. Both sides must independently afford their offered cash.
  Both transfers happen atomically under the room's database row lock.
- Offers invalidated by subsequent cash, ownership, building, mortgage, bankruptcy,
  or game-end changes are marked invalidated, never silently adjusted.
- Resolved offers remain visible in the room (the latest 30 plus all pending offers).
  Anonymous session tokens authorize actions and are never included in public state.