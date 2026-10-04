import { useState } from 'react';
import { useRespondAuction } from '@workspace/api-client-react';
import type { GameView } from '@workspace/api-client-react';
import { errMsg, money } from '@/lib/session';

export function AuctionPanel({ game, code, token, now, disabled, onGame, onError }: {
  game: GameView; code: string; token: string; now: number; disabled: boolean;
  onGame: (game: GameView) => void; onError: (error: string) => void;
}) {
  const mutation = useRespondAuction();
  const [amount, setAmount] = useState('');
  const auction = game.auction;
  if (!auction) return null;
  const me = game.players.find(p => p.id === game.myPlayerId);
  const leader = game.players.find(p => p.id === auction.highestBidderPlayerId);
  const tile = game.board.find(s => s.id === auction.spaceId);
  const minimum = auction.highestBid + auction.increment;
  const bid = amount === '' ? minimum : Number(amount);
  const seconds = Math.max(0, Math.ceil((auction.deadline - now) / 1000));
  const withdrawn = !!me && auction.withdrawnPlayerIds.includes(me.id);
  const leading = !!me && me.id === auction.highestBidderPlayerId;
  const eligible = !!me && !me.bankrupt && !me.resigned && auction.eligiblePlayerIds.includes(me.id);
  const respond = (action: 'bid' | 'withdraw') => mutation.mutate({
    code, data: { sessionToken: token, auctionId: auction.id, action, ...(action === 'bid' ? { amount: bid } : {}) },
  }, {
    onSuccess: next => { setAmount(''); onGame(next); },
    onError: error => onError(errMsg(error)),
  });
  const busy = disabled || mutation.isPending || seconds === 0;
  return <section className="rounded-xl border-2 border-ink bg-accent/20 p-4 space-y-3" data-testid="panel-auction">
    <h3 className="display text-xl font-black">Auction · {tile?.name}</h3>
    <p className="text-sm font-bold" data-testid="auction-leader">{leader ? `${leader.name} leads at ${money(auction.highestBid)}` : 'No bids yet · opening bid $10'}</p>
    <p className="font-mono text-sm" data-testid="auction-timer">{seconds > 0 ? `${seconds}s remaining` : 'Closing on the server…'}</p>
    <p className="text-xs">All live players can bid, including the player who declined and players in Jail. Increase by at least $10, using cash only. Every bid restarts the 30-second clock. Withdrawal is final; a leading bid is binding.</p>
    {eligible && !withdrawn && !leading && <div className="space-y-2">
      <label className="block text-sm font-bold" htmlFor="auction-bid">Your bid (minimum {money(minimum)}, cash {money(me.cash)})</label>
      <input id="auction-bid" className="field" type="number" min={minimum} max={Math.min(me.cash, 1000000)} step={1} value={amount} placeholder={String(minimum)} onChange={e => setAmount(e.target.value)} disabled={busy} data-testid="input-auction-bid" />
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-gold" disabled={busy || !Number.isSafeInteger(bid) || bid < minimum || bid > me.cash || bid > 1000000} onClick={() => respond('bid')} data-testid="button-auction-bid">Bid {money(bid)}</button>
        <button className="btn" disabled={busy} onClick={() => respond('withdraw')} data-testid="button-auction-withdraw">Withdraw</button>
      </div>
    </div>}
    {leading && <p className="text-sm font-bold">You lead. Your bid will be paid if you win.</p>}
    {withdrawn && <p className="text-sm">You withdrew. You can watch the remaining bids.</p>}
    {!eligible && <p className="text-sm">You are watching this auction.</p>}
    <ul className="text-xs space-y-1" aria-label="Auction participants">
      {auction.eligiblePlayerIds.map(id => <li key={id}>{game.players.find(p => p.id === id)?.name}: {id === auction.highestBidderPlayerId ? 'leading' : auction.withdrawnPlayerIds.includes(id) ? 'withdrawn' : 'may bid'}</li>)}
    </ul>
    <p className="text-xs text-muted-foreground">The turn timer, property management, trades and resignation pause until this auction closes. No bids means the deed stays with the bank.</p>
  </section>;
}