import { test } from "node:test";
import assert from "node:assert/strict";
import { addPlayer, createRoom, start, roll, end, leaveJail, view, buy, resolveDebt } from "./game-engine";
function setup() {
  const { game, token } = createRoom("TEST40", "Alice");
  const otherToken = addPlayer(game, "Bob"); start(game, token);
  return { game, token, otherToken, alice: game.players[0]!, bob: game.players[1]! };
}
test("classic board contains all forty spaces, correct corners and property types", () => {
  const { game } = setup();
  assert.equal(game.board.length, 40);
  assert.deepEqual([0, 10, 20, 30].map(i => game.board[i]!.type), ["start", "jail", "rest", "go-to-jail"]);
  assert.equal(game.board.filter(t => t.type === "property").length, 22);
  assert.equal(game.board.filter(t => t.type === "transit").length, 4);
  assert.equal(game.board.filter(t => t.type === "utility").length, 2);
  assert.equal(game.board.filter(t => t.type === "chance").length, 3);
  assert.equal(game.board.filter(t => t.type === "community-chest").length, 3);
  assert.equal(game.board[39]!.name, "Boardwalk"); assert.equal(game.board[39]!.price, 400);
});
test("doubles retain the player after buying, and the third consecutive double sends them to Jail", () => {
  const { game, token, alice, bob } = setup();
  alice.position = 8; roll(game, token, [1, 1]); assert.equal(game.extraRoll, true);
  end(game, token); assert.equal(game.currentPlayerId, alice.id); assert.equal(game.turnNumber, 1);
  roll(game, token, [2, 2]); buy(game, token); assert.equal(game.board[14]!.ownerPlayerId, alice.id);
  end(game, token); roll(game, token, [3, 3]);
  assert.equal(alice.position, 10); assert.equal(alice.jailed, true); assert.equal(game.extraRoll, false);
  end(game, token); assert.equal(game.currentPlayerId, bob.id);
});
test("non-doubles end the bonus sequence and pass the turn", () => {
  const { game, token, alice, bob } = setup();
  alice.position = 8; roll(game, token, [1, 1]); end(game, token); roll(game, token, [1, 2]);
  assert.equal(game.extraRoll, false); assert.equal(game.consecutiveDoubles, 0);
  buy(game, token);
  end(game, token); assert.equal(game.currentPlayerId, bob.id);
});
test("Jail doubles release and move the player but do not earn another roll", () => {
  const { game, token, alice, bob } = setup();
  alice.position = 10; alice.jailed = true; roll(game, token, [2, 2]);
  assert.equal(alice.jailed, false); assert.equal(alice.position, 14);
  assert.equal(alice.cash, 1500); assert.equal(game.extraRoll, false);
  buy(game, token);
  end(game, token); assert.equal(game.currentPlayerId, bob.id);
});
test("Jail requires up to three attempts, then a $50 fine and movement", () => {
  const { game, token, alice } = setup(); alice.position = 10; alice.jailed = true;
  for (let attempt = 1; attempt <= 3; attempt++) {
    game.lastRoll = []; roll(game, token, [1, 2]);
    assert.equal(alice.position, attempt < 3 ? 10 : 13); assert.equal(alice.jailed, attempt < 3);
  }
  assert.equal(alice.cash, 1450);
});
test("paying bail before rolling allows ordinary doubles rules afterward", () => {
  const { game, token, alice } = setup(); alice.position = 10; alice.jailed = true;
  leaveJail(game, token, "pay"); assert.equal(alice.cash, 1450);
  roll(game, token, [2, 2]); assert.equal(game.extraRoll, true);
});
test("a Jail Free card is held out of its deck and returned when used", () => {
  const { game, token, alice } = setup(); game.chanceDeck = [7, 0, 1]; alice.position = 4;
  roll(game, token, [1, 2]); assert.equal(alice.jailCards, 1); assert.equal(game.chanceDeck.includes(7), false);
  game.lastRoll = []; alice.position = 10; alice.jailed = true; leaveJail(game, token, "card");
  assert.equal(alice.jailCards, 0); assert.equal(alice.jailed, false); assert.equal(game.chanceDeck.includes(7), true);
});
test("utility rents are dice-based at 4x or 10x, and transfer to the owner", () => {
  for (const both of [false, true]) {
    const { game, token, alice, bob } = setup();
    game.board[12]!.ownerPlayerId = bob.id; if (both) game.board[28]!.ownerPlayerId = bob.id;
    alice.position = 9; roll(game, token, [1, 2]);
    assert.equal(alice.cash, 1500 - (both ? 30 : 12)); assert.equal(bob.cash, 1500 + (both ? 30 : 12));
  }
});
test("GO pays exactly $200, and Go To Jail cancels extra rolls without paying GO", () => {
  const { game, token, alice } = setup(); alice.position = 38; roll(game, token, [1, 1]);
  assert.equal(alice.position, 0); assert.equal(alice.cash, 1700); end(game, token);
  alice.position = 26; roll(game, token, [2, 2]);
  assert.equal(alice.position, 10); assert.equal(alice.cash, 1700); assert.equal(game.extraRoll, false);
});
test("Income Tax is $200, wrong players cannot roll, and private decks stay hidden", () => {
  const { game, token, otherToken, alice } = setup();
  assert.throws(() => roll(game, otherToken, [1, 2]), /Wait for your turn/);
  alice.position = 1; roll(game, token, [1, 2]); assert.equal(alice.cash, 1300);
  assert.throws(() => roll(game, token, [1, 2]), /already rolled/);
  const publicGame = view(game, token);
  assert.equal("tokens" in publicGame, false); assert.equal("chanceDeck" in publicGame, false);
  assert.equal("heldJailCards" in publicGame, false);
});
test("bankrupt players return held Jail Free cards to the bank's deck", () => {
  const { game, token, alice } = setup(); game.chanceDeck = [7, 0, 1]; alice.position = 4;
  roll(game, token, [1, 2]); assert.equal(alice.jailCards, 1);
  game.lastRoll = []; alice.position = 1; alice.cash = 1; roll(game, token, [1, 2]);
  resolveDebt(game, { sessionToken: token, debtId: game.debt!.id, action: "bankrupt" });
  assert.equal(alice.bankrupt, true); assert.equal(alice.jailCards, 0); assert.equal(game.chanceDeck.includes(7), true);
});