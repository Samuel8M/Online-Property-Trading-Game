import { useMemo, useState } from 'react';
import { useManageProperty, useProposeTrade, useRespondTrade } from '@workspace/api-client-react';
import type { GameSpace, GameTrade, GameView } from '@workspace/api-client-react';
import { errMsg, money } from '@/lib/session';
import { LiquidationSummary } from './liquidation';

type Common = { game: GameView; code: string; token: string; onGame: (g: GameView) => void; onErr: (m: string) => void };

export const redeemCost = (s: GameSpace) => Math.ceil(Math.floor((s.price ?? 0) / 2) * 11 / 10);
const groupOf = (g: GameView, s: GameSpace) => (s.group && s.type === 'property' ? g.board.filter((x) => x.group === s.group && x.type === 'property') : [s]);
const groupBuilt = (g: GameView, s: GameSpace) => groupOf(g, s).some((x) => x.buildingLevel > 0);
const lvlName = (n: number) => (n === 0 ? 'No buildings' : n === 5 ? 'Hotel' : `${n} house${n > 1 ? 's' : ''}`);

export function ManagePanel({ game, code, token, onGame, onErr }: Common) {
  const m = useManageProperty();
  const [pending, setPending] = useState('');
  const me = game.players.find((p) => p.id === game.myPlayerId);
  const inDebt = !!game.debt;
  if (!me || me.bankrupt || game.phase !== 'playing' || (inDebt ? game.debt?.debtorPlayerId !== me.id : game.currentPlayerId !== me.id)) return null;
  const owned = me.properties.map((id) => game.board[id]).filter(Boolean);
  const run = (s: GameSpace, action: 'build' | 'sell-building' | 'mortgage' | 'redeem') => {
    setPending(`${s.id}:${action}`);
    m.mutate({ code, data: { sessionToken: token, spaceId: s.id, action } }, {
      onSuccess: (g) => { onGame(g); setPending(''); },
      onError: (e) => { onErr(errMsg(e)); setPending(''); },
    });
  };
  return (
    <section className="panel p-5" data-testid="panel-manage">
      <h2 className="display mb-1 text-xl font-black">Your properties</h2>
      <p className="mb-3 text-xs text-muted-foreground">{inDebt ? 'Raise cash for your debt: sell evenly for half cost, or mortgage undeveloped deeds for half price.' : 'Build evenly, sell for half, mortgage for half price. Available before or after your roll.'}</p>
      <div className="mb-3"><LiquidationSummary game={game} player={me} /></div>
      {owned.length === 0 && <p className="text-sm text-muted-foreground">You own nothing yet. Buy a space to begin.</p>}
      <ul className="space-y-2">
        {owned.map((s) => {
          const grp = groupOf(game, s);
          const colored = s.type === 'property' && !!s.group;
          const full = colored && grp.every((x) => x.ownerPlayerId === me.id);
          const noMort = grp.every((x) => !x.mortgaged);
          const lv = grp.map((x) => x.buildingLevel);
          const cost = s.buildCost ?? 0;
          const canBuild = full && noMort && !s.mortgaged && s.buildCost != null && s.buildingLevel < 5 && s.buildingLevel === Math.min(...lv) && me.cash >= cost;
          const canSell = colored && s.buildCost != null && s.buildingLevel > 0 && s.buildingLevel === Math.max(...lv);
          const canMort = !s.mortgaged && !groupBuilt(game, s);
          const canRedeem = s.mortgaged && me.cash >= redeemCost(s);
          const b = (label: string, action: 'build' | 'sell-building' | 'mortgage' | 'redeem', ok: boolean, why: string) => (
            <button className="btn !px-2 !py-1 text-xs" disabled={!ok || m.isPending} title={ok ? undefined : why}
              onClick={() => run(s, action)} data-testid={`button-${action}-${s.id}`}>{pending === `${s.id}:${action}` ? '...' : label}</button>
          );
          return (
            <li key={s.id} className="rounded-xl border-2 border-border p-2" data-testid={`row-manage-${s.id}`}>
              <div className="flex items-center gap-2">
                <span className="h-4 w-6 shrink-0 rounded-sm border border-ink" style={{ background: s.color }} />
                <b className="truncate text-sm">{s.name}</b>
                <span className="ml-auto font-mono text-xs">{s.mortgaged ? 'Mortgaged' : s.type === 'utility' ? '4× / 10× dice' : `Rent ${money(s.currentRent)}`}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {colored ? lvlName(s.buildingLevel) : s.type === 'utility' ? 'Utility' : 'Railroad'}
                {s.buildCost != null ? ` · ${money(s.buildCost)} per level` : ''}
                {s.mortgaged ? ` · Redeem ${money(redeemCost(s))}` : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {colored && !inDebt && b(`Build ${money(cost)}`, 'build', canBuild, 'Needs the full unmortgaged group, the lowest level, and enough cash')}
                {colored && b(`Sell +${money(Math.floor(cost / 2))}`, 'sell-building', canSell, 'Sell from the highest level in the group')}
                {!s.mortgaged && b(`Mortgage +${money(Math.floor((s.price ?? 0) / 2))}`, 'mortgage', canMort, 'Sell every building in the group first')}
                {s.mortgaged && !inDebt && b(`Redeem ${money(redeemCost(s))}`, 'redeem', canRedeem, 'Not enough cash')}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const wholeOk = (v: string) => /^\d{0,7}$/.test(v) && Number(v || 0) <= 1000000;

export function TradePanel({ game, code, token, onGame, onErr, myTurn }: Common & { myTurn: boolean }) {
  const propose = useProposeTrade();
  const respond = useRespondTrade();
  const [to, setTo] = useState('');
  const [offC, setOffC] = useState('0');
  const [reqC, setReqC] = useState('0');
  const [offP, setOffP] = useState<number[]>([]);
  const [reqP, setReqP] = useState<number[]>([]);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState('');

  const me = game.players.find((p) => p.id === game.myPlayerId);
  const live = game.players.filter((p) => !p.bankrupt);
  const targets = live.filter((p) => p.id !== me?.id);
  const target = targets.find((p) => p.id === to);
  const tradable = (pid?: string) => (game.players.find((p) => p.id === pid)?.properties ?? []).map((i) => game.board[i]).filter((s) => s && !groupBuilt(game, s));
  const myOpts = useMemo(() => tradable(me?.id), [game, me?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const theirOpts = useMemo(() => tradable(target?.id), [game, target?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const offIds = offP.filter((i) => myOpts.some((s) => s.id === i));
  const reqIds = reqP.filter((i) => theirOpts.some((s) => s.id === i));
  const hasOutgoing = game.trades.some((t) => t.status === 'pending' && t.proposerPlayerId === me?.id);

  if (game.phase === 'lobby' && !game.trades.length) return null;
  const canAct = !!me && !me.bankrupt && game.phase === 'playing' && !game.debt;
  const canPropose = canAct && myTurn;
  const nm = (id: string) => game.players.find((p) => p.id === id)?.name ?? 'Player';
  const toggle = (set: (f: (a: number[]) => number[]) => void, id: number) => set((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  const oc = Number(offC || 0), rc = Number(reqC || 0);
  let problem = '';
  if (!target) problem = 'Choose a player.';
  else if (!wholeOk(offC) || !wholeOk(reqC)) problem = 'Cash must be whole dollars, zero or more.';
  else if (!me) problem = 'Only seated players may trade.';
  else if (offIds.length !== offP.length || reqIds.length !== reqP.length) problem = 'A selected property is no longer tradable. Close this form and start a new offer.';
  else if (oc > me.cash) problem = `You only have ${money(me.cash)}.`;
  else if (rc > target.cash) problem = `${target.name} only has ${money(target.cash)}.`;
  else if (oc + rc + offIds.length + reqIds.length === 0 || (oc + offIds.length === 0 && rc + reqIds.length === 0)) problem = 'Offer or ask for something.';

  const reset = () => { setTo(''); setOffC('0'); setReqC('0'); setOffP([]); setReqP([]); setOpen(false); };
  const send = () => {
    if (problem || !target) return;
    propose.mutate({ code, data: { sessionToken: token, recipientPlayerId: target.id, offeredCash: oc, requestedCash: rc, offeredPropertyIds: offIds, requestedPropertyIds: reqIds } }, {
      onSuccess: (g) => { onGame(g); reset(); },
      onError: (e) => onErr(errMsg(e)),
    });
  };
  const answer = (t: GameTrade, action: 'accept' | 'reject' | 'cancel') => {
    setBusyId(t.id + action);
    respond.mutate({ code, data: { sessionToken: token, tradeId: t.id, action } }, {
      onSuccess: (g) => { onGame(g); setBusyId(''); },
      onError: (e) => { onErr(errMsg(e)); setBusyId(''); },
    });
  };

  const side = (cash: number, props: { spaceId: number; mortgaged: boolean }[]) => (
    <ul className="space-y-0.5 text-xs">
      {cash > 0 && <li className="font-mono font-bold">{money(cash)}</li>}
      {props.map((p) => {
        const s = game.board[p.spaceId];
        return <li key={p.spaceId} className="flex items-center gap-1"><span className="h-3 w-4 rounded-sm border border-ink" style={{ background: s?.color }} />{s?.name}{p.mortgaged ? ` (mortgaged, redeem ${money(s ? redeemCost(s) : 0)})` : ''}</li>;
      })}
      {cash === 0 && props.length === 0 && <li className="text-muted-foreground">Nothing</li>}
    </ul>
  );

  const pendings = game.trades.filter((t) => t.status === 'pending');
  const resolved = game.trades.filter((t) => t.status !== 'pending').slice(0, 8);
  const row = (t: GameTrade) => {
    const mine = t.proposerPlayerId === me?.id, forMe = t.recipientPlayerId === me?.id;
    return (
      <li key={t.id} className={`rounded-xl border-2 p-2 ${t.status === 'pending' ? 'border-ink bg-accent/30' : 'border-border opacity-80'}`} data-testid={`row-trade-${t.id}`}>
        <div className="mb-1 flex items-center justify-between text-xs">
          <b>{nm(t.proposerPlayerId)} to {nm(t.recipientPlayerId)}</b>
          <span className="font-mono font-bold uppercase" data-testid={`status-trade-${t.id}`}>{t.status}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><p className="text-[10px] font-bold uppercase text-muted-foreground">{nm(t.proposerPlayerId)} gives</p>{side(t.offeredCash, t.offeredProperties)}</div>
          <div><p className="text-[10px] font-bold uppercase text-muted-foreground">{nm(t.recipientPlayerId)} gives</p>{side(t.requestedCash, t.requestedProperties)}</div>
        </div>
        {canAct && t.status === 'pending' && (forMe || mine) && (
          <div className="mt-2 flex gap-2">
            {forMe && <button className="btn btn-gold !py-1 text-xs" disabled={respond.isPending} onClick={() => answer(t, 'accept')} data-testid={`button-accept-${t.id}`}>{busyId === t.id + 'accept' ? '...' : 'Accept'}</button>}
            {forMe && <button className="btn !py-1 text-xs" disabled={respond.isPending} onClick={() => answer(t, 'reject')} data-testid={`button-reject-${t.id}`}>Reject</button>}
            {mine && <button className="btn !py-1 text-xs" disabled={respond.isPending} onClick={() => answer(t, 'cancel')} data-testid={`button-cancel-${t.id}`}>Cancel offer</button>}
          </div>
        )}
      </li>
    );
  };

  const picker = (opts: GameSpace[], sel: number[], set: (f: (a: number[]) => number[]) => void, label: string) => (
    <div>
      <p className="mb-1 text-xs font-bold">{label}</p>
      <div className="flex flex-wrap gap-1">
        {opts.length === 0 && <span className="text-xs text-muted-foreground">No tradable properties</span>}
        {opts.map((s) => (
          <button key={s.id} type="button" aria-pressed={sel.includes(s.id)} onClick={() => toggle(set, s.id)} data-testid={`pick-${label === 'You give properties' ? 'give' : 'get'}-${s.id}`}
            className={`flex items-center gap-1 rounded-md border-2 px-1.5 py-0.5 text-xs ${sel.includes(s.id) ? 'border-ink bg-accent' : 'border-border'}`}>
            <span className="h-3 w-3 rounded-sm border border-ink" style={{ background: s.color }} />{s.name}{s.mortgaged ? ' (M)' : ''}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <section className="panel p-5" data-testid="panel-trades">
      <h2 className="display mb-2 text-xl font-black">Trades</h2>
      {game.debt && <p className="mb-3 text-sm text-muted-foreground">Trades are paused until the debt is resolved.</p>}
      {canPropose && !open && (
        <button className="btn btn-primary mb-3 w-full" disabled={hasOutgoing || targets.length === 0} onClick={() => setOpen(true)} data-testid="button-new-trade">
          {hasOutgoing ? 'Offer pending' : 'Propose a trade'}
        </button>
      )}
      {canPropose && open && !hasOutgoing && (
        <div className="mb-3 space-y-3 rounded-xl border-2 border-ink p-3" data-testid="form-trade">
          <select className="field" value={target ? to : ''} onChange={(e) => { setTo(e.target.value); setReqP([]); setReqC('0'); }} data-testid="select-trade-target">
            <option value="">Trade with...</option>
            {targets.map((p) => <option key={p.id} value={p.id}>{p.name} ({money(p.cash)})</option>)}
          </select>
          <label className="block text-xs font-bold">You give (max {money(me?.cash)})
            <input className="field mt-1" inputMode="numeric" value={offC} onChange={(e) => setOffC(e.target.value)} data-testid="input-offered-cash" /></label>
          {picker(myOpts, offIds, setOffP, 'You give properties')}
          {target && <>
            <label className="block text-xs font-bold">You ask (max {money(target.cash)})
              <input className="field mt-1" inputMode="numeric" value={reqC} onChange={(e) => setReqC(e.target.value)} data-testid="input-requested-cash" /></label>
            {picker(theirOpts, reqIds, setReqP, `You get from ${target.name}`)}
          </>}
          <p className="text-[11px] text-muted-foreground">Properties in a group with buildings cannot be traded. Mortgaged properties keep their mortgage; the new owner owes redemption.</p>
          {problem && <p className="text-xs font-bold text-primary" data-testid="text-trade-problem">{problem}</p>}
          <div className="flex gap-2">
            <button className="btn btn-primary flex-1" disabled={!!problem || propose.isPending} onClick={send} data-testid="button-send-trade">{propose.isPending ? 'Sending...' : 'Send offer'}</button>
            <button className="btn" onClick={reset} data-testid="button-close-trade">Close</button>
          </div>
        </div>
      )}
      {pendings.length === 0 && resolved.length === 0 && <p className="text-sm text-muted-foreground">No offers yet. Trades only happen when both sides agree.</p>}
      <ul className="max-h-96 space-y-2 overflow-y-auto">{pendings.map(row)}{resolved.map(row)}</ul>
    </section>
  );
}
