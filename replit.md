# Monopoly Online

An unofficial fan-made online Monopoly game for 2–6 visitors to play in shared rooms.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/property-pursuit run dev` — run the web game through its managed workflow
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/scripts run test:game` — game rules and room lifecycle unit tests
- `pnpm --filter @workspace/scripts run test:game-api` — opt-in live API tests against the managed workflow; only test-created rooms are modified and cleaned up
- `pnpm --filter @workspace/api-server run test:timers` — indexed timer concurrency/load checks in a temporary database schema
- `pnpm --filter @workspace/api-server run test:timers-api` — timer checks plus live lifecycle API regression checks against the managed workflow
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

### Deadline sweep monitoring

The API emits `event: "room_deadline_sweep"` structured summaries at most once
every 30 seconds (including idle periods). `sweeps`, `processed`,
`saturatedSweeps`, `failedRooms`, `failedSweeps`, `totalDurationMs`, and
`maxDurationMs` describe batches since the previous report;
`consecutiveSaturatedSweeps` describes the current drain streak.
`oldestOverdueAgeMs` is a fresh, non-locking read of the oldest indexed deadline,
including rows skipped by workers because of held locks. Zero means no overdue
work; null with `overdueSampleFailed: true` means monitoring could not read it.
Warnings fire at 15 seconds overdue or on sweep/sample failures, and return to
info summaries on recovery. This is an operational warning threshold, not a
game timeout. The read runs separately from reconciliation, is read-only, and
has a 100ms SQL statement timeout. Summaries contain no room identifiers, saved
state, or tokens. `/api/healthz` remains a static, database-free liveness check.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/property-pursuit/src/` — lobby, board, dice, room controls, and browser seat persistence
- `artifacts/api-server/src/lib/game-engine.ts` — server-owned game rules
- `artifacts/api-server/src/routes/games.ts` — multiplayer game API
- `lib/api-spec/openapi.yaml` — API contract
- `lib/db/src/schema/game-rooms.ts` — saved room state

## Architecture decisions

- New rooms use the standard 40-space US Monopoly board and names, with original UI artwork and an unofficial fan-made notice.
- Existing 28-space games already in progress are preserved rather than silently remapping positions and deeds. Old waiting rooms adopt the full board when started.
- Anonymous seat sessions are not user accounts; visitors do not need to register.
- Game mutations use PostgreSQL row locks so simultaneous requests cannot both take the same turn.
- Rooms are persisted, not kept only in one server process. The client refreshes shared state every second.
- Public turns last 90 seconds total, including doubles. The deadline is saved in room JSON and checked under the same row lock as player actions. Invalid or late actions cannot roll back elapsed-time reconciliation.
- A five-second server sweep selects indexed due work, skips busy row locks, and drains bounded batches immediately while there is a backlog. Room writes update scheduling metadata atomically with saved state; direct database fixtures that change deadlines must also refresh `next_reconcile_at`. Existing rows receive an initial check through the column default. On recovery from an outage, the next player gets a full turn instead of rapidly skipping a backlog of turns.
- Authenticated room polling records presence (writes at most once per ten seconds); no contact for 45 seconds means away. An away player's active-game seat and assets remain available to their saved browser token indefinitely. Away does not mean resignation.
- Running tables pause after five minutes without contact from any non-resigned seat. They leave public discovery and scheduled background work without deleting players, assets, tokens, or unfinished decisions. Spectators cannot resume them. A saved seat returning under the room lock restores the same turn with a fresh 90-second deadline, or the same auction with a fresh 30 seconds; debts remain outstanding and receive a full turn after resolution. Discovery filters actual player contact before its limit, not room writes.
- In waiting rooms, a connected player takes over from an absent host, and seats are freed after five minutes away. Explicit lobby departure frees the seat immediately. Starting a room prevents later automatic seat reclamation.
- Resignation is permanent and requires UI confirmation. Cash is forfeited; deeds, improvements, mortgages, and held Jail Free cards return to the bank; pending trades invalidate. The active turn advances, or the sole survivor wins.

## Product

Public room discovery, create/join/watch, invite links, animated dice, property purchases, houses/hotels, upgraded rents, mortgages, consensual cash/deed trades, railroads, dice-based utilities, taxes, separate shuffled Chance and Community Chest decks, Jail, bankruptcy, and a winner screen. Doubles earn another roll; three consecutive doubles send the player to Jail. Jail supports doubles attempts, a $50 fine, and Get Out of Jail Free cards. Auctions are not included. See `docs/property-rules.md` for development, mortgage, and trade rules, including legacy-room compatibility.

## User preferences

The user wants anyone visiting the webpage to be able to play, with dice visuals and a polished game experience. They explicitly want Monopoly—not a shortened property-trading substitute—with the full board, trading, and extra rolls for doubles. Do not simplify that scope again. The screen must show the whole board, rather than requiring horizontal scrolling to see it.

## Gotchas

- Keep player session tokens private; never expose the room's token map in public game responses.
- Run API codegen after contract changes. Watch for Orval name collisions when an operation has both path and query parameters.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
