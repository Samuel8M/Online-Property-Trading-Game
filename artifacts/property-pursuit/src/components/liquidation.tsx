import type { GamePlayer, GameView } from '@workspace/api-client-react';
import { estimateLiquidation } from '@workspace/game-rules';
import { money } from '@/lib/session';

export function LiquidationSummary({ game, player }: { game: GameView; player: GamePlayer }) {
  const estimate = estimateLiquidation(game.board, player);
  const debt = game.debt?.debtorPlayerId === player.id ? game.debt : null;
  const shortfall = debt ? Math.max(0, debt.amount - estimate.total) : 0;
  return <div className="space-y-1 rounded-lg bg-muted p-3 text-sm">
    <p className="font-bold">Liquidation estimate: {money(estimate.total)}</p>
    <p>Cash {money(estimate.cash)} + building sales {money(estimate.buildingSales)} + mortgages {money(estimate.mortgages)}.</p>
    {debt && <p className="font-bold">
      {shortfall > 0
        ? `Still ${money(shortfall)} short of the saved ${money(debt.amount)} debt after all legal sales and mortgages.`
        : `Enough to cover the saved ${money(debt.amount)} debt${estimate.total > debt.amount ? `, with ${money(estimate.total - debt.amount)} left` : ' exactly'}.`}
    </p>}
    <p className="text-xs text-muted-foreground">Includes sequential even sales (hotel to four houses, then down to zero) and mortgages unlocked after buildings are sold. Already mortgaged deeds add no cash. Estimate only: nothing is sold, mortgaged, paid, or declared bankrupt automatically.</p>
  </div>;
}