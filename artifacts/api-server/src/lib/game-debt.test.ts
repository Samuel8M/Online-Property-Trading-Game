import test from "node:test";
import assert from "node:assert/strict";
import {
  createRoom, addPlayer, start, roll, end, buy, leaveJail, manageProperty,
  resolveDebt, reconcileLifecycle, view, normalizeGame, proposeTrade, respondTrade, resign,
  type StoredGame,
} from "./game-engine";
import { legacyBoardFixture } from "./legacy-board.fixture";

function table() {
  const { game, token: a } = createRoom("DEBT01", "Debtor");
  const b = addPlayer(game, "Creditor"), c = addPlayer(game, "Third");
  start(game, a);
  return { game, a, b, c, p: game.players[0]!, q: game.players[1]!, r: game.players[2]! };
}
function own(game: StoredGame, pid: string, ids: number[]) {
  for (const id of ids) game.board[id]!.ownerPlayerId = pid;
  for (const player of game.players) player.properties = game.board.filter(s => s.ownerPlayerId === player.id).map(s => s.id);
}
function resolve(game: StoredGame, token: string, action: "settle" | "bankrupt" = "settle") {
  resolveDebt(game, { sessionToken: token, debtId: game.debt!.id, action });
}
const restore = (game: StoredGame) => normalizeGame(JSON.parse(JSON.stringify(game)));

test("tax debt persists with full amount, pauses timer and blocks all competing actions", () => {
  const t = table(); t.p.cash = 50; t.p.position = 1;
  own(t.game, t.p.id, [1, 3, 5]);
  proposeTrade(t.game, { sessionToken: t.a, recipientPlayerId: t.q.id, offeredCash: 0, requestedCash: 0, offeredPropertyIds: [5], requestedPropertyIds: [] });
  const tradeId = t.game.trades[0]!.id;
  t.game.turnDeadline = Date.now() + 40000;
  roll(t.game, t.a, [1, 2]);
  assert.equal(t.p.cash, 50); assert.equal(t.p.bankrupt, false);
  assert.equal(t.game.debt!.amount, 200); assert.equal(t.game.debt!.creditorPlayerId, null);
  const g = restore(t.game);
  assert.deepEqual(view(g, t.a).debt, t.game.debt);
  assert.equal("pendingPayments" in view(g), false);
  reconcileLifecycle(g, Date.now() + 500000);
  assert.equal(g.currentPlayerId, t.p.id); assert.equal(g.turnDeadline, null);
  for (const act of [
    () => roll(g, t.a), () => end(g, t.a), () => buy(g, t.a),
    () => leaveJail(g, t.a, "card"), () => resign(g, t.b),
    () => manageProperty(g, { sessionToken: t.b, spaceId: 1, action: "mortgage" }),
    () => manageProperty(g, { sessionToken: t.a, spaceId: 1, action: "build" }),
    () => manageProperty(g, { sessionToken: t.a, spaceId: 1, action: "redeem" }),
    () => respondTrade(g, { sessionToken: t.b, tradeId, action: "accept" }),
    () => resolve(g, t.b), () => resolve(g, t.a),
  ]) assert.throws(act);
  for (const spaceId of [1, 3, 5]) manageProperty(g, { sessionToken: t.a, spaceId, action: "mortgage" });
  const id = g.debt!.id;
  assert.equal(g.debt!.amount, 200);
  resolve(g, t.a);
  assert.equal(g.players[0]!.cash, 10); assert.equal(g.debt, null);
  assert.equal(g.currentPlayerId, t.p.id);
  assert.ok(g.turnDeadline! - Date.now() <= 40000 && g.turnDeadline! - Date.now() > 39000);
  assert.throws(() => resolveDebt(g, { sessionToken: t.a, debtId: id, action: "settle" }), /no longer/);
  end(g, t.a); assert.equal(g.currentPlayerId, t.q.id);
});

test("rent debt allows even sales, fixes exact rent and pays creditor once", () => {
  const t = table(); own(t.game, t.p.id, [1, 3]); own(t.game, t.q.id, [39]);
  t.game.board[1]!.buildingLevel = 2; t.game.board[3]!.buildingLevel = 1;
  t.p.cash = 10; t.p.position = 36;
  roll(t.game, t.a, [1, 2]);
  assert.equal(t.game.debt!.amount, 50); assert.equal(t.game.debt!.creditorPlayerId, t.q.id);
  assert.equal(t.q.cash, 1500);
  assert.throws(() => manageProperty(t.game, { sessionToken: t.a, spaceId: 3, action: "sell-building" }), /evenly/);
  assert.throws(() => manageProperty(t.game, { sessionToken: t.a, spaceId: 1, action: "mortgage" }), /every building/);
  for (const spaceId of [1, 3]) manageProperty(t.game, { sessionToken: t.a, spaceId, action: "sell-building" });
  resolve(t.game, t.a);
  assert.equal(t.p.cash, 10); assert.equal(t.q.cash, 1550);
});

test("doubles stay available only after debt is settled", () => {
  const t = table(); own(t.game, t.p.id, [5]); t.p.cash = 100; t.p.position = 2;
  roll(t.game, t.a, [1, 1]);
  assert.throws(() => end(t.game, t.a), /debt/);
  manageProperty(t.game, { sessionToken: t.a, spaceId: 5, action: "mortgage" });
  resolve(t.game, t.a); end(t.game, t.a);
  assert.equal(t.game.currentPlayerId, t.p.id); assert.deepEqual(t.game.lastRoll, []);
});

test("forced Jail payment defers and resumes saved movement, including a second landing debt", () => {
  const t = table(); own(t.game, t.p.id, [5, 15]);
  own(t.game, t.q.id, [13]); t.game.board[13]!.buildingLevel = 2;
  t.p.cash = 0; t.p.position = 10; t.p.jailed = true; t.p.jailTurns = 2;
  roll(t.game, t.a, [1, 2]);
  assert.equal(t.p.position, 10); assert.equal(t.p.jailed, true);
  const g = restore(t.game), first = g.debt!.id;
  manageProperty(g, { sessionToken: t.a, spaceId: 5, action: "mortgage" }); resolve(g, t.a);
  assert.equal(g.players[0]!.position, 13); assert.equal(g.players[0]!.jailed, false);
  assert.equal(g.debt!.amount, 150); assert.equal(g.debt!.creditorPlayerId, t.q.id);
  assert.throws(() => resolveDebt(g, { sessionToken: t.a, debtId: first, action: "settle" }), /no longer/);
  manageProperty(g, { sessionToken: t.a, spaceId: 15, action: "mortgage" });
  resolve(g, t.a);
  assert.equal(g.players[0]!.position, 13); assert.equal(g.players[1]!.cash, 1650);
  assert.equal(g.extraRoll, false); assert.equal(g.debt, null);
});

test("voluntary Jail payment releases without moving or rolling after settlement", () => {
  const t = table(); own(t.game, t.p.id, [5]); t.p.cash = 0; t.p.jailed = true; t.p.position = 10;
  leaveJail(t.game, t.a, "pay");
  assert.equal(t.p.jailed, true); assert.deepEqual(t.game.lastRoll, []);
  manageProperty(t.game, { sessionToken: t.a, spaceId: 5, action: "mortgage" }); resolve(t.game, t.a);
  assert.equal(t.p.jailed, false); assert.equal(t.p.position, 10); assert.deepEqual(t.game.lastRoll, []);
  roll(t.game, t.a, [1, 2]); assert.equal(t.p.position, 13);
});

test("legacy Detention also waits for payment before moving", () => {
  const t = table(); t.game.board = legacyBoardFixture(); own(t.game, t.p.id, [1, 3]);
  t.p.cash = 0; t.p.position = 7; t.p.jailed = true;
  roll(t.game, t.a, [2, 2]); assert.equal(t.p.position, 7); assert.equal(t.p.jailed, true);
  const g = restore(t.game);
  for (const spaceId of [1, 3]) manageProperty(g, { sessionToken: t.a, spaceId, action: "mortgage" });
  resolve(g, t.a); assert.equal(g.players[0]!.position, 11); assert.equal(g.players[0]!.jailed, false);
});

test("chairman debts queue separate creditors and stale requests cannot settle the next debt", () => {
  const t = table(); t.game.chanceDeck = [14]; t.p.cash = 10; t.p.position = 4;
  own(t.game, t.p.id, [5, 6]); roll(t.game, t.a, [1, 2]);
  assert.equal(t.game.debt!.creditorPlayerId, t.q.id);
  assert.equal(t.r.cash, 1500);
  const g = restore(t.game), id = g.debt!.id;
  manageProperty(g, { sessionToken: t.a, spaceId: 6, action: "mortgage" }); resolve(g, t.a);
  assert.equal(g.debt!.creditorPlayerId, t.r.id); assert.equal(g.players[1]!.cash, 1550);
  assert.equal(g.players[2]!.cash, 1500);
  assert.throws(() => resolveDebt(g, { sessionToken: t.a, debtId: id, action: "settle" }), /no longer/);
  manageProperty(g, { sessionToken: t.a, spaceId: 5, action: "mortgage" }); resolve(g, t.a);
  assert.equal(g.players[2]!.cash, 1550); assert.equal(g.players[0]!.cash, 60);
  assert.equal(g.debt, null);
});

test("birthday card allows off-turn debtors to manage assets without taking the turn", () => {
  const t = table(); t.game.chestDeck = [8]; t.p.position = 14;
  t.q.cash = 0; t.r.cash = 0; own(t.game, t.q.id, [5]); own(t.game, t.r.id, [6]);
  roll(t.game, t.a, [1, 2]);
  assert.equal(t.game.debt!.debtorPlayerId, t.q.id);
  const g = restore(t.game);
  assert.equal(g.currentPlayerId, t.p.id);
  manageProperty(g, { sessionToken: t.b, spaceId: 5, action: "mortgage" }); resolve(g, t.b);
  assert.equal(g.debt!.debtorPlayerId, t.r.id);
  resolve(g, t.c, "bankrupt");
  assert.equal(g.currentPlayerId, t.p.id); assert.equal(g.players[0]!.cash, 1510);
  assert.equal(g.players[2]!.bankrupt, true); assert.equal(g.debt, null);
});

test("repair debt fixes the original charge even after buildings are sold", () => {
  const t = table(); t.game.chanceDeck = [10]; own(t.game, t.p.id, [1, 3]);
  t.p.position = 4; t.p.cash = 0; t.game.board[1]!.buildingLevel = 2; t.game.board[3]!.buildingLevel = 2;
  roll(t.game, t.a, [1, 2]); assert.equal(t.game.debt!.amount, 100);
  for (const spaceId of [1, 3, 1, 3]) manageProperty(t.game, { sessionToken: t.a, spaceId, action: "sell-building" });
  assert.equal(t.game.debt!.amount, 100); resolve(t.game, t.a); assert.equal(t.p.cash, 0);
});

test("bankruptcy transfers creditor assets/cards, skips active debtor and cancels later payments", () => {
  const t = table(); t.game.chanceDeck = [14]; t.game.heldJailCards = { [t.p.id]: ["chest"] };
  t.p.jailCards = 1; own(t.game, t.p.id, [1, 3, 5]); t.game.board[1]!.buildingLevel = 1; t.game.board[5]!.mortgaged = true;
  t.p.position = 4; t.p.cash = 10; roll(t.game, t.a, [1, 2]); resolve(t.game, t.a, "bankrupt");
  assert.equal(t.p.bankrupt, true); assert.equal(t.q.cash, 1510); assert.equal(t.r.cash, 1500);
  assert.equal(t.q.jailCards, 1); assert.equal(t.p.jailCards, 0);
  assert.equal(t.game.board[1]!.buildingLevel, 1); assert.equal(t.game.board[5]!.mortgaged, true);
  assert.equal(t.game.board[1]!.ownerPlayerId, t.q.id);
  assert.equal(t.game.currentPlayerId, t.q.id); assert.deepEqual(t.game.lastRoll, []);
  assert.equal(t.game.debt, null); assert.equal(t.game.pendingPayments, undefined);
});

test("bankruptcy to bank can finish the game and clears paused state", () => {
  const t = table(); t.r.bankrupt = true; t.p.cash = 0; t.p.position = 1;
  own(t.game, t.p.id, [5]); t.game.board[5]!.mortgaged = true;
  roll(t.game, t.a, [1, 2]); resolve(t.game, t.a, "bankrupt");
  assert.equal(t.game.phase, "finished"); assert.equal(t.game.winnerPlayerId, t.q.id);
  assert.equal(t.game.turnDeadline, null); assert.equal(t.game.debt, null);
  assert.equal(t.game.board[5]!.ownerPlayerId, null); assert.equal(t.game.board[5]!.mortgaged, false);
});