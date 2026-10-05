import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getListGamesQueryKey, useResignGame, type GameView } from '@workspace/api-client-react';
import { errMsg, setToken } from '@/lib/session';

// The browser only renders an estimate. It never advances a turn.
export function useRoomClock(game: GameView | undefined, updatedAt: number) {
  const sync = useRef({ updatedAt: 0, server: 0, local: 0 });
  const [, tick] = useState(0);
  if (game && sync.current.updatedAt !== updatedAt) {
    sync.current = { updatedAt, server: game.serverTime ?? Date.now(), local: performance.now() };
  }
  useEffect(() => {
    const timer = setInterval(() => tick(n => n + 1), 250);
    return () => clearInterval(timer);
  }, []);
  return {
    now: sync.current.server + performance.now() - sync.current.local,
    stale: !!game && performance.now() - sync.current.local > 15_000,
  };
}

export function ExitSeat({ game, code, token, disabled, onGame, onToken, onError }: {
  game: GameView; code: string; token: string; disabled: boolean;
  onGame: (game: GameView) => void; onToken: (token: string) => void; onError: (error: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const mutation = useResignGame();
  const qc = useQueryClient();
  const me = game.players.find(p => p.id === game.myPlayerId);
  const lobby = game.phase === 'lobby';
  if (!me || me.bankrupt || me.resigned || game.phase === 'finished') return null;
  const exit = () => mutation.mutate({ code, data: { sessionToken: token } }, {
    onSuccess: next => {
      if (lobby) { setToken(code, ''); onToken(''); }
      onGame(next);
      setConfirm(false);
      void qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
    },
    onError: error => onError(errMsg(error)),
  });
  return <div className="mt-4 border-t border-border pt-3">
    {!confirm ? <button className="btn w-full" onClick={() => setConfirm(true)} data-testid="button-resign">{lobby ? 'Leave seat' : 'Resign from game'}</button> :
      <div role="dialog" aria-modal="false" aria-labelledby="resign-title" className="space-y-3" data-testid="confirm-resign">
        <h3 id="resign-title" className="font-bold">{lobby ? 'Leave this seat?' : 'Resign permanently?'}</h3>
        <p className="text-sm">{lobby ? 'Your seat will be freed. If you are host, another player takes over. You can join again while the room is waiting.' : 'You will be out of this game permanently. Your cash is forfeited, your deeds and buildings return to the bank, and pending trades are cancelled. This cannot be undone.'}</p>
        <p className="text-xs text-muted-foreground">Just stepping away? Go back to the lobby or close this tab instead. {lobby ? 'Your waiting-room seat is saved for five minutes away.' : 'Your seat stays saved; missed turns are skipped.'}</p>
        <div className="flex gap-2">
          <button className="btn" disabled={mutation.isPending} onClick={() => setConfirm(false)}>Keep my seat</button>
          <button className="btn btn-primary" disabled={disabled || mutation.isPending} onClick={exit} data-testid="button-confirm-resign">{mutation.isPending ? 'Leaving…' : lobby ? 'Leave seat' : 'Confirm resignation'}</button>
        </div>
      </div>}
  </div>;
}