import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'wouter';
import { AnimatePresence, motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetGameQueryKey,
  useBuyProperty,
  useEndTurn,
  useGetGame,
  useJoinGame,
  useRollDice,
  useStartGame,
} from '@workspace/api-client-react';
import type { GameView } from '@workspace/api-client-react';
import { Tile, TileDetail } from '@/components/board';
import { DicePair } from '@/components/dice';
import { errMsg, getToken, money, setToken } from '@/lib/session';

export default function Room() {
  const params = useParams<{ code: string }>();
  const code = (params.code ?? '').toUpperCase();
  const qc = useQueryClient();
  const [token, setTok] = useState(getToken(code));
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [sel, setSel] = useState<number | null>(null);
  const [rolling, setRolling] = useState(false);
  const [copied, setCopied] = useState('');
  const [rules, setRules] = useState(false);

  const q = useGetGame(code, {
    query: { queryKey: getGetGameQueryKey(code), refetchInterval: 1000 },
    request: { headers: { 'X-Game-Token': token } },
  });
  const join = useJoinGame();
  const start = useStartGame();
  const roll = useRollDice();
  const buy = useBuyProperty();
  const end = useEndTurn();
  const game = q.data;

  const lastTurnRoll = useRef('');
  useEffect(() => {
    document.title = `Table ${code} · Property Pursuit`;
    return () => { document.title = 'Property Pursuit'; };
  }, [code]);
  useEffect(() => {
    if (!game) return;
    const k = `${game.turnNumber}:${game.lastRoll.join(',')}`;
    if (k !== lastTurnRoll.current && game.lastRoll.length === 2) {
      lastTurnRoll.current = k;
      setRolling(true);
      const t = setTimeout(() => setRolling(false), 900);
      return () => clearTimeout(t);
    }
    lastTurnRoll.current = k;
    return undefined;
  }, [game?.turnNumber, game?.lastRoll.join(',')]);

  const setGame = (g: GameView) => { setErr(''); qc.setQueryData(getGetGameQueryKey(code), g); };
  const act = (m: typeof start | typeof roll | typeof buy | typeof end) => {
    (m as typeof start).mutate({ code, data: { sessionToken: token } }, { onSuccess: setGame, onError: (e) => setErr(errMsg(e)) });
  };
  const doRoll = () => { setRolling(true); roll.mutate({ code, data: { sessionToken: token } }, { onSuccess: (g) => { setGame(g); setTimeout(() => setRolling(false), 700); }, onError: (e) => { setRolling(false); setErr(errMsg(e)); } }); };
  const doJoin = () => {
    join.mutate({ code, data: { playerName: name.trim(), sessionToken: token || undefined } }, {
      onSuccess: (r) => { setToken(code, r.sessionToken); setTok(r.sessionToken); setGame(r.game); },
      onError: (e) => setErr(errMsg(e)),
    });
  };
  const copy = (what: string, text: string) => { navigator.clipboard?.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(''), 1500); }).catch(() => setErr('Copy failed.')); };

  if (q.isLoading) {
    return <div className="mx-auto max-w-5xl space-y-4 p-8"><div className="skeleton h-12 w-64" /><div className="skeleton aspect-square max-w-xl" /></div>;
  }
  if (q.isError || !game) {
    return (
      <div className="grid min-h-[100dvh] place-items-center p-6">
        <div className="panel max-w-sm space-y-3 p-8 text-center">
          <h1 className="display text-3xl font-black">No such table</h1>
          <p className="text-muted-foreground">Room {code} could not be found. {errMsg(q.error)}</p>
          <button className="btn" onClick={() => q.refetch()}>Retry</button>{' '}
          <Link href="/" className="btn btn-primary">Back to lobby</Link>
        </div>
      </div>
    );
  }

  const me = game.players.find((p) => p.id === game.myPlayerId);
  const cur = game.players.find((p) => p.id === game.currentPlayerId);
  const myTurn = !!me && game.phase === 'playing' && game.currentPlayerId === me.id;
  const rolled = game.lastRoll.length === 2;
  const curSpace = cur ? game.board[cur.position] : undefined;
   const canBuy = myTurn && rolled && !!curSpace && curSpace.price != null && !curSpace.ownerPlayerId && !!me && !me.bankrupt && me.cash >= curSpace.price && (curSpace.type === 'property' || curSpace.type === 'transit');
  const winner = game.players.find((p) => p.id === game.winnerPlayerId);
  const shown = game.board[sel ?? cur?.position ?? 0];
  const busy = roll.isPending || buy.isPending || end.isPending || start.isPending;
  const link = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/room/${code}`;
  const canJoin = !me && game.phase === 'lobby';

  return (
    <main className="mx-auto min-h-[100dvh] max-w-[1400px] p-3 sm:p-6">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/" className="display text-2xl font-black" data-testid="link-home">Property <span className="text-primary">Pursuit</span></Link>
        <span className="ml-auto flex flex-wrap gap-2">
          <button className="btn btn-gold !py-1.5 font-mono" onClick={() => copy('code', code)} data-testid="button-copy-code">{copied === 'code' ? 'Copied' : `Code ${code}`}</button>
          <button className="btn !py-1.5" onClick={() => copy('link', link)} data-testid="button-copy-link">{copied === 'link' ? 'Copied' : 'Copy invite link'}</button>
          <button className="btn !py-1.5" onClick={() => setRules((r) => !r)} data-testid="button-rules">{rules ? 'Hide rules' : 'Rules'}</button>
        </span>
      </header>

      <AnimatePresence>
        {rules && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="panel mb-4 grid gap-2 p-5 text-sm sm:grid-cols-2" data-testid="panel-rules">
              <p><b>Turn.</b> Roll both dice once and move that many spaces clockwise.</p>
              <p><b>Start.</b> Everyone begins with $1,500 and earns $200 each time they pass Start.</p>
              <p><b>Buy.</b> Land on an unowned property you can afford and you may buy it, or pass.</p>
              <p><b>Rent.</b> Land on someone else's property and pay rent. Own a full color group and rent doubles.</p>
               <p><b>Hazards.</b> Tax and Lucky Break spaces affect your cash. Detention costs $50 to leave on your next roll.</p>
              <p><b>Winning.</b> Bankrupt players are out. Last one standing wins.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="mx-auto w-full max-w-[860px] rounded-3xl border-2 border-ink bg-felt p-2 shadow-[8px_8px_0_hsl(var(--foreground))] sm:p-3">
          <div className="grid aspect-square w-full grid-cols-8 grid-rows-8 gap-[3px]">
            {game.board.map((s) => (
              <Tile key={s.id} space={s} players={game.players} selected={sel === s.id} onSelect={() => setSel(sel === s.id ? null : s.id)} />
            ))}
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-background/95 p-2 text-center" style={{ gridArea: '2 / 2 / 8 / 8' }}>
              <DicePair roll={game.lastRoll} rolling={rolling} />
              <AnimatePresence mode="wait">
                <motion.p key={game.message} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="display max-w-sm text-sm font-black leading-tight sm:text-xl" data-testid="text-message">{game.message}</motion.p>
              </AnimatePresence>
              {shown && <div className="hidden w-full justify-center sm:flex"><TileDetail space={shown} players={game.players} /></div>}
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          {err && <p className="rounded-lg border-2 border-primary bg-primary/10 p-3 text-sm font-bold text-primary" data-testid="text-error">{err}</p>}

          <section className="panel p-5">
            {game.phase === 'finished' && (
              <div className="text-center" data-testid="panel-winner">
                <p className="font-mono text-xs uppercase tracking-widest text-primary">Game over</p>
                <h2 className="display text-4xl font-black" style={{ color: winner?.color }}>{winner?.name ?? 'Nobody'} wins</h2>
                <Link href="/" className="btn btn-primary mt-4">New game</Link>
              </div>
            )}
            {game.phase === 'lobby' && (
              <div className="space-y-3">
                <h2 className="display text-2xl font-black">Waiting for players</h2>
                <p className="text-sm text-muted-foreground">{game.players.length} seated. Needs 2 to 6 to begin.</p>
                {canJoin && (
                  <div className="space-y-2">
                    <input className="field" maxLength={18} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-join-name" />
                    <button className="btn btn-primary w-full" disabled={!name.trim() || join.isPending} onClick={doJoin} data-testid="button-join">{join.isPending ? 'Joining...' : 'Take a seat'}</button>
                  </div>
                )}
                {me?.isHost && <button className="btn btn-primary w-full" disabled={game.players.length < 2 || busy} onClick={() => act(start)} data-testid="button-start">{start.isPending ? 'Starting...' : 'Start game'}</button>}
                {me && !me.isHost && <p className="text-sm font-bold">Waiting for the host to start.</p>}
                {!me && !canJoin && <p className="text-sm font-bold">You are watching.</p>}
              </div>
            )}
            {game.phase === 'playing' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="display text-2xl font-black">{myTurn ? 'Your move' : cur ? `${cur.name}'s move` : 'In play'}</h2>
                  <span className="font-mono text-xs text-muted-foreground">Turn {game.turnNumber}</span>
                </div>
                {!me && <p className="text-sm text-muted-foreground">You are watching this game.</p>}
                {myTurn && !rolled && <button className="btn btn-primary w-full" disabled={busy} onClick={doRoll} data-testid="button-roll">{roll.isPending ? 'Rolling...' : 'Roll the dice'}</button>}
                {myTurn && rolled && (
                  <div className="grid gap-2">
                    {canBuy && curSpace && <button className="btn btn-gold" disabled={busy} onClick={() => act(buy)} data-testid="button-buy">Buy {curSpace.name} for {money(curSpace.price)}</button>}
                    <button className="btn" disabled={busy} onClick={() => act(end)} data-testid="button-end-turn">{canBuy ? 'Pass' : 'End turn'}</button>
                  </div>
                )}
                {me && !myTurn && <p className="text-sm text-muted-foreground">Sit tight. It is not your turn.</p>}
              </div>
            )}
          </section>

          <section className="panel p-5">
            <h2 className="display mb-3 text-xl font-black">Players</h2>
            <ul className="space-y-2">
              {game.players.map((p) => (
                <li key={p.id} data-testid={`row-player-${p.id}`}
                  className={`rounded-xl border-2 p-3 ${p.id === game.currentPlayerId && game.phase === 'playing' ? 'border-ink bg-accent/30' : 'border-border'} ${p.bankrupt ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className="h-4 w-4 rounded-full border-2 border-ink" style={{ background: p.color }} />
                    <b className="truncate">{p.name}{p.id === game.myPlayerId ? ' (you)' : ''}</b>
                    {p.isHost && <span className="rounded bg-ink px-1.5 text-[10px] font-bold uppercase text-paper">Host</span>}
                    {p.jailed && <span className="rounded bg-primary px-1.5 text-[10px] font-bold uppercase text-primary-foreground">Jail</span>}
                    {p.bankrupt && <span className="text-[10px] font-bold uppercase">Bankrupt</span>}
                    <span className="ml-auto font-mono font-bold">{money(p.cash)}</span>
                  </div>
                  {p.properties.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {p.properties.map((id) => (
                        <button key={id} onClick={() => setSel(id)} title={game.board[id]?.name} className="h-4 w-6 rounded-sm border border-ink" style={{ background: game.board[id]?.color }} />
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {shown && <div className="sm:hidden"><TileDetail space={shown} players={game.players} /></div>}

          <section className="panel p-5">
            <h2 className="display mb-2 text-xl font-black">Table talk</h2>
            <ol className="max-h-56 space-y-1 overflow-y-auto text-sm" data-testid="list-history">
              {game.history.length === 0 && <li className="text-muted-foreground">Nothing has happened yet.</li>}
               {game.history.map((h, i) => <li key={i} className={i === 0 ? 'font-bold' : 'text-muted-foreground'}>{h}</li>)}
            </ol>
          </section>
        </aside>
      </div>
    </main>
  );
}
