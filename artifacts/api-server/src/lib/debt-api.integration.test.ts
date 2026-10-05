// Opt-in checks against the managed API workflow. Only newly created rooms
// are seeded and removed; existing rooms are never modified.
import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { CreateGameResponse, JoinGameResponse, GetGameResponse } from "@workspace/api-zod";
import { roll, type StoredGame } from "./game-engine";

const enabled = process.env.GAME_API_TEST === "1";
const base = `${process.env.GAME_API_BASE ?? "http://localhost:80"}/api/games`;
async function post(path: string, data: unknown) {
  const res = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  return { status: res.status, data: await res.json() };
}
async function fixture(code: string, fn: (g: StoredGame) => void) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT state FROM game_rooms WHERE code=$1 FOR UPDATE", [code]);
    const game = result.rows[0].state as StoredGame;
    fn(game);
    await client.query("UPDATE game_rooms SET state=$1 WHERE code=$2", [JSON.stringify(game), code]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

test("debt APIs survive reloads, prevent bypasses and serialize duplicate settlements", { skip: !enabled }, async () => {
  let code = "";
  try {
    const created = await post("", { playerName: "Debt API Debtor" });
    const first = CreateGameResponse.parse(created.data);
    assert.equal(created.status, 201); code = first.game.code;
    const a = first.sessionToken;
    const joined = await post(`/${code}/players`, { playerName: "Debt API Creditor" });
    const b = JoinGameResponse.parse(joined.data).sessionToken;
    await post(`/${code}/players`, { playerName: "Debt API Third" });
    await post(`/${code}/start`, { sessionToken: a });
    await fixture(code, g => {
      const p = g.players[0]!, q = g.players[1]!;
      p.cash = 10; p.position = 36; p.properties = [5]; q.properties = [39];
      g.board[5]!.ownerPlayerId = p.id; g.board[39]!.ownerPlayerId = q.id;
      roll(g, a, [1, 2]);
      // A legacy saved turn timestamp must not skip a debt.
      g.turnDeadline = Date.now() - 10000;
    });
    const load = () => fetch(`${base}/${code}`, { headers: { "X-Game-Token": a } }).then(r => r.json()).then(data => GetGameResponse.parse(data));
    const current = await load();
    const debt = current.debt;
    assert.ok(debt);
    assert.equal(debt.amount, 50); assert.equal(current.players[0]!.cash, 10);
    assert.equal(debt.creditorPlayerId, current.players[1]!.id);
    assert.equal(current.turnDeadline, null);
    assert.equal("debtContinuation" in current, false);
    assert.equal("debtTurnRemainingMs" in current, false);
    for (const path of ["roll", "pass", "buy", "resign"]) assert.equal((await post(`/${code}/${path}`, { sessionToken: a })).status, 400);
    assert.equal((await post(`/${code}/debt`, { sessionToken: b, debtId: debt.id, action: "bankrupt" })).status, 403);
    assert.equal((await post(`/${code}/debt`, { sessionToken: a, debtId: debt.id, action: "settle" })).status, 400);
    assert.equal((await post(`/${code}/debt`, { sessionToken: a, debtId: debt.id, action: "invalid" })).status, 400);
    const mortgages = await Promise.all([1, 2].map(() => post(`/${code}/property`, { sessionToken: a, spaceId: 5, action: "mortgage" })));
    assert.deepEqual(mortgages.map(r => r.status).sort(), [200, 400]);
    assert.equal((await load()).players[0]!.cash, 110);
    const payments = await Promise.all([1, 2, 3].map(() => post(`/${code}/debt`, { sessionToken: a, debtId: debt.id, action: "settle" })));
    assert.deepEqual(payments.map(r => r.status).sort(), [200, 400, 400]);
    const paid = await load();
    assert.equal(paid.debt, null); assert.equal(paid.players[0]!.cash, 60); assert.equal(paid.players[1]!.cash, 1550);
    assert.equal(paid.currentPlayerId, current.players[0]!.id);
    assert.equal(paid.turnDeadline, null);

    await fixture(code, g => {
      g.lastRoll = []; g.players[0]!.position = 36; g.players[0]!.cash = 10;
      roll(g, a, [1, 2]);
    });
    const second = (await load()).debt;
    assert.ok(second);
    const outcomes = await Promise.all([
      post(`/${code}/debt`, { sessionToken: a, debtId: second.id, action: "bankrupt" }),
      post(`/${code}/debt`, { sessionToken: a, debtId: second.id, action: "settle" }),
    ]);
    assert.deepEqual(outcomes.map(r => r.status).sort(), [200, 400]);
    const bankrupt = await load();
    assert.equal(bankrupt.debt, null); assert.equal(bankrupt.players[0]!.bankrupt, true);
    assert.equal(bankrupt.players[1]!.cash, 1560); assert.equal(bankrupt.board[5]!.ownerPlayerId, bankrupt.players[1]!.id);
    assert.equal(bankrupt.board[5]!.mortgaged, true);
    assert.equal(bankrupt.currentPlayerId, bankrupt.players[1]!.id); assert.equal(bankrupt.turnNumber, 2);
  } finally { if (code) await pool.query("DELETE FROM game_rooms WHERE code=$1", [code]); }
});
test.after(async () => { await pool.end(); });