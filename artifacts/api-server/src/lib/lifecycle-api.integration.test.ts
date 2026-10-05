// Opt-in against the managed workflow via the proxy. Only these test-created
// rooms are changed or removed; no existing room state is touched.
import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import type { GameJoinResult, GameView, GameRoomList } from "@workspace/api-zod";
import { type StoredGame, ROOM_ABANDONMENT_MS, TURN_DURATION_MS } from "./game-engine";

const enabled = process.env.GAME_API_TEST === "1";
const base = `${process.env.GAME_API_BASE ?? "http://localhost:80"}/api/games`;
async function post(path: string, data: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  return { status: response.status, data: await response.json() };
}
async function get(code: string, token?: string): Promise<GameView> {
  const response = await fetch(`${base}/${code}`, { headers: token ? { "X-Game-Token": token } : {} });
  assert.equal(response.status, 200);
  return response.json() as Promise<GameView>;
}
async function fixture(code: string, change: (state: StoredGame) => void) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT state FROM game_rooms WHERE code = $1 FOR UPDATE", [code]);
    const state = result.rows[0].state as StoredGame;
    change(state);
    await client.query("UPDATE game_rooms SET state = $1, next_reconcile_at = NOW() WHERE code = $2", [JSON.stringify(state), code]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

test("timeouts, reconnects, spectators, and resignations persist and serialize through real APIs", { skip: !enabled }, async () => {
  let code = "";
  try {
    const created = await post("", { playerName: "Timer API Host" });
    assert.equal(created.status, 201);
    const first = created.data as GameJoinResult;
    code = first.game.code;
    const a = first.sessionToken;
    const second = (await post(`/${code}/players`, { playerName: "Timer API Partner" })).data as GameJoinResult;
    const b = second.sessionToken;
    const third = (await post(`/${code}/players`, { playerName: "Timer API Third" })).data as GameJoinResult;
    const c = third.sessionToken;
    assert.equal((await post(`/${code}/start`, { sessionToken: a })).status, 200);
    const original = await get(code, a);
    const pa = original.players[0]!, pb = original.players[1]!;

    // An action arriving after expiry is denied, but the timeout must COMMIT.
    await fixture(code, g => { g.turnDeadline = Date.now() - 1; });
    assert.equal((await post(`/${code}/roll`, { sessionToken: a })).status, 400);
    let current = await get(code, a);
    assert.equal(current.currentPlayerId, pb.id);
    assert.equal(current.turnNumber, 2);
    assert.deepEqual(current.lastRoll, []);
    assert.match(current.history.join("\n"), /turn was skipped/);
    assert.equal(current.players[0]!.cash, 1500);

    // Concurrent viewers may reconcile the same expired turn only once.
    await fixture(code, g => { g.turnDeadline = Date.now() - 1; });
    const simultaneous = await Promise.all([get(code), get(code), get(code, b)]);
    for (const state of simultaneous) assert.equal(state.turnNumber, 3);

    const awaySince = Date.now() - 60_000;
    await fixture(code, g => { g.players[0]!.lastSeenAt = awaySince; });
    current = await get(code);
    assert.equal(current.players[0]!.connected, false);
    assert.equal(current.players[0]!.lastSeenAt, awaySince); // Watchers never impersonate a heartbeat.
    const reconnect = await post(`/${code}/players`, { playerName: "Ignored Name", sessionToken: a });
    assert.equal(reconnect.status, 200);
    const rejoined = reconnect.data as GameJoinResult;
    assert.equal(rejoined.sessionToken, a);
    assert.equal(rejoined.game.myPlayerId, pa.id);
    assert.equal(rejoined.game.players.length, 3);
    assert.equal(rejoined.game.players[0]!.name, pa.name);
    assert.equal(rejoined.game.players[0]!.connected, true);
    assert.equal(rejoined.game.turnDeadline, current.turnDeadline);
    assert.equal("tokens" in rejoined.game, false);

    assert.equal((await post(`/${code}/resign`, { sessionToken: "invalid-session-token" })).status, 403);
    assert.equal((await get(code)).players.filter(p => p.resigned).length, 0);
    const deadline = current.turnDeadline;
    const departures = await Promise.all([
      post(`/${code}/resign`, { sessionToken: a }),
      post(`/${code}/resign`, { sessionToken: a }),
    ]);
    for (const response of departures) assert.equal(response.status, 200);
    current = await get(code, a);
    assert.equal(current.players[0]!.resigned, true);
    assert.equal(current.players[0]!.connected, false);
    assert.equal(current.turnDeadline, deadline); // Off-turn resignation doesn't reset a clock.
    assert.equal(current.turnNumber, 3);
    assert.equal(current.history.filter(h => h.includes("resigned permanently")).length, 1);
    assert.equal((await post(`/${code}/roll`, { sessionToken: a })).status, 400);
    const finish = await post(`/${code}/resign`, { sessionToken: c });
    assert.equal(finish.status, 200);
    current = finish.data as GameView;
    assert.equal(current.phase, "finished");
    assert.equal(current.winnerPlayerId, pb.id);
    assert.equal(current.turnDeadline, null);
    assert.equal(current.currentPlayerId, null);
  } finally { if (code) await pool.query("DELETE FROM game_rooms WHERE code = $1", [code]); }
});

test("the background sweep advances a persisted expired deadline with no browser requests", { skip: !enabled }, async () => {
  let code = "";
  try {
    const created = await post("", { playerName: "Sweep API Host" });
    assert.equal(created.status, 201);
    const first = created.data as GameJoinResult; code = first.game.code;
    await post(`/${code}/players`, { playerName: "Sweep API Partner" });
    assert.equal((await post(`/${code}/start`, { sessionToken: first.sessionToken })).status, 200);
    await fixture(code, g => { g.turnDeadline = Date.now() - 1; });
    await new Promise(resolve => setTimeout(resolve, 6500));
    const result = await pool.query("SELECT state FROM game_rooms WHERE code = $1", [code]);
    const state = result.rows[0].state as StoredGame;
    assert.equal(state.turnNumber, 2);
    assert.equal(state.currentPlayerId, state.players[1]!.id);
    assert.ok(state.turnDeadline! > Date.now());
  } finally { if (code) await pool.query("DELETE FROM game_rooms WHERE code = $1", [code]); }
});

test("discovery excludes empty tables before the limit and saved tokens restore persisted games exactly once", { skip: !enabled }, async () => {
  const codes: string[] = [];
  try {
    const created = await post("", { playerName: "Recovery Host" });
    assert.equal(created.status, 201);
    const first = created.data as GameJoinResult;
    const code = first.game.code;
    codes.push(code);
    const partner = (await post(`/${code}/players`, { playerName: "Recovery Partner" })).data as GameJoinResult;
    assert.equal((await post(`/${code}/start`, { sessionToken: first.sessionToken })).status, 200);
    const baseline = await get(code, first.sessionToken);
    // A genuinely active table stays discoverable even with old updated_at.
    await pool.query("UPDATE game_rooms SET updated_at = NOW() - INTERVAL '2 days' WHERE code = $1", [code]);
    const cutoff = Date.now() - ROOM_ABANDONMENT_MS - 1000;
    const original = (await pool.query("SELECT state FROM game_rooms WHERE code = $1", [code])).rows[0].state as StoredGame;
    for (let i = 0; i < 35; i++) {
      const stale = structuredClone(original);
      stale.code = `${code}_empty_${i}`;
      codes.push(stale.code);
      for (const player of stale.players) player.lastSeenAt = cutoff;
      // No sweeper request is needed for discovery to apply the cutoff.
      await pool.query("INSERT INTO game_rooms (code, state, next_reconcile_at) VALUES ($1, $2, NULL)",
        [stale.code, JSON.stringify(stale)]);
    }
    const listing = await fetch(base);
    assert.equal(listing.status, 200);
    const listed = (await listing.json() as GameRoomList).rooms;
    assert.ok(listed.some(r => r.code === code));
    assert.ok(!listed.some(r => r.code.includes("_empty_")));

    await fixture(code, g => {
      for (const player of g.players) player.lastSeenAt = cutoff;
      g.turnDeadline = Date.now() - 1;
    });
    const watched = await get(code);
    assert.ok(watched.pausedAt);
    assert.equal(watched.turnDeadline, null);
    assert.equal(watched.turnNumber, baseline.turnNumber);
    assert.equal(watched.currentPlayerId, baseline.currentPlayerId);
    assert.deepEqual(watched.board, baseline.board);
    assert.equal(watched.players.length, 2);
    assert.ok(watched.players.every(p => !p.resigned && !p.bankrupt));
    const pausedRow = (await pool.query("SELECT state, next_reconcile_at FROM game_rooms WHERE code = $1", [code])).rows[0];
    assert.equal(pausedRow.next_reconcile_at, null);
    assert.equal((await get(code, "invalid-session-token")).pausedAt, watched.pausedAt);
    assert.equal((await post(`/${code}/players`, { playerName: "Unknown", sessionToken: "invalid-session-token" })).status, 400);
    assert.equal((await get(code)).pausedAt, watched.pausedAt);
    const hidden = (await (await fetch(base)).json() as GameRoomList).rooms;
    assert.ok(!hidden.some(r => r.code === code));

    const responses = await Promise.all([
      post(`/${code}/players`, { playerName: "Ignored", sessionToken: first.sessionToken }),
      post(`/${code}/players`, { playerName: "Ignored", sessionToken: partner.sessionToken }),
    ]);
    for (const response of responses) {
      assert.equal(response.status, 200);
      const recovered = (response.data as GameJoinResult).game;
      assert.equal(recovered.pausedAt, null);
      assert.equal(recovered.turnNumber, baseline.turnNumber);
      assert.deepEqual(recovered.board, baseline.board);
      assert.equal(recovered.turnDeadline, recovered.resumedAt! + TURN_DURATION_MS);
      assert.equal(recovered.history.filter(h => h.includes("restored the paused table")).length, 1);
      assert.ok(recovered.myPlayerId);
      assert.equal("tokens" in recovered, false);
    }
    const recovered = await get(code);
    assert.equal(recovered.resumedAt, (responses[0].data as GameJoinResult).game.resumedAt);
    assert.equal(recovered.turnDeadline, recovered.resumedAt! + TURN_DURATION_MS);
    const publicAgain = (await (await fetch(base)).json() as GameRoomList).rooms;
    assert.ok(publicAgain.some(r => r.code === code));
  } finally {
    if (codes.length) await pool.query("DELETE FROM game_rooms WHERE code = ANY($1::text[])", [codes]);
  }
});

test.after(async () => { await pool.end(); });