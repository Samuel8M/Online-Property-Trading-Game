import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { pool } from "@workspace/db";
import {
  CreateGameBody, CreateGameResponse, GetGameParams, GetGameResponse,
  JoinGameBody, JoinGameResponse, StartGameBody, RollDiceBody, BuyPropertyBody,
  EndTurnBody, ListGamesResponse, LeaveJailBody,
  ManagePropertyBody, ProposeTradeBody, RespondTradeBody,
  type PropertyManagementInput, type TradeProposalInput, type TradeResponseInput,
} from "@workspace/api-zod";
import {
  addPlayer, createRoom, view, start, roll, buy, end, leaveJail, GameError, type StoredGame,
  normalizeGame, manageProperty, proposeTrade, respondTrade, reconcileTrades,
} from "../lib/game-engine";

const router: IRouter = Router();
const creationTimes = new Map<string, number[]>();
async function mutate(code: string, fn: (game: StoredGame) => void): Promise<StoredGame> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT state FROM game_rooms WHERE code = $1 FOR UPDATE", [code.toUpperCase()]);
    if (!result.rows[0]) throw new GameError("That room does not exist. Check the code and try again.", 404);
    const game = normalizeGame(result.rows[0].state as StoredGame);
    fn(game); reconcileTrades(game); normalizeGame(game);
    await client.query("UPDATE game_rooms SET state = $1, updated_at = NOW() WHERE code = $2", [JSON.stringify(game), game.code]);
    await client.query("COMMIT");
    return game;
  } catch (error) {
    await client.query("ROLLBACK"); throw error;
  } finally { client.release(); }
}
function codeOf(req: Request): string {
  const parsed = GetGameParams.safeParse(req.params);
  if (!parsed.success) throw new GameError("Enter a valid room code.");
  return parsed.data.code.toUpperCase();
}
function bodyOf<T>(schema: { safeParse: (input: unknown) => { success: boolean; data?: T } }, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new GameError("Invalid request. Check your player session, names, property selections, and whole-dollar amounts.");
  return parsed.data!;
}
router.use("/games", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.get("/games", async (_req, res): Promise<void> => {
  const result = await pool.query("SELECT state FROM game_rooms WHERE updated_at > NOW() - INTERVAL '24 hours' ORDER BY updated_at DESC LIMIT 30");
  const rooms = result.rows.map(row => row.state as StoredGame).filter(g => g.phase !== "finished").map(g => ({
    code: g.code, hostName: g.players[0]!.name, players: g.players.length,
    maxPlayers: 6, phase: g.phase, createdAt: g.createdAt,
  }));
  res.json(ListGamesResponse.parse({ rooms }));
});
router.post("/games", async (req, res): Promise<void> => {
  const { playerName } = bodyOf<{ playerName: string }>(CreateGameBody, req.body);
  const ip = req.ip ?? "unknown";
  const recent = (creationTimes.get(ip) ?? []).filter(time => time > Date.now() - 3_600_000);
  if (recent.length >= 20) throw new GameError("Too many new rooms. Join an existing room or try again later.", 429);
  recent.push(Date.now()); creationTimes.set(ip, recent);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomBytes(3).toString("hex").toUpperCase();
    const { game, token } = createRoom(code, playerName);
    const result = await pool.query("INSERT INTO game_rooms (code, state) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING code", [code, JSON.stringify(game)]);
    if (result.rowCount) {
      res.status(201).json(CreateGameResponse.parse({ game: view(game, token), sessionToken: token }));
      return;
    }
  }
  throw new GameError("Could not create a room. Please try again.", 503);
});
router.get("/games/:code", async (req, res): Promise<void> => {
  const result = await pool.query("SELECT state FROM game_rooms WHERE code = $1", [codeOf(req)]);
  if (!result.rows[0]) throw new GameError("Room not found. Create a new table or check the code.", 404);
  res.json(GetGameResponse.parse(view(result.rows[0].state as StoredGame, req.get("X-Game-Token"))));
});
router.post("/games/:code/players", async (req, res): Promise<void> => {
  const input = bodyOf<{ playerName: string; sessionToken?: string }>(JoinGameBody, req.body);
  let token = input.sessionToken ?? "";
  const game = await mutate(codeOf(req), g => {
    if (token && g.tokens[token]) return;
    token = addPlayer(g, input.playerName);
  });
  res.json(JoinGameResponse.parse({ game: view(game, token), sessionToken: token }));
});
router.post("/games/:code/jail", async (req, res): Promise<void> => {
  const { sessionToken, method } = bodyOf<{ sessionToken: string; method: "pay" | "card" }>(LeaveJailBody, req.body);
  const game = await mutate(codeOf(req), g => leaveJail(g, sessionToken, method));
  res.json(GetGameResponse.parse(view(game, sessionToken)));
});
for (const [path, schema, action] of [
  ["start", StartGameBody, start], ["roll", RollDiceBody, roll],
  ["buy", BuyPropertyBody, buy], ["pass", EndTurnBody, end],
] as const) {
  router.post(`/games/:code/${path}`, async (req, res): Promise<void> => {
    const { sessionToken } = bodyOf<{ sessionToken: string }>(schema, req.body);
    const game = await mutate(codeOf(req), g => action(g, sessionToken));
    res.json(GetGameResponse.parse(view(game, sessionToken)));
  });
}
router.post("/games/:code/property", async (req, res): Promise<void> => {
  const input = bodyOf<PropertyManagementInput>(ManagePropertyBody, req.body);
  const game = await mutate(codeOf(req), g => manageProperty(g, input));
  res.json(GetGameResponse.parse(view(game, input.sessionToken)));
});
router.post("/games/:code/trades", async (req, res): Promise<void> => {
  const input = bodyOf<TradeProposalInput>(ProposeTradeBody, req.body);
  const game = await mutate(codeOf(req), g => proposeTrade(g, input));
  res.json(GetGameResponse.parse(view(game, input.sessionToken)));
});
router.post("/games/:code/trades/respond", async (req, res): Promise<void> => {
  const input = bodyOf<TradeResponseInput>(RespondTradeBody, req.body);
  const game = await mutate(codeOf(req), g => respondTrade(g, input));
  res.json(GetGameResponse.parse(view(game, input.sessionToken)));
});
router.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) { next(err); return; }
  if (err instanceof GameError) { res.status(err.status).json({ error: err.message }); return; }
  req.log.error({ err }, "Game request failed");
  res.status(500).json({ error: "The game server hit a problem. Please try again." });
});
export default router;