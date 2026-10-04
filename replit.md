# Monopoly Online

An unofficial fan-made online Monopoly game for 2–6 visitors to play in shared rooms.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/property-pursuit run dev` — run the web game through its managed workflow
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

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

## Product

Public room discovery, create/join/watch, invite links, animated dice, property purchases, rent, complete-color bonuses, railroads, dice-based utilities, taxes, separate shuffled Chance and Community Chest decks, Jail, bankruptcy, and a winner screen. Doubles earn another roll; three consecutive doubles send the player to Jail. Jail supports doubles attempts, a $50 fine, and Get Out of Jail Free cards. Houses, hotels, mortgages, auctions, and player-to-player trades are not yet part of the main build.

## User preferences

The user wants anyone visiting the webpage to be able to play, with dice visuals and a polished game experience. They explicitly want Monopoly—not a shortened property-trading substitute—with the full board, trading, and extra rolls for doubles. Do not simplify that scope again. The screen must show the whole board, rather than requiring horizontal scrolling to see it.

## Gotchas

- Keep player session tokens private; never expose the room's token map in public game responses.
- Run API codegen after contract changes. Watch for Orval name collisions when an operation has both path and query parameters.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
