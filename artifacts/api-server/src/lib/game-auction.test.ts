import test from "node:test";
import assert from "node:assert/strict";
import {
  addPlayer, createRoom, start, end, buy, roll, manageProperty, proposeTrade,
  respondTrade, resign, respondAuction, reconcileLifecycle, view,
} from "./game-engine";
import type { AuctionResponseInput } from "@workspace/api-zod";
import { legacyBoardFixture } from "./legacy-board.fixture";

function table(legacy = true) {
  const { game, token: a } = createRoom("AUCT01", "Decliner");
  const b = addPlayer(game, "Bidder");
  const c = addPlayer(game, "Third");
  if (legacy) game.board = legacyBoardFixture();
  start(game, a);
  const [p, q, r] = game.players;
  p!.position = legacy ? 3 : 39;
  game.lastRoll = [1, 2];
  return { game, a, b, c, p: p!, q: q!, r: r! };
}
function action(t: ReturnType<typeof table>, token: string, action: AuctionResponseInput["action"], amount?: number) {
  respondAuction(t.game, { sessionToken: token, auctionId: t.game.auction!.id, action, amount });
}

test("decline starts saved auction without changing the original board or seats", () => {
  const t = table();
  assert.equal(t.game.board.length, 28);
  t.p.cash = 0;
  end(t.game, t.a);
  assert.equal(t.game.currentPlayerId, t.p.id);
  assert.equal(t.game.turnDeadline, null);
  assert.equal(t.game.auction!.spaceId, 3);
  assert.equal(t.game.auction!.increment, 10);
  assert.deepEqual(t.game.auction!.eligiblePlayerIds, t.game.players.map(p => p.id));
  const restored = JSON.parse(JSON.stringify(t.game));
  const publicState = view(restored, t.b);
  assert.deepEqual(publicState.auction, t.game.auction);
  assert.equal(publicState.myPlayerId, t.q.id);
  assert.equal("tokens" in publicState, false);
  assert.equal("auctionTurnRemainingMs" in publicState, false);
});

test("off-turn, jailed and declining players bid; cash, increments and binding withdrawals checked", () => {
  const t = table(); t.q.jailed = true;
  end(t.game, t.a);
  for (const amount of [0, 9, 10.5, NaN, 1501, 1000001]) {
    assert.throws(() => action(t, t.b, "bid", amount));
  }
  assert.throws(() => action(t, "unknown-session", "bid", 10), /session/);
  action(t, t.b, "bid", 10);
  assert.equal(t.q.cash, 1500);
  assert.throws(() => action(t, t.c, "bid", 19), /at least/);
  assert.throws(() => action(t, t.b, "withdraw"), /binding/);
  assert.throws(() => action(t, t.b, "bid", 20), /binding/);
  action(t, t.a, "bid", 21);
  action(t, t.b, "withdraw");
  assert.throws(() => action(t, t.b, "bid", 31), /withdrew/);
  const id = t.game.auction!.id;
  action(t, t.c, "withdraw");
  assert.equal(t.game.auction, null);
  assert.equal(t.p.cash, 1479);
  assert.deepEqual(t.p.properties, [3]);
  assert.equal(t.game.board[3]!.ownerPlayerId, t.p.id);
  assert.equal(t.game.currentPlayerId, t.q.id);
  assert.equal(t.game.turnNumber, 2);
  assert.throws(() => respondAuction(t.game, { sessionToken: t.a, auctionId: id, action: "bid", amount: 40 }), /no longer/);
  assert.equal(t.p.cash, 1479);
});

test("withdrawals, absent bidders, persisted deadline and no-bid closure cannot stall or repeat an award", () => {
  const t = table(); end(t.game, t.a);
  action(t, t.a, "withdraw"); action(t, t.b, "withdraw"); action(t, t.c, "withdraw");
  assert.equal(t.game.auction, null);
  assert.equal(t.game.board[3]!.ownerPlayerId, null);
  assert.equal(t.game.currentPlayerId, t.q.id);
  const u = table(); end(u.game, u.a); action(u, u.b, "bid", 10);
  const saved = JSON.parse(JSON.stringify(u.game));
  const now = saved.auction.deadline + 1;
  reconcileLifecycle(saved, now);
  assert.equal(saved.players[1].cash, 1490);
  assert.equal(saved.board[3].ownerPlayerId, u.q.id);
  assert.equal(saved.turnDeadline, null);
  reconcileLifecycle(saved, now);
  assert.equal(saved.players[1].cash, 1490);
  const v = table(); end(v.game, v.a);
  reconcileLifecycle(v.game, v.game.auction!.deadline);
  assert.equal(v.game.board[3]!.ownerPlayerId, null);
  assert.equal(v.game.currentPlayerId, v.q.id);
});

test("new bids reset deadline; withdrawals do not; stale IDs and ineligible seats rejected", () => {
  const t = table(); t.r.bankrupt = true; end(t.game, t.a);
  assert.throws(() => action(t, t.c, "bid", 10), /live seated/);
  assert.throws(() => respondAuction(t.game, { sessionToken: t.b, auctionId: "stale", action: "bid", amount: 10 }), /no longer/);
  const before = t.game.auction!.deadline;
  const now = before - 1000;
  respondAuction(t.game, { sessionToken: t.b, auctionId: t.game.auction!.id, action: "bid", amount: 10 }, now);
  assert.equal(t.game.auction!.deadline, now + 30000);
  const timeout = t.game.auction!.deadline;
  assert.throws(() => respondAuction(t.game, { sessionToken: t.a, auctionId: t.game.auction!.id, action: "bid", amount: 20 }, timeout), /no longer/);
  action(t, t.a, "withdraw");
  assert.equal(t.game.auction, null);
});

test("auction pauses all conflicting actions and never auto-starts without a decline", () => {
  const t = table(); end(t.game, t.a);
  for (const fn of [
    () => end(t.game, t.a), () => buy(t.game, t.a), () => roll(t.game, t.a),
    () => resign(t.game, t.b),
    () => manageProperty(t.game, { sessionToken: t.a, spaceId: 1, action: "mortgage" }),
    () => proposeTrade(t.game, { sessionToken: t.a, recipientPlayerId: t.q.id, offeredCash: 10, requestedCash: 0, offeredPropertyIds: [], requestedPropertyIds: [] }),
    () => respondTrade(t.game, { sessionToken: t.b, tradeId: "test", action: "accept" }),
  ]) assert.throws(fn, /auction/);
  assert.throws(() => start(t.game, t.a), /already started/);
  const u = table(); reconcileLifecycle(u.game, Date.now() + 600_000);
  assert.equal(u.game.auction, null);
  assert.equal(u.game.currentPlayerId, u.p.id);
  const v = table(); v.game.debt = { id: "debt", debtorPlayerId: v.p.id, creditorPlayerId: null, amount: 100 };
  assert.throws(() => end(v.game, v.a), /debt/);
  assert.equal(v.game.auction, undefined);
});

test("classic doubles resume only once even when unsold; high-ID utilities auction too", () => {
  const t = table(false); t.game.extraRoll = true; t.game.consecutiveDoubles = 1;
  end(t.game, t.a);
  const now = t.game.auction!.deadline;
  reconcileLifecycle(t.game, now);
  assert.equal(t.game.currentPlayerId, t.p.id);
  assert.deepEqual(t.game.lastRoll, []);
  assert.equal(t.game.turnDeadline, null);
  assert.equal(t.game.turnNumber, 1);
  assert.throws(() => end(t.game, t.a), /Roll/);
  t.game.lastRoll = [1, 2]; t.p.position = 28;
  end(t.game, t.a);
  assert.equal(t.game.auction!.spaceId, 28);
});