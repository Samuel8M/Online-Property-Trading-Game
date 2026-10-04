# Property Pursuit: development, mortgages, and trades

Development, mortgages, and trades work on both the original saved 28-space games
and the main project's new 40-space Monopoly board. The main project's branding,
classic board, doubles, Jail choices, and separate card decks remain intact.
Existing in-progress 28-space games keep their deeds, positions and anonymous seats.
Older waiting rooms adopt the classic board on start, as in the main project.

## Development

- Only the active, non-bankrupt player may manage property, before or after rolling.
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
- Existing automatic bankruptcy remains: there is no debt-resolution pause.
  Manage assets before rolling if cash is low. Properties inherited by a creditor
  keep buildings and mortgages; properties returned to the bank lose both.

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