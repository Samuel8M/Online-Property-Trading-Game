import { pool } from "@workspace/db";
import {
  type StoredGame, reconcileLifecycle, reconcileTrades, normalizeGame,
  PRESENCE_TIMEOUT_MS, LOBBY_SEAT_GRACE_MS,
} from "./game-engine";
import { logger } from "./logger";

export const ROOM_SWEEP_BATCH_SIZE = 100;
export const ROOM_SWEEP_WORKERS = 4;
export const ROOM_SWEEP_BUDGET_MS = 2000;

// Scheduling metadata is only a projection. Reconciliation still reads the saved
// deadlines under the authoritative room lock, never a deadline from this index.
export function nextRoomCheck(game: StoredGame): Date | null {
  if (game.phase === "finished") return null;
  const deadlines: number[] = [];
  for (const player of game.players) {
    if (player.resigned) continue;
    if (player.connected) deadlines.push(player.lastSeenAt! + PRESENCE_TIMEOUT_MS);
    if (game.phase === "lobby") deadlines.push(player.lastSeenAt! + LOBBY_SEAT_GRACE_MS);
  }
  if (game.phase === "playing") {
    if (game.auction) deadlines.push(game.auction.deadline);
    else if (!game.debt && game.turnDeadline != null) deadlines.push(game.turnDeadline);
  }
  return deadlines.length ? new Date(Math.min(...deadlines)) : null;
}

export function reconcileRoom(game: StoredGame, now: number) {
  reconcileLifecycle(game, now);
  reconcileTrades(game);
  normalizeGame(game, now);
}

// One room per transaction: neither row locks nor a slow room hold a whole
// batch hostage. SKIP LOCKED also lets independent server processes share work.
export async function sweepDueRooms(database = pool): Promise<{ processed: number; saturated: boolean }> {
  const started = Date.now();
  let attempts = 0;
  let processed = 0;
  const failed: string[] = [];
  async function worker() {
    while (attempts < ROOM_SWEEP_BATCH_SIZE && Date.now() - started < ROOM_SWEEP_BUDGET_MS) {
      attempts++;
      const client = await database.connect();
      let code: string | undefined;
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL statement_timeout = '2s'");
        const result = await client.query(
          `SELECT code, state FROM game_rooms
           WHERE next_reconcile_at <= $1 AND code <> ALL($2::text[])
           ORDER BY next_reconcile_at, code LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [new Date(), failed],
        );
        if (!result.rows.length) {
          await client.query("COMMIT");
          return;
        }
        code = result.rows[0].code;
        const game = result.rows[0].state as StoredGame;
        const original = JSON.stringify(game);
        reconcileRoom(game, Date.now());
        const serialized = JSON.stringify(game);
        // Metadata-only refreshes must not make inactive rooms look active in
        // the public lobby or reset any server-owned deadline.
        await client.query(
          `UPDATE game_rooms SET state = $1, next_reconcile_at = $2,
           updated_at = CASE WHEN $3 THEN NOW() ELSE updated_at END WHERE code = $4`,
          [serialized, nextRoomCheck(game), serialized !== original, code],
        );
        await client.query("COMMIT");
        processed++;
      } catch (err) {
        await client.query("ROLLBACK");
        if (!code) throw err;
        failed.push(code);
        logger.error({ err, code }, "Room timer reconciliation failed");
      } finally {
        client.release();
      }
    }
  }
  // Wait for every worker even on failure; the next sweep must not overlap
  // transactions left behind by an early Promise.all rejection.
  const workers = await Promise.allSettled(Array.from({ length: ROOM_SWEEP_WORKERS }, worker));
  const failure = workers.find(result => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return {
    processed,
    saturated: attempts >= ROOM_SWEEP_BATCH_SIZE || Date.now() - started >= ROOM_SWEEP_BUDGET_MS,
  };
}