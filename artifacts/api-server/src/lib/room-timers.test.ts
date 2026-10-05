import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  createRoom, addPlayer, start, end, reconcileLifecycle, normalizeGame,
  type StoredGame, PRESENCE_TIMEOUT_MS, LOBBY_SEAT_GRACE_MS,
  ROOM_ABANDONMENT_MS, AUCTION_DURATION_MS, touchPresence,
} from "./game-engine";
import { nextRoomCheck, sweepDueRooms, oldestRoomOverdueAge, ROOM_SWEEP_BATCH_SIZE } from "./room-timers";

function room(code: string, playing = true) {
  const { game, token } = createRoom(code, "Host");
  addPlayer(game, "Partner");
  if (playing) start(game, token);
  return normalizeGame(game);
}
// Presence that is still marked connected but overdue gives the sweeper real work.
function stale(game: StoredGame, ageMs: number) {
  for (const player of game.players) player.lastSeenAt = Date.now() - PRESENCE_TIMEOUT_MS - ageMs;
  return game;
}

test("next check tracks presence, lobby grace, abandonment and auction deadlines, never turns", () => {
  const game = room("UNIT");
  const now = Date.now();
  for (const player of game.players) player.lastSeenAt = now;
  assert.equal(nextRoomCheck(game)?.getTime(), now + PRESENCE_TIMEOUT_MS);
  for (const player of game.players) player.connected = false;
  assert.equal(nextRoomCheck(game)?.getTime(), now + ROOM_ABANDONMENT_MS);
  game.debt = { id: "debt", debtorPlayerId: game.players[0]!.id, creditorPlayerId: null, amount: 100 };
  assert.equal(nextRoomCheck(game)?.getTime(), now + ROOM_ABANDONMENT_MS);
  game.debt = null;
  game.auction = {
    id: "unit", spaceId: 1,
    eligiblePlayerIds: game.players.map(p => p.id), withdrawnPlayerIds: [],
    highestBid: 0, highestBidderPlayerId: null, deadline: now + 1000, increment: 10,
  };
  assert.equal(nextRoomCheck(game)?.getTime(), now + 1000);
  game.phase = "lobby";
  game.auction = null;
  assert.equal(nextRoomCheck(game)?.getTime(), now + LOBBY_SEAT_GRACE_MS);
  game.phase = "finished";
  assert.equal(nextRoomCheck(game), null);
});

test("indexed due-room processing stays bounded and never waits for a busy table", { timeout: 30_000 }, async t => {
  // A private schema isolates load fixtures from the running API and other
  // tests. Dropping it cleans up only this test's data, including on failure.
  const schema = `timer_test_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`CREATE SCHEMA ${schema}`);
  const database = new (pool.constructor as new (options: typeof pool.options) => typeof pool)({
    ...pool.options, options: `-c search_path=${schema}`, max: 12,
  });
  async function insert(game: StoredGame, due = nextRoomCheck(game)) {
    await database.query("INSERT INTO game_rooms (code, state, next_reconcile_at) VALUES ($1, $2, $3)",
      [game.code, JSON.stringify(game), due]);
  }
  async function saved(code: string): Promise<StoredGame> {
    return (await database.query("SELECT state FROM game_rooms WHERE code = $1", [code])).rows[0].state;
  }
  try {
    await database.query("CREATE TABLE game_rooms (LIKE public.game_rooms INCLUDING ALL)");
    await t.test("an empty queue is distinguishable from an unavailable sample", async () => {
      assert.equal(await oldestRoomOverdueAge(database), 0);
      const result = await sweepDueRooms(database);
      assert.equal(result.processed, 0);
      assert.equal(result.saturated, false);
      assert.equal(result.failed, 0);
      assert.ok(result.durationMs >= 0);
      const ddl = await database.connect();
      try {
        await ddl.query("BEGIN");
        await ddl.query("LOCK TABLE game_rooms IN ACCESS EXCLUSIVE MODE");
        const began = performance.now();
        await assert.rejects(oldestRoomOverdueAge(database), /statement timeout/);
        assert.ok(performance.now() - began < 1000, "monitoring has a short server-side timeout");
      } finally {
        await ddl.query("ROLLBACK");
        ddl.release();
      }
      assert.equal(await oldestRoomOverdueAge(database), 0, "timeout releases and resets the connection");
    });
    await t.test("a held oldest row cannot delay other deadlines; concurrent sweeps process each room", async () => {
      const busy = stale(room("BUSY"), 5000);
      await insert(busy);
      const locked = await database.connect();
      await locked.query("BEGIN");
      await locked.query("SELECT code FROM game_rooms WHERE code = 'BUSY' FOR UPDATE");
      try {
        const count = ROOM_SWEEP_BATCH_SIZE * 3 + 17;
        for (let i = 0; i < count; i++) {
          await insert(stale(room(`DUE${i}`), 1000));
        }
        // Recent but not due tables must not cost one lock/query apiece.
        const idle = room("IDLE");
        await database.query(
          `INSERT INTO game_rooms (code, state, next_reconcile_at)
           SELECT 'IDLE' || n, $1::jsonb, NOW() + INTERVAL '1 hour'
           FROM generate_series(1, 1200) n`, [JSON.stringify(idle)],
        );
        await database.query("ANALYZE game_rooms");
        const plan = await database.query(
          `EXPLAIN SELECT code, state FROM game_rooms WHERE next_reconcile_at <= NOW()
           ORDER BY next_reconcile_at, code LIMIT 1 FOR UPDATE SKIP LOCKED`,
        );
        assert.match(plan.rows.map(row => row["QUERY PLAN"]).join("\n"), /Index Scan.*game_rooms/i);
        const samplePlan = await database.query(
          `EXPLAIN SELECT next_reconcile_at FROM game_rooms WHERE next_reconcile_at <= NOW()
           ORDER BY next_reconcile_at, code LIMIT 1`,
        );
        assert.match(samplePlan.rows.map(row => row["QUERY PLAN"]).join("\n"), /Index(?: Only)? Scan.*game_rooms/i);

        const began = Date.now();
        const first = await Promise.all([sweepDueRooms(database), sweepDueRooms(database)]);
        for (const result of first) {
          assert.ok(result.processed <= ROOM_SWEEP_BATCH_SIZE);
          assert.equal(result.saturated, true);
          assert.ok(result.durationMs >= 0);
          assert.equal(result.failed, 0);
        }
        assert.ok(first.reduce((n, result) => n + result.processed, 0) > 0);
        // Saturated batches are drained immediately, not delayed another five seconds.
        for (let i = 0; i < 5; i++) {
          const results = await Promise.all([sweepDueRooms(database), sweepDueRooms(database)]);
          if (results.every(result => !result.saturated)) break;
        }
        assert.ok(Date.now() - began < 5000, "unlocked deadlines drained within one normal sweep interval");
        const due = await database.query("SELECT state FROM game_rooms WHERE code LIKE 'DUE%'");
        assert.equal(due.rows.length, count);
        for (const row of due.rows) {
          const game = row.state as StoredGame;
          assert.ok(game.players.every(p => !p.connected), "overdue presence is marked away");
          assert.equal(game.turnNumber, 1, "untimed turns are never skipped");
          assert.equal(game.turnDeadline, null);
        }
        assert.ok((await saved("BUSY")).players.every(p => p.connected));
        const lockedOnly = await sweepDueRooms(database);
        assert.equal(lockedOnly.processed, 0);
        assert.equal(lockedOnly.saturated, false);
        assert.ok(await oldestRoomOverdueAge(database) >= 5000,
          "an apparently empty SKIP LOCKED batch still reports the held overdue deadline");
        const untouched = await database.query("SELECT count(*)::int AS n FROM game_rooms WHERE code LIKE 'IDLE%' AND updated_at < $1", [new Date(began)]);
        assert.equal(untouched.rows[0].n, 1200);
      } finally {
        await locked.query("ROLLBACK");
        locked.release();
      }
      await Promise.all([sweepDueRooms(database), sweepDueRooms(database)]);
      assert.ok((await saved("BUSY")).players.every(p => !p.connected));
      assert.equal(await oldestRoomOverdueAge(database), 0);
      await database.query("TRUNCATE game_rooms");
    });

    await t.test("an action holding the same row lock reconciles once before the sweeper resumes", async () => {
      const game = stale(room("ACTION"), 1);
      await insert(game);
      const action = await database.connect();
      try {
        await action.query("BEGIN");
        const result = await action.query("SELECT state FROM game_rooms WHERE code = 'ACTION' FOR UPDATE");
        const authoritative = result.rows[0].state as StoredGame;
        await Promise.all([sweepDueRooms(database), sweepDueRooms(database)]);
        reconcileLifecycle(authoritative);
        await action.query("UPDATE game_rooms SET state = $1, next_reconcile_at = $2 WHERE code = 'ACTION'",
          [JSON.stringify(authoritative), nextRoomCheck(authoritative)]);
        await action.query("COMMIT");
        await Promise.all([sweepDueRooms(database), sweepDueRooms(database)]);
        const reconciled = await saved("ACTION");
        assert.ok(reconciled.players.every(p => !p.connected));
        assert.equal(reconciled.turnNumber, 1);
      } finally {
        await action.query("ROLLBACK");
        action.release();
      }
      await database.query("TRUNCATE game_rooms");
    });

    await t.test("legacy rooms get grace, long-abandoned tables pause, and metadata does not reset room activity", async () => {
      const legacy = room("LEGACY", false);
      for (const player of legacy.players) {
        delete player.lastSeenAt;
        delete player.connected;
      }
      await insert(legacy, new Date(0));
      const old = room("OLD");
      Object.assign(old, { turnDeadline: Date.now() - 86_400_000 * 2 }); // Legacy timed save.
      stale(old, 86_400_000 * 2);
      await insert(old, new Date(0));
      await database.query("UPDATE game_rooms SET updated_at = NOW() - INTERVAL '2 days'");
      const inactive = room("INACTIVE");
      for (const player of inactive.players) player.connected = false;
      // Presence must actually be away, otherwise normalization changes the state.
      const awaySince = Date.now() - PRESENCE_TIMEOUT_MS - 1;
      for (const player of inactive.players) player.lastSeenAt = awaySince;
      normalizeGame(inactive);
      await insert(inactive, new Date(0));
      const before = (await database.query("SELECT updated_at FROM game_rooms WHERE code = 'INACTIVE'")).rows[0].updated_at;
      await sweepDueRooms(database);
      const checked = await saved("LEGACY");
      assert.equal(checked.players.length, 2);
      for (const player of checked.players) assert.ok(player.lastSeenAt! > Date.now() - 5000);
      const oldSaved = await saved("OLD");
      assert.ok(oldSaved.pausedAt);
      assert.equal(oldSaved.turnNumber, 1);
      assert.equal(oldSaved.turnDeadline, null);
      const after = (await database.query("SELECT updated_at, next_reconcile_at FROM game_rooms WHERE code = 'INACTIVE'")).rows[0];
      assert.equal(after.updated_at.getTime(), before.getTime());
      assert.equal(after.next_reconcile_at.getTime(), awaySince + ROOM_ABANDONMENT_MS);
      await database.query("TRUNCATE game_rooms");
    });

    await t.test("presence hands over the lobby host, preserves grace, then frees expired seats", async () => {
      const game = room("LOBBY", false);
      const now = Date.now();
      game.players[0]!.lastSeenAt = now - PRESENCE_TIMEOUT_MS - 1;
      game.players[1]!.lastSeenAt = now;
      await insert(game, new Date(0));
      await sweepDueRooms(database);
      let checked = await saved("LOBBY");
      assert.equal(checked.players[0]!.connected, false);
      assert.equal(checked.players[1]!.isHost, true);
      assert.equal(checked.players.length, 2);
      for (const player of checked.players) player.lastSeenAt = now - LOBBY_SEAT_GRACE_MS - 1;
      await database.query("UPDATE game_rooms SET state = $1, next_reconcile_at = NOW() - INTERVAL '1 second' WHERE code = 'LOBBY'", [JSON.stringify(checked)]);
      await sweepDueRooms(database);
      checked = await saved("LOBBY");
      assert.equal(checked.phase, "finished");
      assert.equal(checked.players.length, 0);
      assert.equal((await database.query("SELECT next_reconcile_at FROM game_rooms WHERE code = 'LOBBY'")).rows[0].next_reconcile_at, null);
      await database.query("TRUNCATE game_rooms");
    });

    await t.test("auction deadlines close once while debt recovery remains paused", async () => {
      const auction = room("AUCTION");
      auction.players[0]!.position = 1;
      auction.lastRoll = [1, 2];
      end(auction, Object.keys(auction.tokens)[0]!);
      auction.auction!.deadline = Date.now() - 1;
      await insert(auction);
      const debt = room("DEBT");
      debt.debt = { id: "saved", debtorPlayerId: debt.players[0]!.id, creditorPlayerId: null, amount: 200 };
      await insert(debt, new Date(0));
      await Promise.all([sweepDueRooms(database), sweepDueRooms(database)]);
      const closed = await saved("AUCTION");
      assert.equal(closed.auction, null);
      assert.equal(closed.turnNumber, 2);
      assert.equal(closed.history.filter(line => line.includes("No bids for")).length, 1);
      const paused = await saved("DEBT");
      assert.equal(paused.turnNumber, 1);
      assert.equal(paused.debt?.id, "saved");
      assert.equal(paused.turnDeadline, null);
      for (const player of paused.players) {
        player.lastSeenAt = Date.now() - PRESENCE_TIMEOUT_MS - 1;
        player.connected = false;
      }
      await database.query("UPDATE game_rooms SET state = $1, next_reconcile_at = NOW() - INTERVAL '1 second' WHERE code = 'DEBT'", [JSON.stringify(paused)]);
      await sweepDueRooms(database);
      assert.ok((await database.query("SELECT next_reconcile_at FROM game_rooms WHERE code = 'DEBT'")).rows[0].next_reconcile_at);
      await database.query("TRUNCATE game_rooms");
    });

    for (const decision of ["turn", "auction", "debt"] as const) {
      await t.test(`abandoned ${decision} survives persisted pause and saved-seat recovery`, async () => {
        const game = room("RECOVER");
        const token = Object.keys(game.tokens)[0]!;
        const now = Date.now();
        game.board[1]!.ownerPlayerId = game.players[0]!.id;
        game.board[1]!.mortgaged = true;
        game.players[0]!.properties = [1];
        game.players[0]!.cash = 777;
        game.players[0]!.jailCards = 1;
        game.heldJailCards = { [game.players[0]!.id]: ["chance"] };
        game.extraRoll = true;
        game.consecutiveDoubles = 1;
        game.lastRoll = [3, 3];
        if (decision === "auction") {
          game.auction = {
            id: "saved-auction", spaceId: 3, eligiblePlayerIds: game.players.map(p => p.id),
            withdrawnPlayerIds: [], highestBid: 50, highestBidderPlayerId: game.players[1]!.id,
            deadline: now - 1, increment: 10,
          };
        } else if (decision === "debt") {
          game.debt = { id: "saved-debt", debtorPlayerId: game.players[0]!.id, creditorPlayerId: game.players[1]!.id, amount: 1000 };
          game.pendingPayments = [{ debtorPlayerId: game.players[1]!.id, creditorPlayerId: null, amount: 50 }];
        }
        for (const player of game.players) player.lastSeenAt = now - ROOM_ABANDONMENT_MS - 1;
        normalizeGame(game, now);
        const before = structuredClone(game);
        await insert(game);
        await sweepDueRooms(database);
        let checked = await saved(game.code);
        assert.ok(checked.pausedAt);
        assert.equal(checked.turnDeadline, null);
        assert.deepEqual(checked.players, before.players);
        assert.deepEqual(checked.board, before.board);
        assert.deepEqual(checked.tokens, before.tokens);
        assert.deepEqual(checked.heldJailCards, before.heldJailCards);
        assert.deepEqual(checked.debt, before.debt);
        assert.deepEqual(checked.auction, before.auction);
        assert.deepEqual(checked.pendingPayments, before.pendingPayments);
        assert.equal(checked.turnNumber, before.turnNumber);
        assert.equal(checked.currentPlayerId, before.currentPlayerId);
        assert.equal(nextRoomCheck(checked), null);
        assert.equal((await sweepDueRooms(database)).processed, 0);
        const paused = structuredClone(checked);
        reconcileLifecycle(checked, now + 86_400_000);
        touchPresence(checked, "invalid", now + 86_400_000);
        touchPresence(checked, undefined, now + 86_400_000);
        assert.deepEqual(checked, paused);

        // Simulate process restart by loading JSON into a new row-locked action.
        const client = await database.connect();
        const restoredAt = Date.now();
        try {
          await client.query("BEGIN");
          checked = (await client.query("SELECT state FROM game_rooms WHERE code = $1 FOR UPDATE", [game.code])).rows[0].state;
          reconcileLifecycle(checked, restoredAt);
          touchPresence(checked, token, restoredAt);
          touchPresence(checked, Object.keys(checked.tokens)[1], restoredAt + 1);
          await client.query("UPDATE game_rooms SET state = $1, next_reconcile_at = $2 WHERE code = $3",
            [JSON.stringify(checked), nextRoomCheck(checked), game.code]);
          await client.query("COMMIT");
        } finally { client.release(); }
        const restored = await saved(game.code);
        assert.equal(restored.pausedAt, null);
        assert.equal(restored.resumedAt, restoredAt);
        assert.equal(restored.history.filter(h => h.includes("restored the paused table")).length, 1);
        assert.equal(restored.turnNumber, before.turnNumber);
        assert.deepEqual(restored.lastRoll, before.lastRoll);
        assert.equal(restored.extraRoll, true);
        assert.equal(restored.consecutiveDoubles, 1);
        assert.deepEqual(restored.board, before.board);
        assert.deepEqual(restored.debt, before.debt);
        assert.deepEqual(restored.pendingPayments, before.pendingPayments);
        if (decision === "auction") {
          assert.deepEqual(restored.auction, { ...before.auction, deadline: restoredAt + AUCTION_DURATION_MS });
        }
        assert.equal(restored.turnDeadline, null);
        await sweepDueRooms(database);
        assert.equal((await saved(game.code)).resumedAt, restoredAt);
        await database.query("TRUNCATE game_rooms");
      });
    }

    await t.test("one present seat prevents abandonment while a resigned token cannot restore it", async () => {
      const game = room("ACTIVE");
      const now = Date.now();
      game.players[0]!.lastSeenAt = now - ROOM_ABANDONMENT_MS - 1;
      game.players[1]!.lastSeenAt = now;
      await insert(game);
      await sweepDueRooms(database);
      let checked = await saved(game.code);
      assert.equal(checked.pausedAt, null);
      assert.equal(checked.players[0]!.connected, false);
      assert.equal(checked.turnNumber, 1);
      checked.pausedAt = now;
      checked.players[0]!.resigned = true;
      const resignedToken = Object.keys(checked.tokens).find(token => checked.tokens[token] === checked.players[0]!.id);
      touchPresence(checked, resignedToken, now);
      assert.equal(checked.pausedAt, now);
    });
  } finally {
    await database.end();
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  }
});

test.after(async () => { await pool.end(); });