import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { pool } from "@workspace/db";
import {
  CreateGameBody, CreateGameResponse, GetGameParams, GetGameResponse,
  JoinGameBody, JoinGameResponse, StartGameBody, RollDiceBody, BuyPropertyBody,
  EndTurnBody, ListGamesResponse, LeaveJailBody, ResignGameBody,
   ManagePropertyBody, ProposeTradeBody, RespondTradeBody, ResolveDebtBody, RespondAuctionBody,
   type PropertyManagementInput, type TradeProposalInput, type TradeResponseInput, type DebtResolutionInput, type AuctionResponseInput,
} from "@workspace/api-zod";
import {
  addPlayer, createRoom, view, start, roll, buy, end, leaveJail, GameError, type StoredGame,
  normalizeGame, manageProperty, proposeTrade, respondTrade, reconcileTrades,
   reconcileLifecycle, touchPresence, resign, resolveDebt, respondAuction,
} from "../lib/game-engine";
import { nextRoomCheck, sweepDueRooms } from "../lib/room-timers";

const router: IRouter = Router();
const creationTimes = new Map<string, number[]>();
async function mutate(code: string, fn: (game: StoredGame) => void, token?: string): Promise<StoredGame> {
  const client = await pool.connect();
  let actionError: GameError | undefined;
  let saved: StoredGame;
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT state, next_reconcile_at FROM game_rooms WHERE code = $1 FOR UPDATE", [code.toUpperCase()]);
    if (!result.rows[0]) throw new GameError("That room does not exist. Check the code and try again.", 404);
    const original = JSON.stringify(result.rows[0].state);
    let game = result.rows[0].state as StoredGame;
    const now = Date.now();
    reconcileLifecycle(game, now);
    touchPresence(game, token, now);
    const reconciled = structuredClone(game);
    try { fn(game); }
    catch (error) {
      if (!(error instanceof GameError)) throw error;
      // A late/invalid action must not roll back the expired turn, nor leave a partial action.
      actionError = error;
      game = reconciled;
    }
    reconcileLifecycle(game, now); reconcileTrades(game); normalizeGame(game, now);
    const serialized = JSON.stringify(game);
    const nextCheck = nextRoomCheck(game);
    if (serialized !== original || nextCheck?.getTime() !== result.rows[0].next_reconcile_at?.getTime()) {
      await client.query(
        "UPDATE game_rooms SET state = $1, next_reconcile_at = $2, updated_at = CASE WHEN $3 THEN NOW() ELSE updated_at END WHERE code = $4",
        [serialized, nextCheck, serialized !== original, game.code],
      );
    }
    await client.query("COMMIT");
    saved = game;
  } catch (error) {
    await client.query("ROLLBACK"); throw error;
  } finally { client.release(); }
  if (actionError) throw actionError;
  return saved;
}

// Timers continue when no browser is polling. Persisted deadlines survive restarts;
// competing requests/processes serialize through the same row lock.
let sweeping = false;
export async function sweepRooms() {
  if (sweeping) return false;
  sweeping = true;
  try {
    return (await sweepDueRooms()).saturated;
  } finally { sweeping = false; }
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
  const rooms = result.rows.map(row => normalizeGame(row.state as StoredGame)).filter(g => g.phase !== "finished" && g.players.length).map(g => ({
    code: g.code, hostName: (g.players.find(p => p.isHost) ?? g.players[0])!.name, players: g.players.length,
    maxPlayers: 6, phase: g.phase, createdAt: g.createdAt, connectedPlayers: g.players.filter(p => p.connected).length,
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
    const result = await pool.query("INSERT INTO game_rooms (code, state, next_reconcile_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING code", [code, JSON.stringify(game), nextRoomCheck(game)]);
    if (result.rowCount) {
      res.status(201).json(CreateGameResponse.parse({ game: view(game, token), sessionToken: token }));
      return;
    }
  }
  throw new GameError("Could not create a room. Please try again.", 503);
});
router.get("/games/:code", async (req, res): Promise<void> => {
  const token = req.get("X-Game-Token");
  const game = await mutate(codeOf(req), () => {}, token);
  res.json(GetGameResponse.parse(view(game, token)));
});
router.post("/games/:code/players", async (req, res): Promise<void> => {
  const input = bodyOf<{ playerName: string; sessionToken?: string }>(JoinGameBody, req.body);
  let token = input.sessionToken ?? "";
  const game = await mutate(codeOf(req), g => {
    if (token && g.tokens[token]) return;
    token = addPlayer(g, input.playerName);
  }, token);
  res.json(JoinGameResponse.parse({ game: view(game, token), sessionToken: token }));
});
router.post("/games/:code/jail", async (req, res): Promise<void> => {
  const { sessionToken, method } = bodyOf<{ sessionToken: string; method: "pay" | "card" }>(LeaveJailBody, req.body);
  const game = await mutate(codeOf(req), g => leaveJail(g, sessionToken, method), sessionToken);
  res.json(GetGameResponse.parse(view(game, sessionToken)));
});
for (const [path, schema, action] of [
  ["start", StartGameBody, start], ["roll", RollDiceBody, roll],
  ["buy", BuyPropertyBody, buy], ["pass", EndTurnBody, end], ["resign", ResignGameBody, resign],
] as const) {
  router.post(`/games/:code/${path}`, async (req, res): Promise<void> => {
    const { sessionToken } = bodyOf<{ sessionToken: string }>(schema, req.body);
    const game = await mutate(codeOf(req), g => action(g, sessionToken), sessionToken);
    res.json(GetGameResponse.parse(view(game, sessionToken)));
  });
}
router.post("/games/:code/auction", async (req, res): Promise<void> => {
  const input = bodyOf<AuctionResponseInput>(RespondAuctionBody, req.body);
  const game = await mutate(codeOf(req), g => respondAuction(g, input), input.sessionToken);
  res.json(GetGameResponse.parse(view(game, input.sessionToken)));
});
router.post("/games/:code/debt", async (req, res): Promise<void> => {
  const input = bodyOf<DebtResolutionInput>(ResolveDebtBody, req.body);
  const game = await mutate(codeOf(req), g => resolveDebt(g, input), input.sessionToken);
  res.json(GetGameResponse.parse(view(game, input.sessionToken)));
});
router.post("/games/:code/property", async (req, res): Promise<void> => {
  const input = bodyOf<PropertyManagementInput>(ManagePropertyBody, req.body);
  const game = await mutate(codeOf(req), g => manageProperty(g, input), input.sessionToken);
  res.json(GetGameResponse.parse(view(game, input.sessionToken)));
});
router.post("/games/:code/trades", async (req, res): Promise<void> => {
  const input = bodyOf<TradeProposalInput>(ProposeTradeBody, req.body);
  const game = await mutate(codeOf(req), g => proposeTrade(g, input), input.sessionToken);
  res.json(GetGameResponse.parse(view(game, input.sessionToken)));
});
router.post("/games/:code/trades/respond", async (req, res): Promise<void> => {
  const input = bodyOf<TradeResponseInput>(RespondTradeBody, req.body);
  const game = await mutate(codeOf(req), g => respondTrade(g, input), input.sessionToken);
  res.json(GetGameResponse.parse(view(game, input.sessionToken)));
});
router.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) { next(err); return; }
  if (err instanceof GameError) { res.status(err.status).json({ error: err.message }); return; }
  req.log.error({ err }, "Game request failed");
  res.status(500).json({ error: "The game server hit a problem. Please try again." });
});
export default router;