// Opt-in: run against the managed API workflow and shared proxy. Every room
// created by this test is removed in finally; no existing rooms are modified.
import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import type { GameView, GameJoinResult } from "@workspace/api-zod";
import type { StoredGame } from "./game-engine";
import { legacyBoardFixture } from "./legacy-board.fixture";

const enabled = process.env.GAME_API_TEST === "1";
const base = `${process.env.GAME_API_BASE ?? "http://localhost:80"}/api/games`;
async function post(path: string, data: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return { status: response.status, data: await response.json() };
}

test("property/trade APIs persist, authorize, and serialize competing requests", { skip: !enabled }, async () => {
  let code = "";
  try {
    const created = await post("", { playerName: "API Builder" });
    assert.equal(created.status, 201);
    const first = created.data as GameJoinResult;
    code = first.game.code;
    const a = first.sessionToken;
    const joined = await post(`/${code}/players`, { playerName: "API Partner" });
    assert.equal(joined.status, 200);
    const second = joined.data as GameJoinResult;
    const b = second.sessionToken;
    const third = await post(`/${code}/players`, { playerName: "API Watcher" });
    assert.equal(third.status, 200);
    const c = (third.data as GameJoinResult).sessionToken;
    assert.equal((await post(`/${code}/start`, { sessionToken: a })).status, 200);

    // Deterministic fixture in ONLY the just-created room; real APIs execute
    // all tested changes from here onward.
    const selected = await pool.query("SELECT state FROM game_rooms WHERE code = $1", [code]);
    const g = selected.rows[0].state as StoredGame;
    g.board = legacyBoardFixture();
    const p = g.players[0]!, q = g.players[1]!;
    p.properties = [1, 3, 4]; q.properties = [5, 8];
    for (const s of g.board) {
      if (p.properties.includes(s.id)) s.ownerPlayerId = p.id;
      if (q.properties.includes(s.id)) s.ownerPlayerId = q.id;
    }
    await pool.query("UPDATE game_rooms SET state = $1 WHERE code = $2", [JSON.stringify(g), code]);
    const prop = (spaceId: number, action: string, token = a) => post(`/${code}/property`, { sessionToken: token, spaceId, action });
    const offer = (more: Record<string, unknown> = {}) => post(`/${code}/trades`, {
      sessionToken: a, recipientPlayerId: q.id, offeredCash: 50, requestedCash: 25,
      offeredPropertyIds: [4], requestedPropertyIds: [5], ...more,
    });
    const respond = (tradeId: string, action: string, sessionToken = b) => post(`/${code}/trades/respond`, { sessionToken, tradeId, action });
    const get = async (token?: string): Promise<GameView> => {
      const response = await fetch(`${base}/${code}`, { headers: token ? { "X-Game-Token": token } : {} });
      assert.equal(response.status, 200);
      return response.json() as Promise<GameView>;
    };

    assert.equal((await prop(1, "build", "not-a-real-session-token")).status, 403);
    assert.equal((await prop(1, "build", b)).status, 400);
    assert.equal((await prop(5, "build")).status, 400);
    assert.equal((await prop(1.5, "build")).status, 400);
    assert.equal((await prop(1, "unknown")).status, 400);
    assert.equal((await offer({ offeredCash: 0.5 })).status, 400);
    assert.equal((await offer({ offeredPropertyIds: [4, 4] })).status, 400);
    assert.equal((await get(a)).players[0]!.cash, 1500);

    // Same property's second concurrent build would violate even development.
    const builds = await Promise.all([prop(1, "build"), prop(1, "build")]);
    assert.deepEqual(builds.map(r => r.status).sort(), [200, 400]);
    let state = await get(a);
    assert.equal(state.players[0]!.cash, 1450);
    assert.equal(state.board[1]!.buildingLevel, 1);
    assert.equal(state.board[1]!.currentRent, 36);
    assert.equal((await prop(3, "mortgage")).status, 400);
    assert.equal((await prop(1, "sell-building")).status, 200);

    const mortgages = await Promise.all([prop(4, "mortgage"), prop(4, "mortgage")]);
    assert.deepEqual(mortgages.map(r => r.status).sort(), [200, 400]);
    state = await get(a);
    assert.equal(state.players[0]!.cash, 1575);
    assert.equal(state.board[4]!.currentRent, 0);
    assert.equal((await prop(4, "redeem")).status, 200);
    assert.equal((await get(a)).players[0]!.cash, 1465);

    const pending = await offer();
    assert.equal(pending.status, 200);
    const tradeId = (pending.data as GameView).trades[0]!.id;
    assert.equal((await respond(tradeId, "accept", a)).status, 403);
    assert.equal((await respond(tradeId, "accept", c)).status, 403);
    assert.equal((await respond(tradeId, "cancel", b)).status, 403);
    const accepts = await Promise.all([respond(tradeId, "accept"), respond(tradeId, "accept")]);
    assert.deepEqual(accepts.map(r => r.status).sort(), [200, 400]);
    state = await get(a);
    assert.equal(state.players[0]!.cash, 1440);
    assert.equal(state.players[1]!.cash, 1525);
    assert.equal(state.board[4]!.ownerPlayerId, q.id);
    assert.equal(state.board[5]!.ownerPlayerId, p.id);
    assert.deepEqual(state.players[0]!.properties, [1, 3, 5]);
    assert.deepEqual(state.players[1]!.properties, [4, 8]);
    assert.equal(state.trades[0]!.status, "accepted");
    assert.equal("tokens" in state, false);
    assert.equal((await get()).myPlayerId, null);
    assert.equal((await get(b)).myPlayerId, q.id);

    // Changing a disclosed mortgage invalidates an offer, with no exchange.
    const stale = await offer({ offeredPropertyIds: [1], requestedPropertyIds: [], offeredCash: 0, requestedCash: 0 });
    assert.equal(stale.status, 200);
    const staleId = (stale.data as GameView).trades[0]!.id;
    assert.equal((await prop(1, "mortgage")).status, 200);
    state = await get();
    assert.equal(state.trades[0]!.status, "invalidated");
    assert.equal((await respond(staleId, "accept")).status, 400);
    assert.equal((await get()).board[1]!.ownerPlayerId, p.id);
  } finally {
    if (code) await pool.query("DELETE FROM game_rooms WHERE code = $1", [code]);
  }
});
test("classic high-ID deeds develop, mortgage, and trade through the real API", { skip: !enabled }, async () => {
  let code = "";
  try {
    const first = await post("", { playerName: "Classic API Owner" });
    assert.equal(first.status, 201);
    const result = first.data as GameJoinResult; code = result.game.code;
    const a = result.sessionToken;
    const joined = await post(`/${code}/players`, { playerName: "API Partner" });
    assert.equal(joined.status, 200);
    const b = (joined.data as GameJoinResult).sessionToken;
    assert.equal((await post(`/${code}/start`, { sessionToken: a })).status, 200);
    const rows = await pool.query("SELECT state FROM game_rooms WHERE code = $1", [code]);
    const game = rows.rows[0].state as StoredGame;
    assert.equal(game.board.length, 40);
    const p = game.players[0]!, q = game.players[1]!;
    p.cash = 10000; p.properties = [37, 39]; q.properties = [28];
    for (const id of p.properties) game.board[id]!.ownerPlayerId = p.id;
    game.board[28]!.ownerPlayerId = q.id;
    await pool.query("UPDATE game_rooms SET state = $1 WHERE code = $2", [JSON.stringify(game), code]);
    const manage = (id: number, action: string) => post(`/${code}/property`, { sessionToken: a, spaceId: id, action });
    let current: GameView = { ...game, myPlayerId: p.id };
    for (let level = 1; level <= 5; level++) {
      assert.equal((await manage(37, "build")).status, 200);
      const built = await manage(39, "build"); assert.equal(built.status, 200); current = built.data as GameView;
    }
    assert.equal(current.board[39]!.currentRent, 2000);
    assert.equal(current.board[37]!.currentRent, 1500);
    for (let level = 5; level > 0; level--) {
      assert.equal((await manage(37, "sell-building")).status, 200);
      assert.equal((await manage(39, "sell-building")).status, 200);
    }
    assert.equal((await manage(39, "mortgage")).status, 200);
    const pending = await post(`/${code}/trades`, {
      sessionToken: a, recipientPlayerId: q.id, offeredCash: 0, requestedCash: 0,
      offeredPropertyIds: [39], requestedPropertyIds: [28],
    });
    assert.equal(pending.status, 200);
    const tradeId = (pending.data as GameView).trades[0]!.id;
    const accepted = await post(`/${code}/trades/respond`, { sessionToken: b, tradeId, action: "accept" });
    assert.equal(accepted.status, 200);
    current = accepted.data as GameView;
    assert.equal(current.board[39]!.ownerPlayerId, q.id);
    assert.equal(current.board[39]!.mortgaged, true);
    assert.equal(current.board[28]!.ownerPlayerId, p.id);
    assert.equal(current.players[0]!.cash, 9200);
    assert.equal(current.players[1]!.cash, 1500);
  } finally { if (code) await pool.query("DELETE FROM game_rooms WHERE code = $1", [code]); }
});
test.after(async () => { await pool.end(); });