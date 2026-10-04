import { useState } from 'react';
import { useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetGameQueryKey,
  getListGamesQueryKey,
  useCreateGame,
  useJoinGame,
  useListGames,
} from '@workspace/api-client-react';
import { Die } from '@/components/dice';
import { errMsg, getToken, setToken } from '@/lib/session';

export default function Lobby() {
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const list = useListGames({ query: { queryKey: getListGamesQueryKey(), refetchInterval: 3000 } });
  const create = useCreateGame();
  const join = useJoinGame();

  const cleanName = name.trim();
  const doCreate = () => {
    setError('');
    create.mutate({ data: { playerName: cleanName } }, {
      onSuccess: (r) => {
        setToken(r.game.code, r.sessionToken);
        qc.setQueryData(getGetGameQueryKey(r.game.code), r.game);
        nav(`/room/${r.game.code}`);
      },
      onError: (e) => setError(errMsg(e)),
    });
  };
  const doJoin = (c: string) => {
    const cc = c.trim().toUpperCase();
    if (!cc) return;
    setError('');
    const existing = getToken(cc);
    if (!cleanName && !existing) { nav(`/room/${cc}`); return; }
    join.mutate({ code: cc, data: { playerName: cleanName || 'Player', sessionToken: existing || undefined } }, {
      onSuccess: (r) => {
        setToken(cc, r.sessionToken);
        qc.setQueryData(getGetGameQueryKey(cc), r.game);
        nav(`/room/${cc}`);
      },
      onError: (e) => setError(errMsg(e)),
    });
  };

  const rooms = list.data?.rooms ?? [];
  return (
    <main className="mx-auto min-h-[100dvh] max-w-6xl px-5 py-10">
      <header className="grid items-center gap-10 md:grid-cols-[1.3fr_1fr]">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">A game for 2 to 6 friends</p>
          <h1 className="display mt-3 text-6xl font-black leading-[0.9] sm:text-8xl">
            Property<br /><span className="text-primary">Pursuit</span>
          </h1>
          <p className="mt-5 max-w-md text-lg text-muted-foreground">
            Roll, buy, collect color sets, and bleed your friends dry in rent. One table, twenty-eight spaces, no mercy.
          </p>
        </div>
        <div className="relative flex h-48 items-center justify-center">
          <motion.div animate={{ rotate: [-8, 8, -8] }} transition={{ repeat: Infinity, duration: 6 }}><Die value={5} /></motion.div>
          <motion.div className="-ml-2 mt-10" animate={{ rotate: [10, -6, 10] }} transition={{ repeat: Infinity, duration: 5 }}><Die value={2} /></motion.div>
        </div>
      </header>

      <section className="mt-12 grid gap-8 md:grid-cols-[1fr_1.2fr]">
        <div className="panel space-y-4 p-6">
          <h2 className="display text-2xl font-black">Take a seat</h2>
          <label className="block text-sm font-bold">Your name
            <input className="field mt-1" maxLength={18} value={name} onChange={(e) => setName(e.target.value)} placeholder="Marguerite" data-testid="input-name" />
          </label>
          <button className="btn btn-primary w-full" disabled={!cleanName || create.isPending} onClick={doCreate} data-testid="button-create">
            {create.isPending ? 'Setting the table...' : 'Create a room'}
          </button>
          <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
          <div className="flex gap-2">
            <input className="field font-mono uppercase" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} placeholder="ROOM CODE" data-testid="input-code" />
            <button className="btn btn-gold" disabled={!code.trim() || join.isPending} onClick={() => doJoin(code)} data-testid="button-join-code">Join</button>
          </div>
          {error && <p className="rounded-lg bg-primary/10 p-3 text-sm font-medium text-primary" data-testid="text-error">{error}</p>}
          <p className="text-xs text-muted-foreground">Enter a code without a name to simply watch a game in progress.</p>
        </div>

        <div className="panel p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="display text-2xl font-black">Open tables</h2>
            <span className="font-mono text-xs text-muted-foreground">live</span>
          </div>
          <div className="mt-4 space-y-3">
            {list.isLoading && [0, 1, 2].map((i) => <div key={i} className="skeleton h-16" />)}
            {list.isError && (
              <div className="rounded-lg bg-primary/10 p-4 text-sm">Could not load rooms.{' '}
                <button className="font-bold underline" onClick={() => list.refetch()}>Retry</button></div>
            )}
            {!list.isLoading && !list.isError && rooms.length === 0 && (
              <div className="rounded-xl border-2 border-dashed border-border p-8 text-center">
                <p className="display text-xl font-black">The table is empty.</p>
                <p className="text-sm text-muted-foreground">Create a room and invite the first player.</p>
              </div>
            )}
            {rooms.map((r, i) => (
              <motion.div key={r.code} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                className="flex items-center justify-between rounded-xl border-2 border-ink bg-background p-3" data-testid={`row-room-${r.code}`}>
                <div>
                  <p className="font-mono text-lg font-bold">{r.code}</p>
                  <p className="text-sm text-muted-foreground">Hosted by {r.hostName} / {r.players} of {r.maxPlayers} / {r.phase}</p>
                </div>
                <button className="btn" disabled={join.isPending} onClick={() => (r.phase === 'lobby' ? doJoin(r.code) : nav(`/room/${r.code}`))} data-testid={`button-open-${r.code}`}>
                  {r.phase === 'lobby' ? 'Join' : 'Watch'}
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
