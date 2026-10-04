import { randomInt, randomUUID } from "node:crypto";
import type {
  GameView, GamePlayer, GameSpace, GameTrade, TradeProperty,
  PropertyManagementInput, TradeProposalInput, TradeResponseInput, DebtResolutionInput,
} from "@workspace/api-zod";
import { classicBoard, chanceCards, chestCards, type ClassicCard } from "./classic-board";

export type StoredGame = Omit<GameView, "myPlayerId" | "serverTime"> & {
  tokens: Record<string, string>;
  chanceDeck?: number[];
  chestDeck?: number[];
  heldJailCards?: Record<string, ("chance" | "chest")[]>;
  pendingPayments?: { debtorPlayerId: string; creditorPlayerId: string | null; amount: number }[];
  debtTurnRemainingMs?: number;
  debtContinuation?: { playerId: string; steps: number };
};
export class GameError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const colors = ["#f97316", "#27b7b0", "#9b7cf4", "#e65b84", "#f0bb40", "#5482ee"];
export const TURN_DURATION_MS = 90_000;
export const PRESENCE_TIMEOUT_MS = 45_000;
export const LOBBY_SEAT_GRACE_MS = 300_000;
const buildingCosts: Record<string, number> = {
  Copper: 50, Coral: 100, Garden: 100, Violet: 150, Sapphire: 150, Rose: 200, Gold: 200,
  Brown: 50, "Light blue": 50, Pink: 100, Orange: 100, Red: 150, Yellow: 150, Green: 200, "Dark blue": 200,
};
export function makeBoard(): GameSpace[] {
  return classicBoard();
}

export function addHistory(game: StoredGame, text: string) {
  game.message = text;
  game.history = [text, ...game.history].slice(0, 60);
}
export function normalizeGame(game: StoredGame, now = Date.now()): StoredGame {
  game.trades ??= [];
  game.debt ??= null;
  game.turnDurationMs = TURN_DURATION_MS;
  game.turnDeadline ??= game.phase === "playing" ? now + TURN_DURATION_MS : null;
  if (game.phase !== "playing" || game.debt) game.turnDeadline = null;
  for (const player of game.players) {
    // Old rooms get a full reconnect grace period, not an immediate timeout.
    player.lastSeenAt ??= now;
    player.resigned ??= false;
    player.connected = !player.resigned && now - player.lastSeenAt < PRESENCE_TIMEOUT_MS;
  }
  const classic = game.board.length === 40 ? classicBoard() : [];
  for (const tile of game.board) {
    tile.buildingLevel ??= 0;
    tile.mortgaged ??= false;
    tile.buildCost = tile.type === "property" ? buildingCosts[tile.group!] ?? null : null;
    const original = classic[tile.id];
    if (original?.name === tile.name && original.developmentRents) tile.developmentRents = original.developmentRents;
    tile.currentRent = rentFor(game, tile);
  }
  return game;
}
function colorGroup(game: StoredGame, tile: GameSpace): GameSpace[] {
  return game.board.filter(s => s.type === "property" && s.group === tile.group);
}
export function rentFor(game: StoredGame, tile: GameSpace): number | null {
  if (tile.price === null) return null;
  if (tile.mortgaged) return 0;
  if (tile.type === "utility") {
    const count = game.board.filter(s => s.type === "utility" && s.ownerPlayerId === tile.ownerPlayerId && !s.mortgaged).length;
    return game.lastRoll.length ? game.lastRoll.reduce((a, b) => a + b, 0) * (tile.ownerPlayerId && count === 2 ? 10 : 4) : null;
  }
  if (tile.type === "transit") {
    const count = game.board.filter(s => s.type === "transit" && s.ownerPlayerId === tile.ownerPlayerId && !s.mortgaged).length;
    return tile.ownerPlayerId ? 25 * 2 ** (count - 1) : 25;
  }
  const level = tile.buildingLevel ?? 0;
  if (level > 0) return tile.developmentRents?.[level] ?? tile.rent! * [1, 3, 5, 7, 9, 12][level]!;
  const group = colorGroup(game, tile);
  const complete = tile.ownerPlayerId && group.every(s => s.ownerPlayerId === tile.ownerPlayerId && !s.mortgaged);
  return tile.rent! * (complete ? 2 : 1);
}
export function cleanName(raw: string) {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name || name.length > 18) throw new GameError("Choose a name between 1 and 18 characters.");
  return name;
}
export function addPlayer(game: StoredGame, name: string): string {
  if (game.phase !== "lobby") throw new GameError("This game has started. You can watch, or create a new room.");
  if (game.players.length >= 6) throw new GameError("This room is full (6 players).");
  const token = randomUUID();
  const id = randomUUID();
  game.players.push({
    id, name: cleanName(name), color: colors.find(c => !game.players.some(p => p.color === c))!, cash: 1500,
    position: 0, jailed: false, bankrupt: false, properties: [], isHost: game.players.length === 0,
    jailTurns: 0, jailCards: 0, lastSeenAt: Date.now(), connected: true, resigned: false,
  });
  game.tokens[token] = id;
  addHistory(game, `${cleanName(name)} joined the table.`);
  return token;
}
export function createRoom(code: string, name: string): { game: StoredGame; token: string } {
  const game: StoredGame = {
    code, phase: "lobby", players: [], board: makeBoard(), currentPlayerId: null,
    turnNumber: 1, lastRoll: [], message: "", history: [], winnerPlayerId: null,
    createdAt: Date.now(), tokens: {}, trades: [], consecutiveDoubles: 0, extraRoll: false, rollSerial: 0,
    chanceDeck: shuffledDeck(), chestDeck: shuffledDeck(), heldJailCards: {},
  };
  return { game, token: addPlayer(game, name) };
}
export function view(game: StoredGame, token?: string, now = Date.now()): GameView {
  normalizeGame(game, now);
  const { tokens, chanceDeck, chestDeck, heldJailCards, pendingPayments, debtTurnRemainingMs, debtContinuation, ...publicGame } = game;
  return { ...publicGame, serverTime: now, myPlayerId: token ? tokens[token] ?? null : null };
}
function playerFor(game: StoredGame, token: string): GamePlayer {
  const player = game.players.find(p => p.id === game.tokens[token]);
  if (!player) throw new GameError("Your player session is not valid. Rejoin this room.", 403);
  return player;
}
function activePlayer(game: StoredGame, token: string): GamePlayer {
  if (game.debt) throw new GameError("Resolve the outstanding debt first.");
  const player = playerFor(game, token);
  if (game.phase !== "playing") throw new GameError("The game is not in progress.");
  if (game.currentPlayerId !== player.id) throw new GameError("Wait for your turn.");
  return player;
}
function livePlayer(game: StoredGame, token: string): GamePlayer {
  if (game.debt) throw new GameError("Trades are paused while a debt is outstanding.");
  const player = playerFor(game, token);
  if (game.phase !== "playing") throw new GameError("The game is not in progress.");
  if (player.bankrupt) throw new GameError("Bankrupt players cannot manage assets or trade.");
  return player;
}
function checkWinner(game: StoredGame) {
  const alive = game.players.filter(p => !p.bankrupt);
  if (alive.length === 1) {
    game.phase = "finished";
    game.turnDeadline = null;
    game.currentPlayerId = null;
    game.extraRoll = false;
    game.winnerPlayerId = alive[0]!.id;
    addHistory(game, `${alive[0]!.name} wins Monopoly!`);
  }
}
function pay(game: StoredGame, player: GamePlayer, amount: number, creditor?: GamePlayer) {
  if (amount <= 0) return;
  if (game.debt) {
    (game.pendingPayments ??= []).push({ debtorPlayerId: player.id, creditorPlayerId: creditor?.id ?? null, amount });
    return;
  }
  if (player.cash < amount) {
    game.debtTurnRemainingMs ??= Math.max(1, (game.turnDeadline ?? Date.now() + TURN_DURATION_MS) - Date.now());
    game.debt = { id: randomUUID(), debtorPlayerId: player.id, creditorPlayerId: creditor?.id ?? null, amount };
    game.turnDeadline = null;
    addHistory(game, `${player.name} owes $${amount} to ${creditor?.name ?? "the bank"}. Sell buildings or mortgage deeds, then pay or declare bankruptcy. The turn timer is paused.`);
    return;
  }
  player.cash -= amount;
  if (creditor) creditor.cash += amount;
}
function bankruptForDebt(game: StoredGame, player: GamePlayer, amount: number, creditor?: GamePlayer) {
  const payment = player.cash;
  player.cash -= payment;
  if (creditor) creditor.cash += payment;
    player.bankrupt = true;
    player.cash = 0;
    for (const tile of game.board.filter(s => s.ownerPlayerId === player.id)) {
      tile.ownerPlayerId = creditor?.id ?? null;
      if (creditor) creditor.properties.push(tile.id);
      else { tile.buildingLevel = 0; tile.mortgaged = false; }
    }
    player.properties = [];
    const heldCards = game.heldJailCards?.[player.id] ?? [];
    if (creditor && heldCards.length) {
      game.heldJailCards ??= {};
      (game.heldJailCards[creditor.id] ??= []).push(...heldCards);
      creditor.jailCards = (creditor.jailCards ?? 0) + heldCards.length;
    } else {
      for (const source of heldCards) {
        (game[source === "chance" ? "chanceDeck" : "chestDeck"] ??= []).push(source === "chance" ? 7 : 4);
      }
    }
    if (game.heldJailCards) delete game.heldJailCards[player.id];
    player.jailCards = 0;
    addHistory(game, `${player.name} declared bankruptcy on a $${amount} debt. ${creditor ? "Their properties transfer to " + creditor.name + "." : "Their properties return to the bank."}`);
    checkWinner(game);
}
export function resolveDebt(game: StoredGame, input: DebtResolutionInput) {
  const player = playerFor(game, input.sessionToken);
  const debt = game.debt;
  if (game.phase !== "playing" || !debt || debt.id !== input.debtId) throw new GameError("This debt is no longer outstanding.");
  if (debt.debtorPlayerId !== player.id) throw new GameError("Only the debtor can resolve this debt.", 403);
  const creditor = game.players.find(p => p.id === debt.creditorPlayerId);
  if (input.action === "settle") {
    if (player.cash < debt.amount) throw new GameError(`Raise another $${debt.amount - player.cash} before paying this debt.`);
    player.cash -= debt.amount;
    if (creditor) creditor.cash += debt.amount;
    addHistory(game, `${player.name} settled $${debt.amount} with ${creditor?.name ?? "the bank"}.`);
  } else if (input.action === "bankrupt") {
    bankruptForDebt(game, player, debt.amount, creditor);
  } else throw new GameError("Unknown debt action.");
  game.debt = null;
  while (game.pendingPayments?.length && !game.debt && game.phase === "playing") {
    const next = game.pendingPayments.shift()!;
    const debtor = game.players.find(p => p.id === next.debtorPlayerId);
    const receiver = game.players.find(p => p.id === next.creditorPlayerId);
    if (debtor && !debtor.bankrupt && (!receiver || !receiver.bankrupt)) pay(game, debtor, next.amount, receiver);
  }
  if (game.debt) return;
  const continuation = game.debtContinuation;
  delete game.debtContinuation;
  if (game.phase === "playing" && continuation) {
    const mover = game.players.find(p => p.id === continuation.playerId)!;
    if (!mover.bankrupt) {
      mover.jailed = false;
      mover.jailTurns = 0;
      if (continuation.steps) {
        move(game, mover, continuation.steps);
        resolveLanding(game, mover);
      }
    }
  }
  if (game.debt) return;
  if (game.phase === "playing") {
    if (game.players.find(p => p.id === game.currentPlayerId)?.bankrupt) advanceTurn(game);
    else game.turnDeadline = Date.now() + (game.debtTurnRemainingMs ?? TURN_DURATION_MS);
  }
  delete game.debtTurnRemainingMs;
  delete game.pendingPayments;
}
function move(game: StoredGame, player: GamePlayer, steps: number) {
  if (player.position + steps >= game.board.length) {
    player.cash += 200;
    addHistory(game, `${player.name} passed GO and collected $200.`);
  }
  player.position = (player.position + steps) % game.board.length;
}
function shuffledDeck() {
  const deck = Array.from({ length: 16 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}
function sendToJail(game: StoredGame, player: GamePlayer) {
  player.position = game.board.findIndex(s => s.type === "jail");
  player.jailed = true;
  player.jailTurns = 0;
  game.extraRoll = false;
  game.consecutiveDoubles = 0;
  addHistory(game, `${player.name} goes directly to Jail. No GO payment.`);
}
function advanceTo(game: StoredGame, player: GamePlayer, destination: number) {
  let steps = (destination - player.position + game.board.length) % game.board.length;
  if (steps === 0 && destination === 0) steps = game.board.length;
  move(game, player, steps);
}
function drawCard(game: StoredGame, player: GamePlayer, deckType: "chance" | "chest") {
  const cards = deckType === "chance" ? chanceCards : chestCards;
  const key = deckType === "chance" ? "chanceDeck" : "chestDeck";
  const deck = game[key] ?? (game[key] = shuffledDeck());
  const id = deck.shift();
  if (id === undefined) throw new GameError("The card deck is unavailable.");
  const card: ClassicCard = cards[id]!;
  addHistory(game, `${deckType === "chance" ? "Chance" : "Community Chest"} — ${player.name}: ${card.text}`);
  if (card.jailCard) {
    game.heldJailCards ??= {};
    (game.heldJailCards[player.id] ??= []).push(deckType);
    player.jailCards = (player.jailCards ?? 0) + 1;
  } else {
    deck.push(id);
    if (card.jail) sendToJail(game, player);
    else if (card.repairs) {
      const amount = game.board.filter(s => s.ownerPlayerId === player.id).reduce((total, s) =>
        total + (s.buildingLevel === 5 ? card.repairs!.hotel : (s.buildingLevel ?? 0) * card.repairs!.house), 0);
      pay(game, player, amount);
    }
    else if (card.money) {
      if (card.money > 0) player.cash += card.money;
      else pay(game, player, -card.money);
    } else if (card.moveTo !== undefined) {
      advanceTo(game, player, card.moveTo);
      resolveLanding(game, player);
    } else if (card.back) {
      player.position = (player.position - card.back + game.board.length) % game.board.length;
      resolveLanding(game, player);
    } else if (card.nearest) {
      const destination = Array.from({ length: game.board.length }, (_, i) => (player.position + i + 1) % game.board.length)
        .find(i => game.board[i]!.type === card.nearest)!;
      advanceTo(game, player, destination);
      resolveLanding(game, player, card.nearest === "transit" ? 2 : 1, card.nearest === "utility");
    } else if (card.perPlayer) {
      for (const other of game.players.filter(p => p.id !== player.id && !p.bankrupt)) {
        if (player.bankrupt || game.phase === "finished") break;
        if (card.perPlayer > 0) pay(game, other, card.perPlayer, player);
        else pay(game, player, -card.perPlayer, other);
      }
    }
  }
}
function resolveLanding(game: StoredGame, player: GamePlayer, rentMultiplier = 1, utilityCard = false) {
  const tile = game.board[player.position]!;
  if (tile.price !== null) {
    if (!tile.ownerPlayerId) {
      addHistory(game, `${player.name} landed on ${tile.name}. Buy it for $${tile.price}, or pass.`);
    } else if (tile.ownerPlayerId === player.id) {
      addHistory(game, `${player.name} landed on their own ${tile.name}. Welcome home.`);
    } else {
      const owner = game.players.find(p => p.id === tile.ownerPlayerId)!;
      if (tile.mortgaged) {
        addHistory(game, `${player.name} landed on mortgaged ${tile.name}. No rent is due.`);
        return;
      }
      let rent = rentFor(game, tile)!;
      if (tile.type === "utility" && utilityCard) {
        const diceTotal = randomInt(1, 7) + randomInt(1, 7);
        rent = diceTotal * 10;
        addHistory(game, `${player.name} rolls a utility total of ${diceTotal}.`);
      }
      rent *= rentMultiplier;
      addHistory(game, `${player.name} pays ${owner.name} $${rent} rent for ${tile.name}.`);
      pay(game, player, rent, owner);
    }
  } else if (tile.type === "tax") {
    const amount = game.board.length === 40 ? (tile.id === 4 ? 200 : 100) : (tile.id === 24 ? 150 : 100);
    addHistory(game, `${player.name} pays $${amount} ${tile.name.toLowerCase()}.`);
    pay(game, player, amount);
  } else if (tile.type === "go-to-jail") {
    sendToJail(game, player);
  } else if (game.board.length === 40 && (tile.type === "chance" || tile.type === "community-chest")) {
    drawCard(game, player, tile.type === "chance" ? "chance" : "chest");
  } else if (tile.type === "chance") {
    const card = randomInt(0, 5);
    if (card === 0) {
      player.cash += 150;
      addHistory(game, `Lucky Break: ${player.name} earned a $150 investment dividend.`);
    } else if (card === 1) {
      player.cash += 100;
      addHistory(game, `Lucky Break: ${player.name} won a $100 city award.`);
    } else if (card === 2) {
      addHistory(game, `Lucky Break: ${player.name} pays $75 for unexpected repairs.`);
      pay(game, player, 75);
    } else if (card === 3) {
      player.position = 0;
      player.cash += 200;
      addHistory(game, `Lucky Break: ${player.name} advances to Start and collects $200.`);
    } else {
      sendToJail(game, player);
    }
  } else {
    addHistory(game, `${player.name} landed on ${tile.name}. No payment due.`);
  }
}
export function start(game: StoredGame, token: string) {
  const player = playerFor(game, token);
  if (!player.isHost) throw new GameError("Only the room host can start the game.", 403);
  if (game.phase !== "lobby") throw new GameError("This game has already started.");
  if (game.players.length < 2) throw new GameError("Invite at least one more player to start.");
  if (game.board.length !== 40) game.board = makeBoard();
  game.phase = "playing";
  game.currentPlayerId = game.players[0]!.id;
  game.turnDeadline = Date.now() + TURN_DURATION_MS;
  addHistory(game, `The pursuit begins! ${game.players[0]!.name} rolls first.`);
}
export function roll(game: StoredGame, token: string, dice: [number, number] = [randomInt(1, 7), randomInt(1, 7)]) {
  const player = activePlayer(game, token);
  if (game.lastRoll.length) throw new GameError("You already rolled. Buy or end your turn.");
  if (player.bankrupt) throw new GameError("Your player is bankrupt.");
  game.lastRoll = dice;
  game.rollSerial = (game.rollSerial ?? 0) + 1;
  const doubles = dice[0] === dice[1];
  game.extraRoll = false;
  if (player.jailed) {
    if (game.board.length === 28) {
      addHistory(game, `${player.name} pays $50 and leaves Detention.`);
      pay(game, player, 50);
      if (game.debt) {
        game.debtContinuation = { playerId: player.id, steps: dice[0] + dice[1] };
        return;
      }
      player.jailed = false;
    } else {
    game.consecutiveDoubles = 0;
    player.jailTurns = (player.jailTurns ?? 0) + 1;
    if (doubles) {
      player.jailed = false;
      player.jailTurns = 0;
      addHistory(game, `${player.name} rolled doubles and leaves Jail. No extra roll for leaving Jail.`);
    } else if (player.jailTurns < 3) {
      addHistory(game, `${player.name} rolled ${dice.join(" + ")} and stays in Jail (attempt ${player.jailTurns} of 3).`);
      return;
    } else {
      addHistory(game, `${player.name}'s third Jail attempt: pay $50 and move by the dice.`);
      pay(game, player, 50);
      if (game.debt) {
        game.debtContinuation = { playerId: player.id, steps: dice[0] + dice[1] };
        return;
      }
      player.jailed = false;
      player.jailTurns = 0;
    }
    }
  } else {
    game.consecutiveDoubles = doubles ? (game.consecutiveDoubles ?? 0) + 1 : 0;
    if (game.consecutiveDoubles === 3) {
      addHistory(game, `${player.name} rolled three consecutive doubles.`);
      sendToJail(game, player);
      return;
    }
    game.extraRoll = game.board.length === 40 && doubles;
  }
  const total = game.lastRoll[0]! + game.lastRoll[1]!;
  addHistory(game, `${player.name} rolled ${game.lastRoll[0]} + ${game.lastRoll[1]} = ${total}.`);
  move(game, player, total);
  resolveLanding(game, player);
  if (!game.debt && game.extraRoll && !player.jailed && !player.bankrupt && game.phase === "playing") {
    addHistory(game, `${game.message} Doubles! ${player.name} rolls again after resolving this space.`);
  }
}
export function leaveJail(game: StoredGame, token: string, method: "pay" | "card") {
  const player = activePlayer(game, token);
  if (!player.jailed || game.lastRoll.length) throw new GameError("Leave Jail before rolling, or finish this turn first.");
  if (method === "card") {
    if (!(player.jailCards ?? 0)) throw new GameError("You do not have a Get Out of Jail Free card.");
    player.jailCards = (player.jailCards ?? 0) - 1;
    const source = game.heldJailCards?.[player.id]?.shift();
    if (source) (game[source === "chance" ? "chanceDeck" : "chestDeck"] ??= []).push(source === "chance" ? 7 : 4);
    addHistory(game, `${player.name} uses a Get Out of Jail Free card.`);
  } else {
    pay(game, player, 50);
    if (game.debt) {
      game.debtContinuation = { playerId: player.id, steps: 0 };
      return;
    }
    addHistory(game, `${player.name} pays $50 and leaves Jail.`);
  }
  player.jailed = false;
  player.jailTurns = 0;
}
export function buy(game: StoredGame, token: string) {
  const player = activePlayer(game, token);
  const tile = game.board[player.position]!;
  if (!game.lastRoll.length || player.bankrupt || tile.price === null || tile.ownerPlayerId) {
    throw new GameError("There is no available property to buy here.");
  }
  if (player.cash < tile.price) throw new GameError("You do not have enough cash for this property.");
  player.cash -= tile.price;
  player.properties.push(tile.id);
  tile.ownerPlayerId = player.id;
  addHistory(game, `${player.name} bought ${tile.name} for $${tile.price}.`);
}
export function end(game: StoredGame, token: string) {
  const player = activePlayer(game, token);
  if (!game.lastRoll.length) throw new GameError("Roll the dice before ending your turn.");
  if (game.extraRoll && !player.jailed && !player.bankrupt) {
    game.extraRoll = false;
    game.lastRoll = [];
    addHistory(game, `Doubles! ${player.name} rolls again (${game.consecutiveDoubles} consecutive doubles).`);
    return;
  }
  advanceTurn(game);
}

function advanceTurn(game: StoredGame, now = Date.now()) {
  game.extraRoll = false;
  game.consecutiveDoubles = 0;
  const currentIndex = game.players.findIndex(p => p.id === game.currentPlayerId);
  const next = [...game.players.slice(currentIndex + 1), ...game.players.slice(0, currentIndex + 1)].find(p => !p.bankrupt)!;
  if (!next || game.phase !== "playing") return;
  game.currentPlayerId = next.id;
  game.turnNumber += 1;
  game.lastRoll = [];
  game.turnDeadline = now + TURN_DURATION_MS;
  addHistory(game, `${next.name}'s turn. Time to roll.`);
}

// Called under the room's PostgreSQL row lock, before any action or heartbeat.
export function reconcileLifecycle(game: StoredGame, now = Date.now()) {
  normalizeGame(game, now);
  if (game.phase === "lobby") {
    // Lobby seats are temporary; running-game seats are never reclaimed.
    for (const player of [...game.players]) {
      if (now - player.lastSeenAt! < LOBBY_SEAT_GRACE_MS) continue;
      game.players = game.players.filter(p => p.id !== player.id);
      for (const [token, id] of Object.entries(game.tokens)) if (id === player.id) delete game.tokens[token];
      addHistory(game, `${player.name}'s waiting-room seat was freed after five minutes away.`);
    }
    if (!game.players.length) { game.phase = "finished"; game.turnDeadline = null; return; }
    const host = game.players.find(p => p.isHost);
    const replacement = game.players.find(p => p.connected && p.id !== host?.id);
    if ((!host || !host.connected) && replacement) {
      for (const p of game.players) p.isHost = p.id === replacement.id;
      addHistory(game, `${replacement.name} is now host because the previous host is away.`);
    }
    return;
  }
  if (game.phase !== "playing") return;
  if (game.debt) return;
  const current = game.players.find(p => p.id === game.currentPlayerId);
  if (current?.bankrupt) {
    advanceTurn(game, now);
    return;
  }
  if (game.turnDeadline !== null && now >= game.turnDeadline!) {
    const explanation = game.lastRoll.length
      ? "Remaining purchases and extra rolls were passed; resolved payments remain."
      : "No dice were rolled and no money or properties changed.";
    addHistory(game, `${current?.name ?? "The player"}'s turn was skipped: the 90-second timer expired. ${explanation} Their seat is saved.`);
    // Give the next player a full turn, even after a server outage.
    advanceTurn(game, now);
  }
}

export function touchPresence(game: StoredGame, token: string | undefined, now = Date.now()) {
  const player = game.players.find(p => p.id === (token ? game.tokens[token] : undefined));
  if (!player || player.resigned) return;
  const wasAway = !player.connected;
  // Polling every second must not write every second.
  if (wasAway || now - (player.lastSeenAt ?? 0) >= 10_000) player.lastSeenAt = now;
  player.connected = true;
  if (wasAway) addHistory(game, `${player.name} reconnected. Their seat and assets are preserved.`);
  if (game.phase === "lobby" && !game.players.some(p => p.isHost && p.connected)) {
    for (const p of game.players) p.isHost = p.id === player.id;
    addHistory(game, `${player.name} is now the room host.`);
  }
}

export function resign(game: StoredGame, token: string) {
  if (game.debt) throw new GameError("Resolve the outstanding debt before leaving a seat.");
  const player = playerFor(game, token);
  if (player.resigned) return;
  if (game.phase === "finished") throw new GameError("This game has already finished.");
  if (game.phase === "lobby") {
    game.players = game.players.filter(p => p.id !== player.id);
    for (const [session, id] of Object.entries(game.tokens)) if (id === player.id) delete game.tokens[session];
    if (player.isHost && game.players.length) {
      const next = game.players.find(p => p.connected) ?? game.players[0]!;
      next.isHost = true;
      addHistory(game, `${player.name} left the table. ${next.name} is now host.`);
    } else addHistory(game, `${player.name} left the table.`);
    if (!game.players.length) game.phase = "finished";
    return;
  }
  if (player.bankrupt) throw new GameError("This player is already out of the game.");
  player.resigned = true;
  player.connected = false;
  player.bankrupt = true;
  player.cash = 0;
  player.properties = [];
  player.jailed = false;
  for (const tile of game.board.filter(s => s.ownerPlayerId === player.id)) {
    tile.ownerPlayerId = null;
    tile.buildingLevel = 0;
    tile.mortgaged = false;
  }
  for (const source of game.heldJailCards?.[player.id] ?? []) {
    (game[source === "chance" ? "chanceDeck" : "chestDeck"] ??= []).push(source === "chance" ? 7 : 4);
  }
  if (game.heldJailCards) delete game.heldJailCards[player.id];
  player.jailCards = 0;
  addHistory(game, `${player.name} resigned permanently. Their deeds and buildings return to the bank; cash is forfeited.`);
  checkWinner(game);
  if (game.phase === "playing" && game.currentPlayerId === player.id) advanceTurn(game);
  reconcileTrades(game);
}

export function manageProperty(game: StoredGame, input: PropertyManagementInput) {
  const player = game.debt ? playerFor(game, input.sessionToken) : activePlayer(game, input.sessionToken);
  if (game.debt && (game.debt.debtorPlayerId !== player.id || !["mortgage", "sell-building"].includes(input.action))) {
    throw new GameError("Only the debtor may sell buildings or mortgage properties during debt resolution.");
  }
  if (player.bankrupt) throw new GameError("Bankrupt players cannot manage property.");
  const tile = game.board.find(s => s.id === input.spaceId);
  if (!tile || tile.price === null || tile.ownerPlayerId !== player.id) throw new GameError("Choose a property you own.");
  const group = colorGroup(game, tile);
  if (input.action === "mortgage") {
    if (tile.mortgaged) throw new GameError("This property is already mortgaged.");
    if (group.some(s => s.buildingLevel > 0)) throw new GameError("Sell every building in this color group before mortgaging.");
    const advance = Math.floor(tile.price / 2);
    tile.mortgaged = true; player.cash += advance;
    addHistory(game, `${player.name} mortgaged ${tile.name} for $${advance}. No rent will be collected.`);
  } else if (input.action === "redeem") {
    if (!tile.mortgaged) throw new GameError("This property is not mortgaged.");
    const cost = Math.ceil(Math.floor(tile.price / 2) * 11 / 10);
    if (player.cash < cost) throw new GameError(`You need $${cost} to redeem this mortgage.`);
    tile.mortgaged = false; player.cash -= cost;
    addHistory(game, `${player.name} redeemed ${tile.name} for $${cost}.`);
  } else if (input.action === "build") {
    if (tile.type !== "property") throw new GameError("Stations and utilities cannot have buildings.");
    if (!group.every(s => s.ownerPlayerId === player.id)) throw new GameError("Own the complete color group before building.");
    if (group.some(s => s.mortgaged)) throw new GameError("Redeem every mortgage in this color group before building.");
    if (tile.buildingLevel >= 5) throw new GameError("This property already has a hotel.");
    if (tile.buildingLevel !== Math.min(...group.map(s => s.buildingLevel))) throw new GameError("Build evenly: choose a property with the fewest buildings.");
    if (tile.buildCost == null) throw new GameError("Building cost is unavailable for this property.");
    if (player.cash < tile.buildCost) throw new GameError(`You need $${tile.buildCost} to build here.`);
    player.cash -= tile.buildCost; tile.buildingLevel++;
    addHistory(game, `${player.name} built ${tile.buildingLevel === 5 ? "a hotel" : `house ${tile.buildingLevel}`} on ${tile.name} for $${tile.buildCost}.`);
  } else if (input.action === "sell-building") {
    if (tile.type !== "property" || tile.buildingLevel === 0) throw new GameError("There are no buildings to sell here.");
    if (tile.buildingLevel !== Math.max(...group.map(s => s.buildingLevel))) throw new GameError("Sell evenly: choose a property with the most buildings.");
    if (tile.buildCost == null) throw new GameError("Building cost is unavailable for this property.");
    tile.buildingLevel--;
    const refund = Math.floor(tile.buildCost / 2); player.cash += refund;
    addHistory(game, `${player.name} sold one building level on ${tile.name} for $${refund}${tile.buildingLevel === 4 ? "; the hotel returns to four houses" : ""}.`);
  } else throw new GameError("Unknown property action.");
}

function tradeAssets(game: StoredGame, ids: number[], ownerId: string): TradeProperty[] {
  if (ids.length > game.board.length || new Set(ids).size !== ids.length) throw new GameError("Choose each property only once.");
  return ids.map(id => {
    const tile = game.board.find(s => s.id === id);
    if (!tile || tile.price === null || tile.ownerPlayerId !== ownerId) throw new GameError("A traded property is no longer owned by the specified player.");
    if (colorGroup(game, tile).some(s => s.buildingLevel > 0)) throw new GameError("Sell all buildings in a color group before trading any of its properties.");
    return { spaceId: id, mortgaged: tile.mortgaged };
  });
}
function validateTrade(game: StoredGame, trade: GameTrade) {
  if (game.phase !== "playing") throw new GameError("The game is not in progress.");
  const proposer = game.players.find(p => p.id === trade.proposerPlayerId);
  const recipient = game.players.find(p => p.id === trade.recipientPlayerId);
  if (!proposer || !recipient || proposer.id === recipient.id || proposer.bankrupt || recipient.bankrupt) throw new GameError("Choose another live player for this trade.");
  for (const cash of [trade.offeredCash, trade.requestedCash]) {
    if (!Number.isSafeInteger(cash) || cash < 0 || cash > 1_000_000) throw new GameError("Trade cash must be whole dollars between $0 and $1,000,000.");
  }
  if (proposer.cash < trade.offeredCash || recipient.cash < trade.requestedCash) throw new GameError("Both players must be able to afford the cash they offer.");
  const offered = tradeAssets(game, trade.offeredProperties.map(p => p.spaceId), proposer.id);
  const requested = tradeAssets(game, trade.requestedProperties.map(p => p.spaceId), recipient.id);
  for (const [actual, snapshot] of [[offered, trade.offeredProperties], [requested, trade.requestedProperties]] as const) {
    if (actual.some((p, i) => p.mortgaged !== snapshot[i]!.mortgaged)) throw new GameError("A mortgage changed since this offer was made. Propose a new trade.");
  }
  return { proposer, recipient };
}
export function proposeTrade(game: StoredGame, input: TradeProposalInput) {
  const player = activePlayer(game, input.sessionToken);
  if (player.bankrupt) throw new GameError("Bankrupt players cannot trade.");
  if (game.trades.some(t => t.proposerPlayerId === player.id && t.status === "pending")) throw new GameError("Cancel your pending offer before proposing another.");
  if (input.offeredCash === 0 && input.requestedCash === 0 && !input.offeredPropertyIds.length && !input.requestedPropertyIds.length) throw new GameError("Offer or request at least one property or some cash.");
  const trade: GameTrade = {
    id: randomUUID(), proposerPlayerId: player.id, recipientPlayerId: input.recipientPlayerId,
    offeredCash: input.offeredCash, requestedCash: input.requestedCash,
    offeredProperties: tradeAssets(game, input.offeredPropertyIds, player.id),
    requestedProperties: tradeAssets(game, input.requestedPropertyIds, input.recipientPlayerId),
    status: "pending", createdTurn: game.turnNumber,
  };
  const { recipient } = validateTrade(game, trade);
  game.trades.unshift(trade);
  addHistory(game, `${player.name} proposed a trade to ${recipient.name}. Nothing transfers until accepted.`);
}
export function respondTrade(game: StoredGame, input: TradeResponseInput) {
  const player = livePlayer(game, input.sessionToken);
  const trade = game.trades.find(t => t.id === input.tradeId);
  if (!trade) throw new GameError("This trade does not exist.", 404);
  if (trade.status !== "pending") throw new GameError(`This offer is already ${trade.status}.`);
  if (input.action === "cancel") {
    if (trade.proposerPlayerId !== player.id) throw new GameError("Only the proposer can cancel this offer.", 403);
    trade.status = "cancelled";
  } else if (input.action === "reject" || input.action === "accept") {
    if (trade.recipientPlayerId !== player.id) throw new GameError("Only the recipient can respond to this offer.", 403);
    if (input.action === "reject") trade.status = "rejected";
    else {
      const { proposer, recipient } = validateTrade(game, trade);
      proposer.cash += trade.requestedCash - trade.offeredCash;
      recipient.cash += trade.offeredCash - trade.requestedCash;
      for (const [assets, nextOwner] of [[trade.offeredProperties, recipient], [trade.requestedProperties, proposer]] as const) {
        for (const asset of assets) game.board.find(s => s.id === asset.spaceId)!.ownerPlayerId = nextOwner.id;
      }
      for (const p of [proposer, recipient]) p.properties = game.board.filter(s => s.ownerPlayerId === p.id).map(s => s.id);
      trade.status = "accepted";
    }
  } else throw new GameError("Unknown trade response.");
  addHistory(game, `${player.name} ${trade.status} the trade offer.`);
}
export function reconcileTrades(game: StoredGame) {
  for (const trade of game.trades.filter(t => t.status === "pending")) {
    try { validateTrade(game, trade); }
    catch (error) {
      if (!(error instanceof GameError)) throw error;
      trade.status = "invalidated";
      addHistory(game, `A trade offer was invalidated: ${error.message}`);
    }
  }
  let resolved = 0;
  game.trades = game.trades.filter(t => t.status === "pending" || ++resolved <= 30);
}