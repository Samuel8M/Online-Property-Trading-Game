import { useEffect, useRef, useState } from 'react';
import { useSendChat } from '@workspace/api-client-react';
import type { GameView } from '@workspace/api-client-react';
import { errMsg } from '@/lib/session';

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function ChatPanel({ game, code, token, canPost, onGame }: {
  game: GameView; code: string; token: string; canPost: boolean; onGame: (g: GameView) => void;
}) {
  const send = useSendChat();
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const list = useRef<HTMLOListElement>(null);
  const messages = game.chat ?? [];
  const newest = messages.at(-1)?.id;

  // Keep the newest message visible unless the reader has scrolled back.
  const pinned = useRef(true);
  useEffect(() => {
    const el = list.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [newest]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || send.isPending) return;
    send.mutate({ code, data: { sessionToken: token, text: trimmed } }, {
      onSuccess: (g) => { setText(''); setErr(''); pinned.current = true; onGame(g); },
      onError: (e) => setErr(errMsg(e)),
    });
  };

  return (
    <section className="panel p-5" data-testid="panel-chat">
      <h2 className="display mb-2 text-xl font-black">Chat</h2>
      <ol ref={list} onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}
        className="mb-3 max-h-48 space-y-1 overflow-y-auto text-sm" data-testid="list-chat" aria-live="polite">
        {messages.length === 0 && <li className="text-muted-foreground">No messages yet. Say hello!</li>}
        {messages.map((m) => (
          <li key={m.id} className="break-words">
            <span className="font-bold" style={{ color: m.color }}>{m.name}</span>
            <span className="ml-1 text-xs text-muted-foreground">{time(m.at)}</span>
            <span className="ml-2">{m.text}</span>
          </li>
        ))}
      </ol>
      {canPost ? (
        <form onSubmit={submit} className="flex gap-2">
          <input className="field min-w-0 flex-1" value={text} maxLength={200} onChange={(e) => setText(e.target.value)}
            placeholder="Message the table…" aria-label="Chat message" data-testid="input-chat" />
          <button className="btn btn-primary" disabled={!text.trim() || send.isPending} data-testid="button-send-chat">Send</button>
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">Only seated players can post. Spectators can read along.</p>
      )}
      {err && <p role="alert" className="mt-2 text-xs font-bold text-primary">{err}</p>}
    </section>
  );
}
