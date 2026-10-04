import type { GameSpace } from "@workspace/api-zod";

type Tile = Omit<GameSpace, "id">;
const property = (name: string, price: number, rent: number, group: string, color: string): Tile => ({
  name, type: "property", price, rent, group, color, ownerPlayerId: null,
  description: `Price $${price}. Unimproved rent $${rent}; double with the complete color group.`,
});
const special = (name: string, type: GameSpace["type"], description: string): Tile => ({
  name, type, description, price: null, rent: null, group: null, color: "#dce5d9", ownerPlayerId: null,
});
const railroad = (name: string): Tile => ({
  name, type: "transit", price: 200, rent: 25, group: "Railroads", color: "#586474", ownerPlayerId: null,
  description: "Price $200. Rent is $25 / $50 / $100 / $200 when you own 1 / 2 / 3 / 4 railroads.",
});
const utility = (name: string): Tile => ({
  name, type: "utility", price: 150, rent: 4, group: "Utilities", color: "#c6c8bd", ownerPlayerId: null,
  description: "Price $150. Rent is 4 times the dice total, or 10 times when the owner holds both utilities.",
});
const chest = () => special("Community Chest", "community-chest", "Draw a Community Chest card.");
const chance = () => special("Chance", "chance", "Draw a Chance card.");

export function classicBoard(): GameSpace[] {
  return [
    special("GO", "start", "Collect $200 when you pass or land on GO."),
    property("Mediterranean Avenue", 60, 2, "Brown", "#955436"),
    chest(),
    property("Baltic Avenue", 60, 4, "Brown", "#955436"),
    special("Income Tax", "tax", "Pay $200."),
    railroad("Reading Railroad"),
    property("Oriental Avenue", 100, 6, "Light blue", "#96d6ed"),
    chance(),
    property("Vermont Avenue", 100, 6, "Light blue", "#96d6ed"),
    property("Connecticut Avenue", 120, 8, "Light blue", "#96d6ed"),
    special("Jail / Just Visiting", "jail", "Just visiting unless sent here. Roll doubles, pay $50, or use a Get Out of Jail Free card to leave."),
    property("St. Charles Place", 140, 10, "Pink", "#d85797"),
    utility("Electric Company"),
    property("States Avenue", 140, 10, "Pink", "#d85797"),
    property("Virginia Avenue", 160, 12, "Pink", "#d85797"),
    railroad("Pennsylvania Railroad"),
    property("St. James Place", 180, 14, "Orange", "#f39132"),
    chest(),
    property("Tennessee Avenue", 180, 14, "Orange", "#f39132"),
    property("New York Avenue", 200, 16, "Orange", "#f39132"),
    special("Free Parking", "rest", "A free resting space. No payout or payment."),
    property("Kentucky Avenue", 220, 18, "Red", "#df423c"),
    chance(),
    property("Indiana Avenue", 220, 18, "Red", "#df423c"),
    property("Illinois Avenue", 240, 20, "Red", "#df423c"),
    railroad("B. & O. Railroad"),
    property("Atlantic Avenue", 260, 22, "Yellow", "#f1d242"),
    property("Ventnor Avenue", 260, 22, "Yellow", "#f1d242"),
    utility("Water Works"),
    property("Marvin Gardens", 280, 24, "Yellow", "#f1d242"),
    special("Go To Jail", "go-to-jail", "Go directly to Jail. Do not pass GO or collect $200."),
    property("Pacific Avenue", 300, 26, "Green", "#42a967"),
    property("North Carolina Avenue", 300, 26, "Green", "#42a967"),
    chest(),
    property("Pennsylvania Avenue", 320, 28, "Green", "#42a967"),
    railroad("Short Line"),
    chance(),
    property("Park Place", 350, 35, "Dark blue", "#386bb2"),
    special("Luxury Tax", "tax", "Pay $100."),
    property("Boardwalk", 400, 50, "Dark blue", "#386bb2"),
  ].map((tile, id) => ({ ...tile, id }));
}

export type ClassicCard = {
  text: string; money?: number; moveTo?: number; jail?: boolean; jailCard?: boolean;
  nearest?: "transit" | "utility"; back?: number; perPlayer?: number;
  repairs?: { house: number; hotel: number };
};
export const chanceCards: ClassicCard[] = [
  { text: "Advance to GO. Collect $200.", moveTo: 0 },
  { text: "Advance to Illinois Avenue.", moveTo: 24 },
  { text: "Advance to St. Charles Place.", moveTo: 11 },
  { text: "Advance to the nearest utility. If owned, pay 10 times a fresh dice roll.", nearest: "utility" },
  { text: "Advance to the nearest railroad. If owned, pay twice the usual rent.", nearest: "transit" },
  { text: "Advance to the nearest railroad. If owned, pay twice the usual rent.", nearest: "transit" },
  { text: "The bank pays you a dividend of $50.", money: 50 },
  { text: "Get Out of Jail Free. Keep this card until needed.", jailCard: true },
  { text: "Go back three spaces.", back: 3 },
  { text: "Go directly to Jail.", jail: true },
  { text: "General repairs: pay $25 per house and $100 per hotel.", repairs: { house: 25, hotel: 100 } },
  { text: "Speeding fine: pay $15.", money: -15 },
  { text: "Take a trip to Reading Railroad.", moveTo: 5 },
  { text: "Advance to Boardwalk.", moveTo: 39 },
  { text: "Elected chairman: pay each other player $50.", perPlayer: -50 },
  { text: "Your building loan matures. Collect $150.", money: 150 },
];
export const chestCards: ClassicCard[] = [
  { text: "Advance to GO. Collect $200.", moveTo: 0 },
  { text: "Bank error in your favor. Collect $200.", money: 200 },
  { text: "Doctor's fee: pay $50.", money: -50 },
  { text: "Sale of stock. Collect $50.", money: 50 },
  { text: "Get Out of Jail Free. Keep this card until needed.", jailCard: true },
  { text: "Go directly to Jail.", jail: true },
  { text: "Holiday fund matures. Collect $100.", money: 100 },
  { text: "Income tax refund. Collect $20.", money: 20 },
  { text: "It's your birthday. Collect $10 from each other player.", perPlayer: 10 },
  { text: "Life insurance matures. Collect $100.", money: 100 },
  { text: "Hospital fees: pay $100.", money: -100 },
  { text: "School fees: pay $50.", money: -50 },
  { text: "Consultancy fee. Collect $25.", money: 25 },
  { text: "Street repairs: pay $40 per house and $115 per hotel.", repairs: { house: 40, hotel: 115 } },
  { text: "Beauty contest prize. Collect $10.", money: 10 },
  { text: "You inherit $100.", money: 100 },
];