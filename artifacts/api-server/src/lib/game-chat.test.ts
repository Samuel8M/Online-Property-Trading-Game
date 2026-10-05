import test from "node:test";
import assert from "node:assert/strict";
import {
  createRoom, addPlayer, start, resign, sendChat, view, GameError, CHAT_LIMIT, CHAT_MIN_INTERVAL_MS,
} from "./game-engine";

test("seated players chat in lobby and play; text is normalized and attributed", () => {
  const { game, token } = createRoom("CHAT01", "Host");
  const second = addPlayer(game, "Second");
  sendChat(game, { sessionToken: token, text: "  hello \n  table " }, 1_000);
  start(game, token);
  sendChat(game, { sessionToken: second, text: "good luck" }, 2_000);
  const chat = view(game).chat!;
  assert.deepEqual(chat.map(m => [m.name, m.text, m.at]), [["Host", "hello table", 1_000], ["Second", "good luck", 2_000]]);
  assert.equal(chat[0]!.color, game.players[0]!.color);
  assert.equal(game.history.some(line => line.includes("hello")), false, "chat stays out of the game log");
});

test("spectators, resigned seats, blank, long and rapid messages are rejected", () => {
  const { game, token } = createRoom("CHAT02", "Host");
  const second = addPlayer(game, "Second");
  const third = addPlayer(game, "Third");
  start(game, token);
  assert.throws(() => sendChat(game, { sessionToken: "spectator-token-xyz", text: "hi" }), GameError);
  assert.throws(() => sendChat(game, { sessionToken: token, text: "   " }), /between 1 and 200/);
  assert.throws(() => sendChat(game, { sessionToken: token, text: "x".repeat(201) }), /between 1 and 200/);
  sendChat(game, { sessionToken: token, text: "one" }, 10_000);
  assert.throws(() => sendChat(game, { sessionToken: token, text: "two" }, 10_000 + CHAT_MIN_INTERVAL_MS - 1), /too quickly/);
  sendChat(game, { sessionToken: second, text: "others are unaffected" }, 10_001);
  resign(game, third);
  assert.throws(() => sendChat(game, { sessionToken: third, text: "bye" }, 20_000), /Resigned/);
  assert.equal(game.chat!.length, 2);
});

test("chat keeps only the most recent messages", () => {
  const { game, token } = createRoom("CHAT03", "Host");
  for (let i = 0; i < CHAT_LIMIT + 5; i++) sendChat(game, { sessionToken: token, text: `m${i}` }, i * CHAT_MIN_INTERVAL_MS);
  assert.equal(game.chat!.length, CHAT_LIMIT);
  assert.equal(game.chat![0]!.text, "m5");
  assert.equal(game.chat!.at(-1)!.text, `m${CHAT_LIMIT + 4}`);
});
