# Monopoly Online

An unofficial, fan-made online Monopoly game for 2–6 players. Create a room, share
the code or invite link, and play on the classic 40-space board in the browser.
No accounts needed.

**Features:** the full board, animated dice, doubles and three-doubles-to-Jail,
Jail (doubles, $50 fine, Get Out of Jail Free cards), separate Chance and Community
Chest decks, houses and hotels with even building, mortgages, cash/deed trades,
auctions for declined deeds, debt recovery and bankruptcy, table chat, untimed
turns, spectators, and reconnecting to your seat after a reload.

## Deploy your own (free)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Samuel8M/Online-Property-Trading-Game)

1. Click the button and sign in to Render with GitHub.
2. Approve the blueprint. It creates a free web service and a free PostgreSQL database.
3. Wait for the first build (about 3–5 minutes), then open the `onrender.com` URL.

The free tier has some limits. The web service sleeps after 15 minutes without visitors,
and the first visit after that takes about a minute to wake it. Render's free
PostgreSQL databases expire after 30 days. To keep your data longer, create a free database
on [Neon](https://neon.tech) and set the service's `DATABASE_URL` to its connection string
(include `?sslmode=require`).

Any other host that can run Node 24 and provide PostgreSQL also works:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run build:web
DATABASE_URL=postgres://... PORT=8080 pnpm start
```

The server creates its database table on first start.

## Local development

You need Node 24+, pnpm (`corepack enable`), and a PostgreSQL database.

```sh
pnpm install
# Terminal 1: API server on :8080
DATABASE_URL=postgres://... PORT=8080 pnpm --filter @workspace/api-server run dev
# Terminal 2: web client on :5173 (proxies /api to :8080)
pnpm --filter @workspace/property-pursuit run dev
```

Tests:

```sh
pnpm run typecheck
pnpm --filter @workspace/scripts run test:game         # rules engine + client unit tests
# With a server running and DATABASE_URL set:
GAME_API_BASE=http://localhost:8080 pnpm --filter @workspace/scripts run test:game-api
pnpm --filter @workspace/api-server run test:timers
pnpm --filter @workspace/api-server run test:debt
```

See [docs/property-rules.md](docs/property-rules.md) for the full rules and
[replit.md](replit.md) for architecture notes.

## Layout

- `artifacts/property-pursuit` is the React web client.
- `artifacts/api-server` is the Express API and the server-side game engine.
- `lib/api-spec` is the OpenAPI contract. Run `pnpm --filter @workspace/api-spec run codegen` after you change it.
- `lib/db` holds the PostgreSQL schema (Drizzle).

*Monopoly is a trademark of Hasbro. This project is not affiliated with or endorsed by Hasbro.*
