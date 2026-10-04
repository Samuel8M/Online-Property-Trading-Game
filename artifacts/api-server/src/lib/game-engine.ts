import { randomInt, randomUUID } from "node:crypto";
import type { GameView, GamePlayer, GameSpace } from "@workspace/api-zod";
import { classicBoard, chanceCards, chestCards, type ClassicCard } from "./classic-board";

export type StoredGame = Omit<GameView, "myPlayerId"> & {
  tokens: Record<string, string>;
  chanceDeck?: number[];
  chestDeck?: number[];
  heldJailCards?: Record<string, ("chance" | "chest")[]>;
};
export class GameError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const colors = ["#f97316", "#27b7b0", "#9b7cf4", "#e65b84", "#f0bb40", "#5482ee"];
export function makeBoard(): GameSpace[] {
  return classicBoard();
}

export function addHistory(game: StoredGame, text: string) {
  game.message = text;
  game.history = [text, ...game.history].slice(0, 60);
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
    id, name: cleanName(name), color: colors[game.players.length]!, cash: 1500,
    position: 0, jailed: false, bankrupt: false, properties: [], isHost: game.players.length === 0,
    jailTurns: 0, jailCards: 0,
  });
  game.tokens[token] = id;
  addHistory(game, `${cleanName(name)} joined the table.`);
  return token;
}
export function createRoom(code: string, name: string): { game: StoredGame; token: string } {
  const game: StoredGame = {
    code, phase: "lobby", players: [], board: makeBoard(), currentPlayerId: null,
    turnNumber: 1, lastRoll: [], message: "", history: [], winnerPlayerId: null,
    createdAt: Date.now(), tokens: {}, consecutiveDoubles: 0, extraRoll: false, rollSerial: 0,
    chanceDeck: shuffledDeck(), chestDeck: shuffledDeck(), heldJailCards: {},
  };
  return { game, token: addPlayer(game, name) };
}
export function view(game: StoredGame, token?: string): GameView {
  const { tokens, chanceDeck, chestDeck, heldJailCards, ...publicGame } = game;
  return { ...publicGame, myPlayerId: token ? tokens[token] ?? null : null };
}
function playerFor(game: StoredGame, token: string): GamePlayer {
  const player = game.players.find(p => p.id === game.tokens[token]);
  if (!player) throw new GameError("Your player session is not valid. Rejoin this room.", 403);
  return player;
}
function activePlayer(game: StoredGame, token: string): GamePlayer {
  const player = playerFor(game, token);
  if (game.phase !== "playing") throw new GameError("The game is not in progress.");
  if (game.currentPlayerId !== player.id) throw new GameError("Wait for your turn.");
  return player;
}
function checkWinner(game: StoredGame) {
  const alive = game.players.filter(p => !p.bankrupt);
  if (alive.length === 1) {
    game.phase = "finished";
    game.winnerPlayerId = alive[0]!.id;
    addHistory(game, `${alive[0]!.name} wins Monopoly!`);
  }
}
function pay(game: StoredGame, player: GamePlayer, amount: number, creditor?: GamePlayer) {
  const payment = Math.min(player.cash, amount);
  player.cash -= payment;
  if (creditor) creditor.cash += payment;
  if (payment < amount) {
    player.bankrupt = true;
    for (const tile of game.board.filter(s => s.ownerPlayerId === player.id)) {
      tile.ownerPlayerId = creditor?.id ?? null;
      if (creditor) creditor.properties.push(tile.id);
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
    addHistory(game, `${player.name} could not pay $${amount} and is bankrupt. ${creditor ? "Their properties transfer to " + creditor.name + "." : "Their properties return to the bank."}`);
    checkWinner(game);
  }
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
      let rent = tile.rent!;
      if (tile.type === "transit") {
        rent = 25 * 2 ** (game.board.filter(s => s.type === "transit" && s.ownerPlayerId === owner.id).length - 1);
      } else if (tile.type === "utility") {
        const both = game.board.filter(s => s.type === "utility" && s.ownerPlayerId === owner.id).length === 2;
        const diceTotal = utilityCard ? randomInt(1, 7) + randomInt(1, 7) : game.lastRoll.reduce((a, b) => a + b, 0);
        rent = diceTotal * (both || utilityCard ? 10 : 4);
        if (utilityCard) addHistory(game, `${player.name} rolls a utility total of ${diceTotal}.`);
      } else {
        const group = game.board.filter(s => s.group === tile.group);
        if (group.length > 1 && group.every(s => s.ownerPlayerId === owner.id)) rent *= 2;
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
      if (player.bankrupt) return;
      player.jailed = false;
      player.jailTurns = 0;
    }
  } else {
    game.consecutiveDoubles = doubles ? (game.consecutiveDoubles ?? 0) + 1 : 0;
    if (game.consecutiveDoubles === 3) {
      addHistory(game, `${player.name} rolled three consecutive doubles.`);
      sendToJail(game, player);
      return;
    }
    game.extraRoll = doubles;
  }
  const total = game.lastRoll[0]! + game.lastRoll[1]!;
  addHistory(game, `${player.name} rolled ${game.lastRoll[0]} + ${game.lastRoll[1]} = ${total}.`);
  move(game, player, total);
  resolveLanding(game, player);
  if (game.extraRoll && !player.jailed && !player.bankrupt && game.phase === "playing") {
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
    if (player.cash < 50) throw new GameError("You need $50 to pay the Jail fine.");
    player.cash -= 50;
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
  game.extraRoll = false;
  game.consecutiveDoubles = 0;
  const currentIndex = game.players.findIndex(p => p.id === player.id);
  const next = [...game.players.slice(currentIndex + 1), ...game.players.slice(0, currentIndex + 1)].find(p => !p.bankrupt)!;
  game.currentPlayerId = next.id;
  game.turnNumber += 1;
  game.lastRoll = [];
  addHistory(game, `${next.name}'s turn. Time to roll.`);
}