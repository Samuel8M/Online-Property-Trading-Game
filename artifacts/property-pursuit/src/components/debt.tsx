import { useState } from 'react';
import { useResolveDebt, type GameView } from '@workspace/api-client-react';
import { errMsg, money } from '@/lib/session';
import { LiquidationSummary } from './liquidation';

export function DebtPanel({ game, code, token, disabled, onGame, onError }: {
  game: GameView; code: string; token: string; disabled: boolean;
  onGame: (game: GameView) => void; onError: (message: string) => void;
}) {
  const mutation = useResolveDebt();
  const [confirmId, setConfirmId] = useState('');
  const debt = game.debt;
  if (!debt) return null;
  const debtor = game.players.find(p => p.id === debt.debtorPlayerId)!;
  const creditor = game.players.find(p => p.id === debt.creditorPlayerId);
  const mine = debtor.id === game.myPlayerId;
  const shortfall = Math.max(0, debt.amount - debtor.cash);
  const run = (action: 'settle' | 'bankrupt') => mutation.mutate({
    code, data: { sessionToken: token, debtId: debt.id, action },
  }, {
    onSuccess: g => { setConfirmId(''); onGame(g); },
    onError: e => onError(errMsg(e)),
  });
  return <section className="space-y-3 rounded-xl border-2 border-primary p-3" data-testid="panel-debt" role="status">
    <h3 className="display text-xl font-black">{mine ? 'Resolve your debt' : `${debtor.name} is raising cash`}</h3>
    <p><b>{money(debt.amount)}</b> owed to <b>{creditor?.name ?? 'the bank'}</b>.</p>
    <p className="text-sm">Cash: {money(debtor.cash)} · Still needed: {money(shortfall)}. No partial payment has been taken.</p>
    <LiquidationSummary game={game} player={debtor} />
    <p className="text-xs text-muted-foreground">Turn timer paused. Rolling, buying, trading, and ending the turn are blocked until this debt is resolved.</p>
    {mine && <>
      <p className="text-sm">Use Your properties below to sell buildings or mortgage deeds, then pay the full debt.</p>
      <button className="btn btn-primary w-full" disabled={disabled || mutation.isPending || shortfall > 0} onClick={() => run('settle')} data-testid="button-settle-debt">
        {mutation.isPending ? 'Resolving…' : `Pay ${money(debt.amount)}`}
      </button>
      {confirmId !== debt.id ? <button className="btn w-full" disabled={disabled || mutation.isPending} onClick={() => setConfirmId(debt.id)} data-testid="button-bankruptcy">Declare bankruptcy…</button> :
        <div className="space-y-2">
          <p className="text-sm font-bold">Bankruptcy is permanent. Your remaining cash and deeds go to {creditor?.name ?? 'the bank'}, and you are out of the game.</p>
          <button className="btn w-full" disabled={disabled || mutation.isPending} onClick={() => run('bankrupt')} data-testid="button-confirm-bankruptcy">Confirm bankruptcy</button>
          <button className="btn w-full" disabled={mutation.isPending} onClick={() => setConfirmId('')}>Keep raising cash</button>
        </div>}
    </>}
  </section>;
}