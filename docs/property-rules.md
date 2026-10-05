# Property Pursuit: development, mortgages, and trades

Development, mortgages, and trades work on both the original saved 28-space games
and the main project's new 40-space Monopoly board. The main project's branding,
classic board, doubles, Jail choices, and separate card decks remain intact.
Existing in-progress 28-space games keep their deeds, positions and anonymous seats.
Saved waiting rooms also retain their original board when started.

## Voluntary property auctions

- After rolling onto any unowned purchasable deed (colored property, railroad or
  utility), the active player may buy at list price or explicitly decline and open
  an auction. Declining works even when list price is unaffordable. Turns have no
  time limit, so an auction only ever starts from an explicit decline.
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
- Rolling, buying, ending a turn, managing property,
  trading and resignation are blocked during the auction. Pending trades retain
  their usual validation and may become invalid after the winner pays.
- Closure completes the declined landing and advances to the next live player.
  On the classic board, an earned doubles roll instead resumes for the original
  player; an unsold property does not reopen an auction on that resolved landing.
- Auction ID, bids, eligible players, withdrawals and deadline are stored in the
  room JSON. Anonymous session tokens authorize actions,
  and auction IDs reject stale/repeated requests. Room row locks serialize bids
  and awards with auction expiry. One-second room polling refreshes all sessions;
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
  Building, redeeming, buying, rolling, passing and seat resignation are blocked
  for everyone during the pause. Ordinary offers still undergo asset validation
  but cannot be accepted; participants may reject or cancel them.
- Once enough cash is raised, the debtor explicitly pays the full saved amount.
  The debt panel and Your properties show a read-only liquidation estimate:
  current cash + legal building-sale proceeds + available mortgage advances,
  compared with the full saved debt (not a recalculated rent or repair charge).
  It includes a sequence of highest-level, even sales, with each hotel first
  returning to four houses and every level refunding half its build cost,
  rounded down. Mortgages count only owned, not-already-mortgaged deeds, including
  railroads and utilities; colored deeds unlock only after their entire group
  has no buildings. Other owners' buildings can block sales and mortgages in
  inherited groups. There is no limited bank house supply in this game.
  The estimate refreshes with room state after each action and reload. It reports
  whether liquidation can cover the debt and any remaining shortfall or surplus,
  but never sells, mortgages, settles, or declares bankruptcy automatically.
  The Pay button still requires actual cash, not estimated proceeds.
  Repeated or stale settlement requests cannot pay again: each debt has its own ID,
  checked under the same database row lock as every other room mutation.
- The debtor may instead confirm permanent bankruptcy. All remaining cash, deeds
  and held Jail cards transfer to the creditor. Inherited deeds retain buildings
  and mortgages; deeds returned to the bank lose both, and held cards return to
  their decks. The bankrupt player is out; the last live player wins.
- Debts have no deadline and survive reloads and restarts. After resolution,
  the original turn continues. A bankrupt active player is skipped.
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
- During a debt pause only the saved debtor may propose, including off-turn.
  The request must name the current debt ID. The server attaches its saved ID,
  debtor, creditor and full amount to the offer; clients cannot choose a different
  obligation. These offers must strictly increase the debtor's net cash.
  If any debtor deeds leave, post-trade cash must cover the entire saved amount.
  This deliberately disallows partial deed sales below full cash coverage,
  underpriced estate gifting and property-only swaps while insolvent.
  Incoming cash help with no outgoing deeds may be partial. Offered cash must
  still be affordable independently; requested incoming deeds follow normal rules.
  Trading with the creditor is allowed, but cash paid for deeds does not forgive
  or net off the obligation. Acceptance never settles debt automatically.
- Debt offers recheck that exact obligation and coverage at acceptance and during
  reconciliation. Settlement, bankruptcy or a different queued debt invalidates
  pending debt offers; they never become ordinary offers. Pre-debt ordinary
  offers remain paused and can resume after resolution if still valid.
  Acceptance, settlement and bankruptcy use the same room row lock, so concurrent
  requests cannot transfer the same estate twice or pay a debt twice.
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