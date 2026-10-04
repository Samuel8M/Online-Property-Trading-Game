import { useEffect, useState } from 'react';
import { useGetGame } from '@workspace/api-client-react';
import { getSavedRoomCodes, SESSION_CHANGE_EVENT, setToken } from '@/lib/session';

function SavedTable({ code, returning, onReturn, onWatch }: {
  code: string;
  returning: string;
  onReturn: (code: string) => void;
  onWatch: (code: string) => void;
}) {
  // Never send a saved token for discovery: authenticated reads resume tables.
  const room = useGetGame(code, {
    query: {
      queryKey: ['saved-table-preview', code],
      retry: false,
      staleTime: 15_000,
    },
  });
  const missing = room.isError && room.error.status === 404;
  const finished = room.data?.phase === 'finished';
  const status = room.isPending ? 'Checking table...'
    : missing ? 'Table no longer exists.'
    : room.isError ? 'Could not check this table. Your saved seat is still kept.'
    : finished ? 'Game finished — view the result.'
    : room.data?.pausedAt != null ? 'Paused — Return resumes this table.'
    : room.data?.phase === 'lobby' ? 'Waiting for players.' : 'Game in progress.';

  return (
    <div className="rounded-xl border-2 border-ink bg-background p-3" data-testid={`row-saved-${code}`}>
      <p className="font-mono text-lg font-bold">{code}</p>
      <p className="mt-1 text-sm text-muted-foreground" role="status">{status}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {!missing && !finished && (
          <button className="btn btn-primary" disabled={!!returning || room.isPending || room.isError}
            onClick={() => onReturn(code)} data-testid={`button-return-${code}`}>
            {returning === code ? 'Returning...' : 'Return'}
          </button>
        )}
        {room.data && <button className="btn" disabled={!!returning} onClick={() => onWatch(code)}>
          {finished ? 'View result' : 'Watch'}
        </button>}
        {room.isError && <button className="btn" disabled={room.isFetching} onClick={() => room.refetch()}>Retry</button>}
        <button className="btn" disabled={!!returning} onClick={() => {
          if (window.confirm(`Forget the saved seat for ${code} on this browser? This cannot be undone and does not delete the table.`)) setToken(code, '');
        }}>Forget</button>
      </div>
    </div>
  );
}

export function SavedTables({ returning, error, onReturn, onWatch }: {
  returning: string;
  error: string;
  onReturn: (code: string) => void;
  onWatch: (code: string) => void;
}) {
  const [codes, setCodes] = useState(getSavedRoomCodes);
  useEffect(() => {
    const refresh = () => setCodes(getSavedRoomCodes());
    window.addEventListener('storage', refresh);
    window.addEventListener(SESSION_CHANGE_EVENT, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener(SESSION_CHANGE_EVENT, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return (
    <section className="panel mt-8 p-6" aria-labelledby="saved-tables-title" data-testid="saved-tables">
      <h2 id="saved-tables-title" className="display text-2xl font-black">Your saved tables</h2>
      <p className="mt-2 text-sm text-muted-foreground">Private to this browser. Checking or watching a table does not resume it. Choose Return to recover your saved seat.</p>
      <p className="mt-1 text-xs text-muted-foreground">Forget only removes access from this browser; it does not resign your player or delete the table.</p>
      {error && <p role="alert" className="mt-3 rounded-lg bg-primary/10 p-3 text-sm font-medium text-primary">{error}</p>}
      {codes.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No saved tables on this browser yet. Create or join a room to save your seat.</p>
        : <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {codes.map(code => <SavedTable key={code} code={code} returning={returning} onReturn={onReturn} onWatch={onWatch} />)}
        </div>}
    </section>
  );
}