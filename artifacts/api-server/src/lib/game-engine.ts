import { randomInt, randomUUID } from "node:crypto";
import type { GameView, GamePlayer, GameSpace } from "@workspace/api-zod";

export type StoredGame = Omit<GameView, "myPlayerId"> & { tokens: Record<string, string> };
export class GameError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const colors = ["#f97316", "#27b7b0", "#9b7cf4", "#e65b84", "#f0bb40", "#5482ee"];
const property = (name: string, price: number, rent: number, group: string, color: string): Omit<GameSpace, "id"> => ({
  name, type: "property", price, rent, group, color, ownerPlayerId: null,
  description: `Buy for $${price}. Base rent $${rent}; collect double rent when you own the complete color group.`,
});
const special = (name: string, type: GameSpace["type"], description: string): Omit<GameSpace, "id"> => ({
  name, type, description, price: null, rent: null, group: null, color: "#e4e7df", ownerPlayerId: null,
});
const transit = (name: string): Omit<GameSpace, "id"> => ({
  name, type: "transit", description: "Buy for $200. Rent starts at $25 and doubles with each station you own.",
  price: 200, rent: 25, group: "Stations", color: "#64748b", ownerPlayerId: null,
});

export function makeBoard(): GameSpace[] {
  return [
    special("START", "start", "Collect $200 each time you pass Start."),
    property("Copper Lane", 60, 12, "Copper", "#bb8860"),
    special("Lucky Break", "chance", "Draw a surprise city event."),
    property("Maple Row", 80, 16, "Copper", "#bb8860"),
    transit("Tide Station"),
    property("Foundry Way", 120, 24, "Coral", "#ea7964"),
    special("City Levy", "tax", "Pay $100 to the city."),
    special("Detention", "jail", "Just visiting. If sent here, pay $50 on your next roll to leave."),
    property("Brickworks", 140, 28, "Coral", "#ea7964"),
    property("Orchard Green", 160, 32, "Garden", "#82b984"),
    special("Lucky Break", "chance", "Draw a surprise city event."),
    property("Botanical Ave", 180, 36, "Garden", "#82b984"),
    transit("Summit Station"),
    property("Lantern Hill", 200, 40, "Violet", "#a084c6"),
    special("Free Parking", "rest", "Take a breather. No payment due."),
    property("Violet Terrace", 220, 44, "Violet", "#a084c6"),
    property("Boardwalk", 240, 48, "Sapphire", "#78adcf"),
    special("Lucky Break", "chance", "Draw a surprise city event."),
    property("Marina Avenue", 260, 52, "Sapphire", "#78adcf"),
    transit("Harbor Station"),
    property("Canal Quay", 280, 56, "Rose", "#d97d9a"),
    special("Go to Detention", "go-to-jail", "Go directly to Detention. Do not collect a Start bonus."),
    property("Market Square", 300, 60, "Rose", "#d97d9a"),
    property("Gold Coast", 320, 64, "Gold", "#e6c05b"),
    special("Luxury Tax", "tax", "Pay $150 to the city."),
    property("Sunburst Drive", 350, 70, "Gold", "#e6c05b"),
    transit("Grand Station"),
    property("Crown Heights", 400, 80, "Sapphire", "#78adcf"),
  ].map((space, id) => ({ ...space, id }));
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
  });
  game.tokens[token] = id;
  addHistory(game, `${cleanName(name)} joined the table.`);
  return token;
}
export function createRoom(code: string, name: string): { game: StoredGame; token: string } {
  const game: StoredGame = {
    code, phase: "lobby", players: [], board: makeBoard(), currentPlayerId: null,
    turnNumber: 1, lastRoll: [], message: "", history: [], winnerPlayerId: null,
    createdAt: Date.now(), tokens: {},
  };
  return { game, token: addPlayer(game, name) };
}
export function view(game: StoredGame, token?: string): GameView {
  const { tokens, ...publicGame } = game;
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
    addHistory(game, `${alive[0]!.name} wins Property Pursuit!`);
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
    addHistory(game, `${player.name} could not pay $${amount} and is bankrupt. ${creditor ? "Their properties transfer to " + creditor.name + "." : "Their properties return to the bank."}`);
    checkWinner(game);
  }
}
function move(game: StoredGame, player: GamePlayer, steps: number) {
  if (player.position + steps >= game.board.length) {
    player.cash += 200;
    addHistory(game, `${player.name} passed Start and collected $200.`);
  }
  player.position = (player.position + steps) % game.board.length;
}
function resolveLanding(game: StoredGame, player: GamePlayer) {
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
      } else {
        const group = game.board.filter(s => s.group === tile.group);
        if (group.length > 1 && group.every(s => s.ownerPlayerId === owner.id)) rent *= 2;
      }
      addHistory(game, `${player.name} pays ${owner.name} $${rent} rent for ${tile.name}.`);
      pay(game, player, rent, owner);
    }
  } else if (tile.type === "tax") {
    const amount = tile.id === 24 ? 150 : 100;
    addHistory(game, `${player.name} pays $${amount} ${tile.name.toLowerCase()}.`);
    pay(game, player, amount);
  } else if (tile.type === "go-to-jail") {
    player.position = 7;
    player.jailed = true;
    addHistory(game, `${player.name} was sent to Detention. Pay $50 on the next roll to leave.`);
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
      player.position = 7;
      player.jailed = true;
      addHistory(game, `Lucky Break: ${player.name} was sent to Detention.`);
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
  game.phase = "playing";
  game.currentPlayerId = game.players[0]!.id;
  addHistory(game, `The pursuit begins! ${game.players[0]!.name} rolls first.`);
}
export function roll(game: StoredGame, token: string) {
  const player = activePlayer(game, token);
  if (game.lastRoll.length) throw new GameError("You already rolled. Buy or end your turn.");
  if (player.bankrupt) throw new GameError("Your player is bankrupt.");
  game.lastRoll = [randomInt(1, 7), randomInt(1, 7)];
  if (player.jailed) {
    player.jailed = false;
    addHistory(game, `${player.name} pays $50 and leaves Detention.`);
    pay(game, player, 50);
    if (player.bankrupt) return;
  }
  const total = game.lastRoll[0]! + game.lastRoll[1]!;
  addHistory(game, `${player.name} rolled ${game.lastRoll[0]} + ${game.lastRoll[1]} = ${total}.`);
  move(game, player, total);
  resolveLanding(game, player);
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
  const currentIndex = game.players.findIndex(p => p.id === player.id);
  const next = [...game.players.slice(currentIndex + 1), ...game.players.slice(0, currentIndex + 1)].find(p => !p.bankrupt)!;
  game.currentPlayerId = next.id;
  game.turnNumber += 1;
  game.lastRoll = [];
  addHistory(game, `${next.name}'s turn. Time to roll.`);
}