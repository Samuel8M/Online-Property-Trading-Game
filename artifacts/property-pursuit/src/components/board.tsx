import { motion } from 'framer-motion';
import type { GamePlayer, GameSpace } from '@workspace/api-client-react';
import { money } from '@/lib/session';

export function gridPos(i: number): { row: number; col: number } {
  if (i <= 7) return { row: 8, col: 8 - i };
  if (i <= 13) return { row: 8 - (i - 7), col: 1 };
  if (i <= 21) return { row: 1, col: i - 13 };
  return { row: i - 21 + 1, col: 8 };
}

const GLYPH: Record<string, string> = {
  start: 'GO', transit: 'RAIL', tax: 'TAX', chance: '?', rest: 'REST', jail: 'JAIL', 'go-to-jail': 'ARREST',
};

export function Tile({ space, players, selected, onSelect }: {
  space: GameSpace; players: GamePlayer[]; selected: boolean; onSelect: () => void;
}) {
  const { row, col } = gridPos(space.id);
  const owner = players.find((p) => p.id === space.ownerPlayerId);
  const here = players.filter((p) => p.position === space.id && !p.bankrupt);
  const isProp = space.type === 'property';
  return (
    <button
      onClick={onSelect}
      data-testid={`tile-${space.id}`}
      style={{ gridRow: row, gridColumn: col, boxShadow: owner ? `inset 0 0 0 3px ${owner.color}` : undefined }}
      className={`relative flex flex-col overflow-hidden rounded-md border border-ink/70 bg-paper text-left transition-transform hover:z-10 hover:scale-110 ${selected ? 'z-10 scale-110 ring-4 ring-brass' : ''}`}
    >
      {isProp && <span className="h-[22%] w-full shrink-0 border-b border-ink/60" style={{ background: space.color }} />}
      {!isProp && <span className="h-[10%] w-full shrink-0" style={{ background: space.color }} />}
      <span className="flex flex-1 flex-col items-center justify-center px-0.5 text-center leading-[1.05]">
        {!isProp && <span className="display text-[9px] font-black text-primary sm:text-xs">{GLYPH[space.type]}</span>}
        <span className="text-[7px] font-bold sm:text-[10px]">{space.name}</span>
        {space.price != null && <span className="font-mono text-[7px] text-muted-foreground sm:text-[9px]">{money(space.price)}</span>}
      </span>
      {here.length > 0 && (
        <span className="absolute bottom-0.5 left-0.5 right-0.5 flex flex-wrap justify-center gap-0.5">
          {here.map((p) => (
            <motion.span key={p.id} layoutId={`token-${p.id}`} transition={{ type: 'spring', stiffness: 220, damping: 20 }}
              className="h-3 w-3 rounded-full border-2 border-ink shadow sm:h-4 sm:w-4" style={{ background: p.color }} title={p.name} />
          ))}
        </span>
      )}
    </button>
  );
}

export function TileDetail({ space, players }: { space: GameSpace; players: GamePlayer[] }) {
  const owner = players.find((p) => p.id === space.ownerPlayerId);
  return (
    <div className="w-full max-w-xs overflow-hidden rounded-lg border-2 border-ink bg-paper text-center" data-testid="tile-detail">
      <div className="px-3 py-2 border-b-2 border-ink" style={{ background: space.color }}>
        <p className="font-mono text-[10px] uppercase tracking-widest text-ink/80">{space.group ?? space.type}</p>
        <h3 className="display text-lg font-black text-ink">{space.name}</h3>
      </div>
      <div className="space-y-1 p-3 text-sm">
        <p className="text-muted-foreground">{space.description}</p>
        {space.price != null && <p className="font-mono">Price {money(space.price)}{space.rent != null ? ` / Rent ${money(space.rent)}` : ''}</p>}
        {owner && <p className="font-bold" style={{ color: owner.color }}>Owned by {owner.name}</p>}
        {!owner && space.price != null && <p className="font-bold text-primary">Available</p>}
      </div>
    </div>
  );
}
