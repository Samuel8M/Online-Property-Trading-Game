import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Hosted providers (Render, Neon, etc.) require TLS for external connections.
const ssl = /[?&]sslmode=(require|verify-ca|verify-full)/.test(process.env.DATABASE_URL)
  || process.env.DATABASE_SSL === "true"
  ? { rejectUnauthorized: false }
  : undefined;

export const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl });
export const db = drizzle(pool, { schema });

// Idempotent bootstrap matching ./schema, so a fresh database needs no
// separate migration step before the server starts.
export async function ensureSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_rooms (
      code text PRIMARY KEY,
      state jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      next_reconcile_at timestamptz DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS game_rooms_due_idx ON game_rooms (next_reconcile_at, code)
      WHERE next_reconcile_at IS NOT NULL;
  `);
}

export * from "./schema";
