// Opt-in against the managed API; only the rooms created here are changed.
import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import type { GameView, GameJoinResult } from "@workspace/api-zod";

const base = `${process.env.GAME_API_BASE ?? "http://localhost:80"}/api/games`;
async function post(path: string, body: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
test("chat persists for players and spectators while rejecting unauthenticated posts", { skip: process.env.GAME_API_TEST !== "1" }, async () => {
  let code = "";
  try {
    const created = (await post("", { playerName: "Chat Host" })).data as GameJoinResult;
    code = created.game.code;
    const second = (await post(`/${code}/players`, { playerName: "Chat Guest" })).data as GameJoinResult;
    const sent = await post(`/${code}/chat`, { sessionToken: created.sessionToken, text: "welcome!" });
    assert.equal(sent.status, 200);
    assert.deepEqual((sent.data as GameView).chat!.map(m => m.text), ["welcome!"]);
    assert.equal((await post(`/${code}/chat`, { sessionToken: "not-a-real-session-token", text: "hi" })).status, 403);
    assert.equal((await post(`/${code}/chat`, { sessionToken: second.sessionToken, text: "" })).status, 400);
    assert.equal((await post(`/${code}/chat`, { sessionToken: created.sessionToken, text: "again" })).status, 429);
    assert.equal((await post(`/${code}/chat`, { sessionToken: second.sessionToken, text: "hello host" })).status, 200);
    const spectator = await fetch(`${base}/${code}`);
    const seen = await spectator.json() as GameView;
    assert.deepEqual(seen.chat!.map(m => [m.name, m.text]), [["Chat Host", "welcome!"], ["Chat Guest", "hello host"]]);
    assert.equal(seen.myPlayerId, null);
  } finally {
    if (code) await pool.query("DELETE FROM game_rooms WHERE code = $1", [code]);
  }
});
test.after(async () => { await pool.end(); });
