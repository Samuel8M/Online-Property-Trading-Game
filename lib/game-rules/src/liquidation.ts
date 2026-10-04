/** Structural inputs work with both public views and restored server games. */
type Deed = {
  id: number;
  type: string;
  group: string | null;
  ownerPlayerId: string | null;
  price: number | null;
  buildingLevel: number;
  buildCost: number | null;
  mortgaged: boolean;
};

/**
 * Cash obtainable by explicit legal sales followed by mortgages.
 * Simulate highest-level sales rather than assuming every building is sellable:
 * a higher-level deed belonging to someone else can block an inherited group.
 * No input state is changed and no payment/bankruptcy decision is made.
 */
export function estimateLiquidation(
  board: readonly Deed[],
  player: { id: string; cash: number },
) {
  const simulated = board.map(deed => ({ ...deed }));
  const groupOf = (deed: Deed) => deed.type === "property" && deed.group
    ? simulated.filter(other => other.type === "property" && other.group === deed.group)
    : [deed];
  const owned = simulated.filter(deed => deed.ownerPlayerId === player.id && deed.price !== null);
  let buildingSales = 0;
  let sold: boolean;
  do {
    sold = false;
    for (const deed of owned) {
      if (deed.type !== "property" || deed.buildingLevel <= 0 || deed.buildCost === null) continue;
      if (deed.buildingLevel !== Math.max(...groupOf(deed).map(other => other.buildingLevel))) continue;
      // A hotel is five refundable levels, starting with hotel -> four houses.
      deed.buildingLevel--;
      buildingSales += Math.floor(deed.buildCost / 2);
      sold = true;
    }
  } while (sold);
  const mortgages = owned.reduce((sum, deed) =>
    sum + (!deed.mortgaged && groupOf(deed).every(other => other.buildingLevel === 0)
      ? Math.floor(deed.price! / 2) : 0), 0);
  return { cash: player.cash, buildingSales, mortgages, total: player.cash + buildingSales + mortgages };
}