// Opt-in against the managed API; seed/remove only a newly-created room.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { CreateGameResponse, JoinGameResponse, GetGameResponse } from "@workspace/api-zod";
import type { StoredGame } from "./game-engine";

const base = `${process.env.GAME_API_BASE ?? "http://localhost:80"}/api/games`;
async function post(path: string, data: unknown) {
  const response = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  return { status: response.status, data: await response.json() };
}

test("debt trade API authorizes off-turn recovery and serializes accept, settlement and bankruptcy", { skip: process.env.GAME_API_TEST !== "1" }, async () => {
  let code = "";
  try {
    const created = await post("", { playerName: "Trade Active" });
    assert.equal(created.status, 201);
    const first = CreateGameResponse.parse(created.data); code = first.game.code;
    const a = first.sessionToken;
    const b = JoinGameResponse.parse((await post(`/${code}/players`, { playerName: "Trade Debtor" })).data).sessionToken;
    const c = JoinGameResponse.parse((await post(`/${code}/players`, { playerName: "Trade Buyer" })).data).sessionToken;
    assert.equal((await post(`/${code}/start`, { sessionToken: a })).status, 200);
    const load = async () => GetGameResponse.parse(await (await fetch(`${base}/${code}`, { headers: { "X-Game-Token": b } })).json());
    async function seed(cash = 10, bank = false) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const selected = await client.query("SELECT state FROM game_rooms WHERE code=$1 FOR UPDATE", [code]);
        const g = selected.rows[0].state as StoredGame;
        const [p, q, r] = g.players;
        g.phase = "playing"; g.winnerPlayerId = null; g.currentPlayerId = p!.id; g.turnNumber = 1;
        g.lastRoll = []; g.trades = []; g.pendingPayments = []; g.pausedAt = null;
        delete g.debtContinuation; g.turnDeadline = null;
        for (const player of g.players) { player.bankrupt = false; player.cash = 1500; player.properties = []; player.lastSeenAt = Date.now(); }
        for (const s of g.board) { s.ownerPlayerId = null; s.buildingLevel = 0; s.mortgaged = false; }
        q!.cash = cash; q!.properties = [5, 12];
        g.board[5]!.ownerPlayerId = q!.id; g.board[12]!.ownerPlayerId = q!.id;
        g.debt = { id: randomUUID(), debtorPlayerId: q!.id, creditorPlayerId: bank ? null : p!.id, amount: 100 };
        await client.query("UPDATE game_rooms SET state=$1, next_reconcile_at=NULL WHERE code=$2", [JSON.stringify(g), code]);
        await client.query("COMMIT");
        return { debt: g.debt, p: p!.id, q: q!.id, r: r!.id };
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    }
    async function offer(debtId: string, cash = 90) {
      const state = await load();
      return post(`/${code}/trades`, { sessionToken: b, debtId, recipientPlayerId: state.players[2]!.id,
        offeredCash: 0, requestedCash: cash, offeredPropertyIds: [5], requestedPropertyIds: [] });
    }
    const initial = await seed();
    const proposal = { sessionToken: a, debtId: initial.debt.id, recipientPlayerId: initial.r,
      offeredCash: 0, requestedCash: 90, offeredPropertyIds: [], requestedPropertyIds: [] };
    assert.equal((await post(`/${code}/trades`, proposal)).status, 403);
    assert.equal((await offer("stale")).status, 400);
    assert.equal((await offer(initial.debt.id, 89)).status, 400);
    const proposed = await offer(initial.debt.id);
    assert.equal(proposed.status, 200);
    const trade = GetGameResponse.parse(proposed.data).trades[0]!;
    assert.deepEqual(trade.debt, initial.debt);
    assert.deepEqual((await load()).trades[0]!.debt, initial.debt);
    assert.equal((await post(`/${code}/trades/respond`, { sessionToken: b, tradeId: trade.id, action: "accept" })).status, 403);
    const accept = () => post(`/${code}/trades/respond`, { sessionToken: c, tradeId: trade.id, action: "accept" });
    const duplicates = await Promise.all([accept(), accept(), accept()]);
    assert.deepEqual(duplicates.map(r => r.status).sort(), [200, 400, 400]);
    let state = await load();
    assert.deepEqual(state.debt, initial.debt); assert.equal(state.players[1]!.cash, 100);
    assert.equal(state.players[2]!.cash, 1410); assert.equal(state.board[5]!.ownerPlayerId, initial.r);
    assert.equal(state.currentPlayerId, initial.p); assert.equal(state.turnDeadline, null);
    assert.equal((await post(`/${code}/debt`, { sessionToken: b, debtId: initial.debt.id, action: "settle" })).status, 200);
    assert.equal((await load()).players[0]!.cash, 1600);

    for (const bank of [false, true]) for (const action of ["settle", "bankrupt"] as const) {
      const saved = await seed(100, bank);
      const offered = GetGameResponse.parse((await offer(saved.debt.id)).data).trades[0]!;
      const outcomes = await Promise.all([
        post(`/${code}/trades/respond`, { sessionToken: c, tradeId: offered.id, action: "accept" }),
        post(`/${code}/debt`, { sessionToken: b, debtId: saved.debt.id, action }),
      ]);
      assert.equal(outcomes[1]!.status, 200);
      assert.ok([200, 400].includes(outcomes[0]!.status));
      state = await load();
      const accepted = outcomes[0]!.status === 200;
      assert.equal(state.debt, null);
      assert.equal(state.trades[0]!.status, accepted ? "accepted" : "invalidated");
      assert.equal(state.players[2]!.cash, accepted ? 1410 : 1500);
      assert.equal(state.players[1]!.bankrupt, action === "bankrupt");
      assert.equal(state.players[1]!.cash, action === "bankrupt" ? 0 : accepted ? 90 : 0);
      assert.equal(state.players[0]!.cash, bank ? 1500 : action === "settle" ? 1600 : accepted ? 1690 : 1600);
      assert.equal(state.board[5]!.ownerPlayerId, accepted ? saved.r : action === "bankrupt" ? saved.debt.creditorPlayerId : saved.q);
      assert.equal(state.board[12]!.ownerPlayerId, action === "bankrupt" ? saved.debt.creditorPlayerId : saved.q);
      assert.equal(state.currentPlayerId, saved.p);
      assert.equal((await post(`/${code}/trades/respond`, { sessionToken: c, tradeId: offered.id, action: "accept" })).status, 400);
      assert.equal((await post(`/${code}/debt`, { sessionToken: b, debtId: saved.debt.id, action })).status, 400);
    }
  } finally { if (code) await pool.query("DELETE FROM game_rooms WHERE code=$1", [code]); }
});
test.after(async () => { await pool.end(); });