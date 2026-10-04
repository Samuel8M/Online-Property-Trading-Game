// Opt-in against the managed workflow via the proxy. Only these test-created
// rooms are changed or removed; no existing room state is touched.
import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import type { GameJoinResult, GameView } from "@workspace/api-zod";
import type { StoredGame } from "./game-engine";

const enabled = process.env.GAME_API_TEST === "1";
const base = "http://localhost:80/api/games";
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

test.after(async () => { await pool.end(); });