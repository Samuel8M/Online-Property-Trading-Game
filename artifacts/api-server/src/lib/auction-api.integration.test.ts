// Opt-in against the managed API; only the rooms created here are changed.
import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import type { GameView, GameJoinResult } from "@workspace/api-zod";
import type { StoredGame } from "./game-engine";
import { legacyBoardFixture } from "./legacy-board.fixture";

const base = "http://localhost:80/api/games";
async function post(path: string, body: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
test("auctions persist across sessions, serialize bids and award once under competing requests", { skip: process.env.GAME_API_TEST !== "1" }, async () => {
  let code = "";
  try {
    const created = await post("", { playerName: "Auction Host" });
    assert.equal(created.status, 201);
    const first = created.data as GameJoinResult; code = first.game.code;
    const second = (await post(`/${code}/players`, { playerName: "Auction Bidder" })).data as GameJoinResult;
    const third = (await post(`/${code}/players`, { playerName: "Auction Third" })).data as GameJoinResult;
    const a = first.sessionToken, b = second.sessionToken, c = third.sessionToken;
    assert.equal((await post(`/${code}/start`, { sessionToken: a })).status, 200);
    const rows = await pool.query("SELECT state FROM game_rooms WHERE code = $1", [code]);
    const g = rows.rows[0].state as StoredGame;
    g.board = legacyBoardFixture(); g.players[0]!.position = 3; g.lastRoll = [1, 2];
    await pool.query("UPDATE game_rooms SET state = $1 WHERE code = $2", [JSON.stringify(g), code]);
    const get = async (token?: string): Promise<GameView> => {
      const res = await fetch(`${base}/${code}`, { headers: token ? { "X-Game-Token": token } : {} });
      assert.equal(res.status, 200);
      return res.json() as Promise<GameView>;
    };
    const opened = await post(`/${code}/pass`, { sessionToken: a });
    assert.equal(opened.status, 200);
    const id = (opened.data as GameView).auction!.id;
    const bid = (sessionToken: string, amount: number, auctionId = id) => post(`/${code}/auction`, { sessionToken, auctionId, action: "bid", amount });
    const withdraw = (sessionToken: string) => post(`/${code}/auction`, { sessionToken, auctionId: id, action: "withdraw" });
    assert.equal((await bid("invalid-session-token", 10)).status, 403);
    assert.equal((await bid(b, 10.5)).status, 400);
    assert.equal((await bid(b, 1501)).status, 400);
    assert.equal((await bid(b, 10, "stale")).status, 400);
    for (const token of [a, b, c, undefined]) {
      const state = await get(token);
      assert.equal(state.auction!.id, id);
      assert.equal(state.board.length, 28);
      assert.equal(state.turnDeadline, null);
      assert.equal("tokens" in state, false);
      assert.equal("auctionTurnRemainingMs" in state, false);
    }
    const bids = await Promise.all([bid(b, 10), bid(c, 10)]);
    assert.deepEqual(bids.map(r => r.status).sort(), [200, 400]);
    let state = await get(a);
    const leaderId = state.auction!.highestBidderPlayerId;
    const leader = leaderId === second.game.myPlayerId ? b : c;
    const loser = leader === b ? c : b;
    assert.equal((await withdraw(leader)).status, 400);
    assert.equal((await post(`/${code}/buy`, { sessionToken: a })).status, 400);
    assert.equal((await post(`/${code}/pass`, { sessionToken: a })).status, 400);
    assert.equal((await post(`/${code}/resign`, { sessionToken: leader })).status, 400);
    assert.equal((await withdraw(a)).status, 200);
    const closes = await Promise.all([withdraw(loser), withdraw(loser), bid(leader, 20)]);
    assert.deepEqual(closes.map(r => r.status).sort(), [200, 400, 400]);
    state = await get(leader);
    assert.equal(state.auction, null);
    assert.equal(state.board[3]!.ownerPlayerId, leaderId);
    assert.equal(state.players.find(p => p.id === leaderId)!.cash, 1490);
    assert.deepEqual(state.players.find(p => p.id === leaderId)!.properties, [3]);
    assert.equal(state.currentPlayerId, second.game.myPlayerId);
    assert.equal(state.turnNumber, 2);
    assert.equal((await bid(a, 100)).status, 400);
    for (const token of [a, b, c]) {
      const reloaded = await get(token);
      assert.equal(reloaded.auction, null);
      assert.equal(reloaded.board[3]!.ownerPlayerId, leaderId);
      assert.equal(reloaded.players.find(p => p.id === leaderId)!.cash, 1490);
    }
    // A saved past deadline is reconciled even by an invalid late bid.
    const saved = (await pool.query("SELECT state FROM game_rooms WHERE code = $1", [code])).rows[0].state as StoredGame;
    saved.players[1]!.position = 5; saved.lastRoll = [1, 2];
    await pool.query("UPDATE game_rooms SET state = $1 WHERE code = $2", [JSON.stringify(saved), code]);
    const next = await post(`/${code}/pass`, { sessionToken: b });
    assert.equal(next.status, 200);
    const nextId = (next.data as GameView).auction!.id;
    await pool.query("UPDATE game_rooms SET state = jsonb_set(state, '{auction,deadline}', to_jsonb($1::bigint)) WHERE code = $2", [Date.now() - 1, code]);
    assert.equal((await bid(a, 10, nextId)).status, 400);
    const expired = await get(a);
    assert.equal(expired.auction, null);
    assert.equal(expired.board[5]!.ownerPlayerId, null);
    assert.equal(expired.currentPlayerId, third.game.myPlayerId);
  } finally {
    if (code) await pool.query("DELETE FROM game_rooms WHERE code = $1", [code]);
  }
});
test.after(async () => { await pool.end(); });