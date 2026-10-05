import test from "node:test";
import assert from "node:assert/strict";
import {
  createRoom, addPlayer, start, end, roll, view, normalizeGame, resign,
  reconcileLifecycle, touchPresence, proposeTrade, PRESENCE_TIMEOUT_MS,
  LOBBY_SEAT_GRACE_MS,
} from "./game-engine";

function table() {
  const { game, token } = createRoom("TIMER1", "Host");
  const second = addPlayer(game, "Second");
  const third = addPlayer(game, "Third");
  start(game, token);
  return { game, token, second, third, a: game.players[0]!, b: game.players[1]!, c: game.players[2]! };
}

test("turns are untimed: waiting any length of time never skips, rolls or pays for the player", () => {
  const t = table();
  assert.equal(t.game.turnDeadline, null);
  const originalPlayers = structuredClone(t.game.players);
  const later = Date.now() + 86_400_000;
  for (const p of t.game.players) p.lastSeenAt = later;
  reconcileLifecycle(t.game, later);
  assert.equal(t.game.currentPlayerId, t.a.id);
  assert.equal(t.game.turnNumber, 1);
  assert.equal(t.game.turnDeadline, null);
  assert.deepEqual(t.game.players.map(p => [p.cash, p.position, p.properties]), originalPlayers.map(p => [p.cash, p.position, p.properties]));
  assert.doesNotMatch(t.game.history.join("\n"), /skipped/);
});

test("doubles keep the same player's turn until they end it", () => {
  const t = table();
  t.a.position = 8; // Doubles land on Just Visiting, then Free Parking: no cards or deeds.
  roll(t.game, t.token, [1, 1]);
  end(t.game, t.token);
  assert.equal(t.game.currentPlayerId, t.a.id);
  assert.equal(t.game.turnDeadline, null);
  roll(t.game, t.token, [4, 6]);
  end(t.game, t.token);
  assert.equal(t.game.currentPlayerId, t.b.id);
  assert.equal(t.game.turnDeadline, null);
});

test("away and reconnect retain the same running-game seat and cannot revive a resignation", () => {
  const t = table();
  const now = t.a.lastSeenAt! + PRESENCE_TIMEOUT_MS;
  reconcileLifecycle(t.game, now);
  assert.equal(t.a.connected, false);
  assert.equal(view(t.game, t.token, now).myPlayerId, t.a.id);
  touchPresence(t.game, t.token, now);
  assert.equal(t.a.connected, true);
  assert.equal(t.a.lastSeenAt, now);
  assert.match(t.game.history[0]!, /reconnected/);
  resign(t.game, t.token);
  touchPresence(t.game, t.token, now + 1000);
  assert.equal(t.a.connected, false);
  assert.equal(t.a.bankrupt, true);
  assert.equal(t.a.resigned, true);
});

test("off-turn resignation returns assets and jail cards and invalidates trades without changing the active turn", () => {
  const t = table();
  proposeTrade(t.game, { sessionToken: t.token, recipientPlayerId: t.b.id, offeredCash: 10, requestedCash: 0, offeredPropertyIds: [], requestedPropertyIds: [] });
  const tile = t.game.board[1]!;
  Object.assign(tile, { ownerPlayerId: t.b.id, buildingLevel: 3, mortgaged: true });
  t.b.properties = [1]; t.b.jailCards = 1; t.game.heldJailCards![t.b.id] = ["chance"];
  resign(t.game, t.second);
  assert.equal(t.game.currentPlayerId, t.a.id);
  assert.equal(tile.ownerPlayerId, null);
  assert.equal(tile.buildingLevel, 0);
  assert.equal(tile.mortgaged, false);
  assert.equal(t.b.cash, 0);
  assert.deepEqual(t.b.properties, []);
  assert.equal(t.b.jailCards, 0);
  assert.equal(t.game.heldJailCards![t.b.id], undefined);
  assert.equal(t.game.trades[0]!.status, "invalidated");
  resign(t.game, t.second);
  assert.equal(t.game.phase, "playing");
});

test("active resignation skips doubles, advances once, and the last survivor wins", () => {
  const t = table();
  t.game.extraRoll = true; t.game.lastRoll = [3, 3];
  resign(t.game, t.token);
  assert.equal(t.game.currentPlayerId, t.b.id);
  assert.equal(t.game.turnNumber, 2);
  assert.deepEqual(t.game.lastRoll, []);
  resign(t.game, t.third);
  assert.equal(t.game.phase, "finished");
  assert.equal(t.game.winnerPlayerId, t.b.id);
  assert.equal(t.game.currentPlayerId, null);
  assert.equal(t.game.turnDeadline, null);
});

test("lobby hosts hand off, departing seats free capacity and tokens, and colors stay distinct", () => {
  const { game, token } = createRoom("LOBBY1", "Host");
  const b = addPlayer(game, "Second");
  const c = addPlayer(game, "Third");
  const now = game.players[0]!.lastSeenAt! + PRESENCE_TIMEOUT_MS;
  game.players[1]!.lastSeenAt = now;
  reconcileLifecycle(game, now);
  assert.equal(game.players[1]!.isHost, true);
  touchPresence(game, token, now);
  assert.equal(game.players[0]!.isHost, false);
  resign(game, b);
  assert.equal(game.tokens[b], undefined);
  assert.equal(game.players.length, 2);
  addPlayer(game, "Replacement");
  assert.equal(new Set(game.players.map(p => p.color)).size, 3);
  resign(game, c);
  resign(game, token);
  assert.equal(game.players.length, 1);
});

test("only waiting-room seats are reclaimed after the grace period", () => {
  const { game, token } = createRoom("LOBBY2", "Absent");
  addPlayer(game, "Here");
  const now = game.players[0]!.lastSeenAt! + LOBBY_SEAT_GRACE_MS;
  game.players[1]!.lastSeenAt = now;
  reconcileLifecycle(game, now);
  assert.equal(game.players.length, 1);
  assert.equal(game.tokens[token], undefined);
  assert.equal(game.players[0]!.isHost, true);
  const t = table();
  reconcileLifecycle(t.game, now + LOBBY_SEAT_GRACE_MS);
  assert.equal(t.game.players.length, 3);
  assert.equal(t.game.tokens[t.token], t.a.id);
});

test("legacy timed rooms lose their saved deadline and public views hide private state", () => {
  const t = table();
  Object.assign(t.game, { turnDeadline: 5000, turnDurationMs: 90_000, debtTurnRemainingMs: 1, auctionTurnRemainingMs: 1 });
  for (const p of t.game.players) { delete p.lastSeenAt; delete p.resigned; delete p.connected; }
  normalizeGame(t.game, 1000);
  assert.equal(t.game.turnDeadline, null);
  for (const key of ["turnDurationMs", "debtTurnRemainingMs", "auctionTurnRemainingMs"]) assert.equal(key in t.game, false);
  const restored = JSON.parse(JSON.stringify(t.game));
  reconcileLifecycle(restored, 1_000_000);
  assert.equal(restored.currentPlayerId, t.a.id);
  const publicView = view(restored, undefined, 2000);
  assert.equal(publicView.serverTime, 2000);
  for (const key of ["tokens", "chanceDeck", "chestDeck", "heldJailCards"]) assert.equal(key in publicView, false);
});