// The immutable 28-space layout used by pre-classic saved rooms, for
// compatibility regression fixtures. New rooms continue to use classicBoard.
import type { GameSpace } from "@workspace/api-zod";
export function legacyBoardFixture(): GameSpace[] {
  const costs: Record<string, number> = { Copper: 50, Coral: 100, Garden: 100, Violet: 150, Sapphire: 150, Rose: 200, Gold: 200 };
  const p = (name: string, price: number, rent: number, group: string): Omit<GameSpace, "id"> => ({
    name, price, rent, group, type: "property", color: "#bb8860", description: name,
    ownerPlayerId: null, buildingLevel: 0, mortgaged: false, buildCost: costs[group]!, currentRent: rent,
  });
  const s = (name: string, type: GameSpace["type"]): Omit<GameSpace, "id"> => ({
    name, type, price: null, rent: null, group: null, color: "#e4e7df", description: name,
    ownerPlayerId: null, buildingLevel: 0, mortgaged: false, buildCost: null, currentRent: null,
  });
  const rail = (name: string): Omit<GameSpace, "id"> => ({
    name, type: "transit", price: 200, rent: 25, group: "Stations", color: "#64748b", description: name,
    ownerPlayerId: null, buildingLevel: 0, mortgaged: false, buildCost: null, currentRent: 25,
  });
  return [
    s("START", "start"), p("Copper Lane", 60, 12, "Copper"), s("Lucky Break", "chance"),
    p("Maple Row", 80, 16, "Copper"), rail("Tide Station"), p("Foundry Way", 120, 24, "Coral"),
    s("City Levy", "tax"), s("Detention", "jail"), p("Brickworks", 140, 28, "Coral"),
    p("Orchard Green", 160, 32, "Garden"), s("Lucky Break", "chance"),
    p("Botanical Ave", 180, 36, "Garden"), rail("Summit Station"), p("Lantern Hill", 200, 40, "Violet"),
    s("Free Parking", "rest"), p("Violet Terrace", 220, 44, "Violet"), p("Boardwalk", 240, 48, "Sapphire"),
    s("Lucky Break", "chance"), p("Marina Avenue", 260, 52, "Sapphire"), rail("Harbor Station"),
    p("Canal Quay", 280, 56, "Rose"), s("Go to Detention", "go-to-jail"), p("Market Square", 300, 60, "Rose"),
    p("Gold Coast", 320, 64, "Gold"), s("Luxury Tax", "tax"), p("Sunburst Drive", 350, 70, "Gold"),
    rail("Grand Station"), p("Crown Heights", 400, 80, "Sapphire"),
  ].map((tile, id) => ({ ...tile, id }));
}