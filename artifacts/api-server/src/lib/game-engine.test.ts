import test from "node:test";
import assert from "node:assert/strict";
import {
  addPlayer, createRoom, start, buy, end, roll, view, normalizeGame,
  manageProperty, proposeTrade, respondTrade, reconcileTrades, rentFor, GameError, resolveDebt,
} from "./game-engine";
import type { StoredGame } from "./game-engine";
import type { PropertyManagementInput, TradeProposalInput } from "@workspace/api-zod";
import { legacyBoardFixture } from "./legacy-board.fixture";

function table() {
  const { game, token: a } = createRoom("ABC123", "Builder");
  const b = addPlayer(game, "Partner");
  const c = addPlayer(game, "Observer");
  start(game, a);
  game.board = legacyBoardFixture();
  return { game, a, b, c, p: game.players[0]!, q: game.players[1]!, r: game.players[2]! };
}
function own(game: StoredGame, pid: string, ids: number[]) {
  for (const id of ids) game.board[id]!.ownerPlayerId = pid;
  for (const p of game.players) p.properties = game.board.filter(s => s.ownerPlayerId === p.id).map(s => s.id);
}
function manage(game: StoredGame, token: string, spaceId: number, action: PropertyManagementInput["action"]) {
  manageProperty(game, { sessionToken: token, spaceId, action });
  reconcileTrades(game);
}
function offer(t: ReturnType<typeof table>, overrides: Partial<TradeProposalInput> = {}) {
  proposeTrade(t.game, {
    sessionToken: t.a, recipientPlayerId: t.q.id, offeredCash: 50, requestedCash: 0,
    offeredPropertyIds: [], requestedPropertyIds: [], ...overrides,
  });
  return t.game.trades[0]!;
}
const fails = (fn: () => void, text: RegExp) => assert.throws(fn, text);

test("original board, sessions, start, and purchase still work", () => {
  const t = table();
  assert.equal(t.game.board.length, 28);
  assert.equal(t.p.cash, 1500);
  assert.equal(view(t.game, t.a).myPlayerId, t.p.id);
  assert.equal(view(t.game).myPlayerId, null);
  assert.equal("tokens" in view(t.game), false);
  t.game.lastRoll = [1, 2]; t.p.position = 3;
  buy(t.game, t.a);
  assert.equal(t.p.cash, 1420);
  assert.equal(t.game.board[3]!.ownerPlayerId, t.p.id);
  end(t.game, t.a);
  assert.equal(t.game.currentPlayerId, t.q.id);
});

test("classic board and doubles survive property-development integration", () => {
  const { game, token } = createRoom("NEW40", "Classic Builder");
  const other = addPlayer(game, "Classic Partner"); start(game, token);
  assert.equal(game.board.length, 40);
  const p = game.players[0]!, q = game.players[1]!;
  own(game, p.id, [37, 39]); p.cash = 10000;
  for (let i = 0; i < 5; i++) {
    manage(game, token, 37, "build"); manage(game, token, 39, "build");
  }
  assert.equal(rentFor(game, game.board[39]!), 2000);
  assert.equal(rentFor(game, game.board[37]!), 1500);
  p.position = 8; roll(game, token, [1, 1]); end(game, token);
  assert.equal(game.currentPlayerId, p.id);
  assert.equal(game.extraRoll, false);
  roll(game, token, [1, 2]); end(game, token);
  assert.equal(game.currentPlayerId, q.id);
  assert.equal(view(game, other).myPlayerId, q.id);
  assert.equal("chanceDeck" in view(game), false);
});

test("mortgaged utilities neither collect rent nor count toward other utility rent", () => {
  const { game, token } = createRoom("UTIL40", "Utility Owner");
  addPlayer(game, "Renter"); start(game, token);
  const p = game.players[0]!, q = game.players[1]!;
  own(game, p.id, [12, 28]);
  manage(game, token, 28, "mortgage");
  game.currentPlayerId = q.id; q.position = 9;
  const renter = Object.entries(game.tokens).find(([, id]) => id === q.id)![0];
  roll(game, renter, [1, 2]);
  assert.equal(q.cash, 1488); assert.equal(p.cash, 1587);
  assert.equal(rentFor(game, game.board[28]!), 0);
});

test("Chance repairs charge for houses and hotels", () => {
  const { game, token } = createRoom("CARD40", "Owner");
  addPlayer(game, "Other"); start(game, token);
  const p = game.players[0]!;
  own(game, p.id, [1, 3]); game.board[1]!.buildingLevel = 4; game.board[3]!.buildingLevel = 5;
  game.chanceDeck = [10]; p.position = 4;
  roll(game, token, [1, 2]);
  assert.equal(p.cash, 1300);
});

test("old JSON rooms upgrade without losing ownership or seats", () => {
  const t = table(); own(t.game, t.p.id, [1, 3]);
  const old = JSON.parse(JSON.stringify(t.game));
  delete old.trades;
  for (const s of old.board) {
    delete s.buildingLevel; delete s.mortgaged; delete s.buildCost; delete s.currentRent;
  }
  const upgraded = view(old, t.a);
  assert.equal(upgraded.myPlayerId, t.p.id);
  assert.deepEqual(upgraded.trades, []);
  assert.equal(upgraded.board[1]!.currentRent, 24);
  assert.equal(upgraded.board[1]!.buildCost, 50);
  assert.equal(upgraded.board[1]!.buildingLevel, 0);
  assert.equal(upgraded.board[1]!.mortgaged, false);
});

test("management requires a valid live session, turn, and ownership", () => {
  const t = table(); own(t.game, t.p.id, [1, 3]);
  fails(() => manage(t.game, "invalid", 1, "build"), /session/);
  fails(() => manage(t.game, t.b, 1, "build"), /turn/);
  fails(() => manage(t.game, t.a, 5, "mortgage"), /own/);
  fails(() => manage(t.game, t.a, 0, "build"), /own/);
  t.p.bankrupt = true;
  fails(() => manage(t.game, t.a, 1, "build"), /Bankrupt/);
});

test("build requires complete unmortgaged color group and money", () => {
  const t = table(); own(t.game, t.p.id, [1]);
  fails(() => manage(t.game, t.a, 1, "build"), /complete/);
  own(t.game, t.p.id, [3]); t.game.board[3]!.mortgaged = true;
  fails(() => manage(t.game, t.a, 1, "build"), /mortgage/);
  t.game.board[3]!.mortgaged = false; t.p.cash = 49;
  fails(() => manage(t.game, t.a, 1, "build"), /\$50/);
  t.p.cash = 50; manage(t.game, t.a, 1, "build");
  assert.equal(t.p.cash, 0); assert.equal(t.game.board[1]!.buildingLevel, 1);
});

test("build evenly through four houses and hotels; sell evenly to zero", () => {
  const t = table(); own(t.game, t.p.id, [1, 3]);
  for (let level = 1; level <= 5; level++) {
    manage(t.game, t.a, 1, "build");
    if (level < 5) fails(() => manage(t.game, t.a, 1, "build"), /evenly/);
    manage(t.game, t.a, 3, "build");
    assert.equal(rentFor(t.game, t.game.board[1]!), 12 * [0, 3, 5, 7, 9, 12][level]!);
  }
  assert.equal(t.p.cash, 1000);
  fails(() => manage(t.game, t.a, 1, "build"), /hotel/);
  manage(t.game, t.a, 1, "sell-building");
  assert.equal(t.game.board[1]!.buildingLevel, 4);
  fails(() => manage(t.game, t.a, 1, "sell-building"), /evenly/);
  manage(t.game, t.a, 3, "sell-building");
  for (let level = 4; level > 0; level--) {
    manage(t.game, t.a, 1, "sell-building"); manage(t.game, t.a, 3, "sell-building");
  }
  assert.equal(t.p.cash, 1250);
  assert.equal(rentFor(t.game, t.game.board[1]!), 24);
  fails(() => manage(t.game, t.a, 1, "sell-building"), /no buildings/);
});

test("Sapphire includes Crown Heights in the full group requirement", () => {
  const t = table(); own(t.game, t.p.id, [16, 18]);
  fails(() => manage(t.game, t.a, 16, "build"), /complete/);
  own(t.game, t.p.id, [27]); manage(t.game, t.a, 16, "build");
  assert.equal(t.game.board[16]!.buildingLevel, 1);
});

test("stations cannot build or sell buildings", () => {
  const t = table(); own(t.game, t.p.id, [4]);
  fails(() => manage(t.game, t.a, 4, "build"), /Stations/);
  fails(() => manage(t.game, t.a, 4, "sell-building"), /no buildings/);
});

test("mortgage group must be undeveloped; rent/bonus restore on redemption", () => {
  const t = table(); own(t.game, t.p.id, [1, 3]);
  manage(t.game, t.a, 3, "build");
  fails(() => manage(t.game, t.a, 1, "mortgage"), /every building/);
  manage(t.game, t.a, 3, "sell-building");
  manage(t.game, t.a, 1, "mortgage");
  assert.equal(rentFor(t.game, t.game.board[1]!), 0);
  assert.equal(rentFor(t.game, t.game.board[3]!), 16);
  fails(() => manage(t.game, t.a, 1, "mortgage"), /already/);
  t.p.cash = 32;
  fails(() => manage(t.game, t.a, 1, "redeem"), /\$33/);
  t.p.cash = 33; manage(t.game, t.a, 1, "redeem");
  assert.equal(t.p.cash, 0);
  assert.equal(view(t.game).board[3]!.currentRent, 32);
  fails(() => manage(t.game, t.a, 1, "redeem"), /not mortgaged/);
});

test("station mortgage doesn't count toward rent; redemption is exactly $110", () => {
  const t = table(); own(t.game, t.p.id, [4, 12, 19, 26]);
  assert.equal(rentFor(t.game, t.game.board[4]!), 200);
  manage(t.game, t.a, 12, "mortgage");
  assert.equal(t.p.cash, 1600);
  assert.equal(rentFor(t.game, t.game.board[4]!), 100);
  manage(t.game, t.a, 12, "redeem");
  assert.equal(t.p.cash, 1490);
});

test("property management is allowed before and after rolling", () => {
  const t = table(); own(t.game, t.p.id, [1, 3]);
  manage(t.game, t.a, 1, "build");
  t.game.lastRoll = [2, 4];
  manage(t.game, t.a, 3, "build");
  assert.equal(t.game.board[3]!.buildingLevel, 1);
});

test("trade rejects self, unknown, bankrupt, empty, duplicate, wrong ownership and decimals", () => {
  const t = table(); own(t.game, t.p.id, [1]); own(t.game, t.q.id, [5]);
  fails(() => offer(t, { recipientPlayerId: t.p.id }), /another live/);
  fails(() => offer(t, { recipientPlayerId: "missing" }), /another live/);
  t.q.bankrupt = true;
  fails(() => offer(t), /another live/); t.q.bankrupt = false;
  fails(() => offer(t, { offeredCash: 0 }), /at least/);
  fails(() => offer(t, { offeredPropertyIds: [1, 1] }), /only once/);
  fails(() => offer(t, { offeredPropertyIds: [5] }), /owned/);
  for (const cash of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1000001]) {
    fails(() => offer(t, { offeredCash: cash }), /whole dollars/);
  }
});

test("a group's buildings prevent trading even its undeveloped properties", () => {
  const t = table(); own(t.game, t.p.id, [1, 3]);
  manage(t.game, t.a, 1, "build");
  fails(() => offer(t, { offeredPropertyIds: [3] }), /all buildings/);
});

test("one outgoing offer; offer reserves nothing and recipient consents off-turn", () => {
  const t = table(); own(t.game, t.p.id, [1]); own(t.game, t.q.id, [5]);
  const tr = offer(t, { offeredPropertyIds: [1], requestedPropertyIds: [5], requestedCash: 25 });
  assert.equal(t.p.cash, 1500); assert.equal(t.game.board[1]!.ownerPlayerId, t.p.id);
  fails(() => offer(t), /pending/);
  fails(() => respondTrade(t.game, { sessionToken: t.a, tradeId: tr.id, action: "accept" }), /recipient/);
  fails(() => respondTrade(t.game, { sessionToken: t.c, tradeId: tr.id, action: "reject" }), /recipient/);
  respondTrade(t.game, { sessionToken: t.b, tradeId: tr.id, action: "accept" });
  assert.equal(tr.status, "accepted");
  assert.equal(t.p.cash, 1475); assert.equal(t.q.cash, 1525);
  assert.deepEqual(t.p.properties, [5]); assert.deepEqual(t.q.properties, [1]);
  assert.equal(t.game.currentPlayerId, t.p.id);
  fails(() => respondTrade(t.game, { sessionToken: t.b, tradeId: tr.id, action: "accept" }), /already accepted/);
});

test("cash-only offers support reject/cancel with no transfer", () => {
  const t = table(); const tr = offer(t);
  fails(() => respondTrade(t.game, { sessionToken: t.b, tradeId: tr.id, action: "cancel" }), /proposer/);
  respondTrade(t.game, { sessionToken: t.b, tradeId: tr.id, action: "reject" });
  assert.equal(tr.status, "rejected"); assert.equal(t.p.cash, 1500);
  const next = offer(t);
  respondTrade(t.game, { sessionToken: t.a, tradeId: next.id, action: "cancel" });
  assert.equal(next.status, "cancelled"); assert.equal(t.q.cash, 1500);
});

test("mortgaged properties transfer unchanged with disclosed redemption obligation", () => {
  const t = table(); own(t.game, t.p.id, [4]);
  manage(t.game, t.a, 4, "mortgage");
  const tr = offer(t, { offeredPropertyIds: [4] });
  assert.equal(tr.offeredProperties[0]!.mortgaged, true);
  respondTrade(t.game, { sessionToken: t.b, tradeId: tr.id, action: "accept" });
  assert.equal(t.game.board[4]!.mortgaged, true);
  assert.equal(t.game.board[4]!.ownerPlayerId, t.q.id);
  assert.equal(t.q.cash, 1550); // no hidden transfer fee
});

test("stale ownership, mortgage, buildings, and cash prevent acceptance without partial transfers", () => {
  for (const change of ["owner", "mortgage", "building", "cash"] as const) {
    const t = table(); own(t.game, t.p.id, [1, 3]); own(t.game, t.q.id, [5]);
    const tr = offer(t, { offeredPropertyIds: [1], requestedPropertyIds: [5], requestedCash: 100 });
    if (change === "owner") own(t.game, t.r.id, [1]);
    if (change === "mortgage") t.game.board[1]!.mortgaged = true;
    if (change === "building") t.game.board[3]!.buildingLevel = 1;
    if (change === "cash") t.q.cash = 99;
    const before = JSON.stringify(t.game);
    assert.throws(() => respondTrade(t.game, { sessionToken: t.b, tradeId: tr.id, action: "accept" }), GameError);
    assert.equal(JSON.stringify(t.game), before);
    reconcileTrades(t.game);
    assert.equal(tr.status, "invalidated");
  }
});

test("offers require independent affordability, not net proceeds", () => {
  const t = table(); t.p.cash = 5;
  fails(() => offer(t, { offeredCash: 10, requestedCash: 20 }), /afford/);
  fails(() => offer(t, { offeredCash: 0, requestedCash: 1501 }), /afford/);
});

test("finished games and bankrupt players cannot trade; offers invalidate", () => {
  const t = table(); const tr = offer(t);
  t.q.bankrupt = true;
  fails(() => respondTrade(t.game, { sessionToken: t.b, tradeId: tr.id, action: "accept" }), /Bankrupt/);
  reconcileTrades(t.game); assert.equal(tr.status, "invalidated");
  t.q.bankrupt = false; const next = offer(t);
  t.game.phase = "finished";
  fails(() => respondTrade(t.game, { sessionToken: t.b, tradeId: next.id, action: "accept" }), /not in progress/);
  fails(() => manage(t.game, t.a, 1, "mortgage"), /not in progress/);
  reconcileTrades(t.game); assert.equal(next.status, "invalidated");
});

test("resolved offer history is bounded without dropping pending offers", () => {
  const t = table();
  for (let i = 0; i < 40; i++) {
    const tr = offer(t);
    respondTrade(t.game, { sessionToken: t.b, tradeId: tr.id, action: "reject" });
    reconcileTrades(t.game);
  }
  const pending = offer(t); reconcileTrades(t.game);
  assert.equal(t.game.trades.length, 31);
  assert.equal(t.game.trades[0]!.id, pending.id);
});

test("bankruptcy to the bank clears developments and mortgages", () => {
  const t = table(); own(t.game, t.p.id, [1, 3, 4]);
  t.game.board[1]!.buildingLevel = 1; t.game.board[4]!.mortgaged = true;
  t.p.cash = 0; t.p.jailed = true;
  roll(t.game, t.a); normalizeGame(t.game);
  assert.equal(t.p.bankrupt, false);
  resolveDebt(t.game, { sessionToken: t.a, debtId: t.game.debt!.id, action: "bankrupt" });
  assert.equal(t.p.bankrupt, true);
  for (const id of [1, 3, 4]) {
    assert.equal(t.game.board[id]!.ownerPlayerId, null);
    assert.equal(t.game.board[id]!.buildingLevel, 0);
    assert.equal(t.game.board[id]!.mortgaged, false);
  }
});

test("landing actually charges upgraded rent and preserves inherited asset state", () => {
  const t = table(); own(t.game, t.p.id, [1, 27]);
  t.game.board[1]!.buildingLevel = 2; t.game.board[27]!.mortgaged = true;
  // Dice totals range 2–12; make each possible landing the same rent case.
  for (const s of t.game.board.filter(s => s.id >= 2 && s.id <= 12)) {
    s.type = "property"; s.price = 100; s.rent = 10; s.buildingLevel = 5;
    s.ownerPlayerId = t.q.id; s.group = "Fixture";
  }
  t.q.properties = t.game.board.filter(s => s.ownerPlayerId === t.q.id).map(s => s.id);
  t.p.cash = 100;
  roll(t.game, t.a);
  assert.equal(t.p.bankrupt, false);
  resolveDebt(t.game, { sessionToken: t.a, debtId: t.game.debt!.id, action: "bankrupt" });
  assert.equal(t.p.bankrupt, true);
  assert.equal(t.p.cash, 0);
  assert.equal(t.q.cash, 1600); // only the $100 available toward $120 rent
  assert.equal(t.game.board[1]!.ownerPlayerId, t.q.id);
  assert.equal(t.game.board[1]!.buildingLevel, 2);
  assert.equal(t.game.board[27]!.ownerPlayerId, t.q.id);
  assert.equal(t.game.board[27]!.mortgaged, true);
  assert.ok(t.q.properties.includes(1) && t.q.properties.includes(27));
  assert.deepEqual(t.p.properties, []);
});

test("landing on a mortgaged property charges no rent", () => {
  const t = table();
  for (const s of t.game.board.filter(s => s.id >= 2 && s.id <= 12)) {
    s.type = "property"; s.price = 100; s.rent = 10; s.buildingLevel = 0;
    s.ownerPlayerId = t.q.id; s.group = "Fixture"; s.mortgaged = true;
  }
  roll(t.game, t.a);
  assert.equal(t.p.cash, 1500);
  assert.equal(t.q.cash, 1500);
  assert.match(t.game.message, /No rent is due/);
});