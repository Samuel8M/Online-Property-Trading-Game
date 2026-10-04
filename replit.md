# Property Pursuit

An original multiplayer property-trading board game for 2–6 visitors to play in shared online rooms.

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

- Original names and a 28-space board rather than official Monopoly artwork or branding.
- Anonymous seat sessions are not user accounts; visitors do not need to register.
- Game mutations use PostgreSQL row locks so simultaneous requests cannot both take the same turn.
- Rooms are persisted, not kept only in one server process. The client refreshes shared state every second.

## Product

Public room discovery, create/join/watch, invite links, animated dice, property purchases, rent, complete-color bonuses, stations, taxes, surprise events, detention, bankruptcy, and a winner screen. The host starts after 2–6 players join. Each player rolls once per turn. This version does not include houses, hotels, mortgages, auctions, or player-to-player trades.

## User preferences

The user wants anyone visiting the webpage to be able to play, with dice visuals and a polished game experience.

## Gotchas

- Keep player session tokens private; never expose the room's token map in public game responses.
- Run API codegen after contract changes. Watch for Orval name collisions when an operation has both path and query parameters.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
