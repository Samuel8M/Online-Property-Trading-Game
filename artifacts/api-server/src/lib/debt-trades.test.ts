import test from "node:test";
import assert from "node:assert/strict";
import { createRoom, addPlayer, start, proposeTrade, respondTrade, reconcileTrades, resolveDebt, normalizeGame } from "./game-engine";

function table() {
  const { game, token: a } = createRoom("DTRADE", "Active");
  const b = addPlayer(game, "Debtor"), c = addPlayer(game, "Buyer");
  start(game, a);
  const [p, q, r] = game.players;
  q!.cash = 10;
  q!.properties = [5, 12]; game.board[5]!.ownerPlayerId = q!.id; game.board[12]!.ownerPlayerId = q!.id;
  game.debt = { id: "saved-debt", debtorPlayerId: q!.id, creditorPlayerId: p!.id, amount: 100 };
  const offer = { sessionToken: b, debtId: game.debt.id, recipientPlayerId: r!.id,
    offeredCash: 0, requestedCash: 90, offeredPropertyIds: [5], requestedPropertyIds: [] };
  return { game, a, b, c, p: p!, q: q!, r: r!, offer };
}

test("off-turn debtor may sell deeds only with full cash coverage; acceptance preserves the debt and turn", () => {
  const t = table();
  proposeTrade(t.game, t.offer);
  const g = normalizeGame(JSON.parse(JSON.stringify(t.game)));
  const debt = structuredClone(g.debt);
  respondTrade(g, { sessionToken: t.c, tradeId: g.trades[0]!.id, action: "accept" });
  assert.deepEqual(g.debt, debt);
  assert.equal(g.players[1]!.cash, 100); assert.equal(g.players[2]!.cash, 1410);
  assert.equal(g.board[5]!.ownerPlayerId, t.r.id); assert.equal(g.board[12]!.ownerPlayerId, t.q.id);
  assert.equal(g.currentPlayerId, t.p.id); assert.equal(g.turnDeadline, null);
  resolveDebt(g, { sessionToken: t.b, debtId: debt!.id, action: "settle" });
  assert.equal(g.players[0]!.cash, 1600); assert.equal(g.players[1]!.cash, 0);
  assert.equal(g.currentPlayerId, t.p.id);
});

test("debt offers reject gifting, property swaps, wrong debtor, stale IDs and buildings", () => {
  const t = table();
  for (const changes of [
    { requestedCash: 0 }, { requestedCash: 89 },
    { sessionToken: t.a }, { debtId: "stale" }, { debtId: undefined },
  ]) assert.throws(() => proposeTrade(t.game, { ...t.offer, ...changes }));
  t.game.board[5]!.mortgaged = true;
  assert.throws(() => proposeTrade(t.game, { ...t.offer, requestedCash: 1 }), /full saved debt/);
  t.game.board[5]!.mortgaged = false; t.q.properties.push(1);
  t.game.board[1]!.ownerPlayerId = t.q.id; t.game.board[3]!.buildingLevel = 1;
  assert.throws(() => proposeTrade(t.game, { ...t.offer, offeredPropertyIds: [1] }), /buildings/);
  assert.equal(t.game.trades.length, 0);
});

test("incoming cash help can be partial and ordinary offers can be cancelled while paused", () => {
  const t = table();
  proposeTrade(t.game, { ...t.offer, requestedCash: 20, offeredPropertyIds: [] });
  respondTrade(t.game, { sessionToken: t.c, tradeId: t.game.trades[0]!.id, action: "accept" });
  assert.equal(t.q.cash, 30); assert.equal(t.game.debt!.amount, 100);
  const debt = t.game.debt; t.game.debt = null;
  proposeTrade(t.game, { ...t.offer, sessionToken: t.a, debtId: undefined, offeredPropertyIds: [], requestedCash: 1 });
  t.game.debt = debt;
  const ordinary = t.game.trades[0]!;
  reconcileTrades(t.game); assert.equal(ordinary.status, "pending");
  assert.throws(() => respondTrade(t.game, { sessionToken: t.c, tradeId: ordinary.id, action: "accept" }), /Ordinary trades/);
  respondTrade(t.game, { sessionToken: t.a, tradeId: ordinary.id, action: "cancel" });
  assert.equal(ordinary.status, "cancelled");
});

test("debt snapshots invalidate on changed creditor, amount, next debt, settlement or bankruptcy", () => {
  for (const change of ["creditor", "amount", "id", "settle", "bankrupt"]) {
    const t = table(); proposeTrade(t.game, t.offer);
    if (change === "creditor") t.game.debt!.creditorPlayerId = t.r.id;
    if (change === "amount") t.game.debt!.amount++;
    if (change === "id") t.game.debt!.id = "next-debt";
    if (change === "settle" || change === "bankrupt") {
      t.q.cash = 100;
      resolveDebt(t.game, { sessionToken: t.b, debtId: t.offer.debtId, action: change });
    }
    reconcileTrades(t.game);
    assert.equal(t.game.trades[0]!.status, "invalidated");
    assert.throws(() => respondTrade(t.game, { sessionToken: t.c, tradeId: t.game.trades[0]!.id, action: "accept" }));
  }
});

test("acceptance rechecks coverage, mortgages, cash and ownership; creditor purchases do not forgive debt", () => {
  for (const change of ["coverage", "mortgage", "cash", "owner"]) {
    const t = table(); proposeTrade(t.game, t.offer);
    if (change === "coverage") t.q.cash = 9;
    if (change === "mortgage") t.game.board[5]!.mortgaged = true;
    if (change === "cash") t.r.cash = 89;
    if (change === "owner") t.game.board[5]!.ownerPlayerId = t.p.id;
    assert.throws(() => respondTrade(t.game, { sessionToken: t.c, tradeId: t.game.trades[0]!.id, action: "accept" }));
    reconcileTrades(t.game); assert.equal(t.game.trades[0]!.status, "invalidated");
  }
  const t = table(); proposeTrade(t.game, { ...t.offer, recipientPlayerId: t.p.id });
  assert.throws(() => respondTrade(t.game, { sessionToken: t.b, tradeId: t.game.trades[0]!.id, action: "accept" }), /recipient/);
  respondTrade(t.game, { sessionToken: t.a, tradeId: t.game.trades[0]!.id, action: "accept" });
  assert.equal(t.p.cash, 1410); assert.equal(t.q.cash, 100); assert.equal(t.game.debt!.amount, 100);
  resolveDebt(t.game, { sessionToken: t.b, debtId: t.offer.debtId, action: "settle" });
  assert.equal(t.p.cash, 1510);
});