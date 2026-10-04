import { motion } from 'framer-motion';
import type { GamePlayer, GameSpace } from '@workspace/api-client-react';
import { money } from '@/lib/session';

export function gridPos(i: number, boardSize = 40): { row: number; col: number } {
  const edge = boardSize / 4, side = edge + 1;
  if (i <= edge) return { row: side, col: side - i };
  if (i <= edge * 2) return { row: side - (i - edge), col: 1 };
  if (i <= edge * 3) return { row: 1, col: i - edge * 2 + 1 };
  return { row: i - edge * 3 + 1, col: side };
}

const GLYPH: Record<string, string> = {
  start: 'GO', transit: 'RAIL', utility: 'UTILITY', tax: 'TAX', chance: '?', 'community-chest': 'CHEST', rest: 'REST', jail: 'JAIL', 'go-to-jail': 'JAIL',
};

export function Tile({ space, players, selected, onSelect, boardSize = 40 }: {
  space: GameSpace; players: GamePlayer[]; selected: boolean; onSelect: () => void; boardSize?: number;
}) {
  const { row, col } = gridPos(space.id, boardSize);
  const owner = players.find((p) => p.id === space.ownerPlayerId);
  const here = players.filter((p) => p.position === space.id && !p.bankrupt);
  const isProp = space.type === 'property';
  return (
    <button
      onClick={onSelect}
      aria-label={space.name}
      title={space.name}
      data-testid={`tile-${space.id}`}
      style={{ gridRow: row, gridColumn: col, boxShadow: owner ? `inset 0 0 0 3px ${owner.color}` : undefined }}
      className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-sm border border-ink/70 bg-paper text-left transition-transform hover:z-10 hover:scale-110 sm:rounded-md ${selected ? 'z-10 scale-110 ring-4 ring-brass' : ''}`}
    >
      {isProp && <span className="h-[22%] w-full shrink-0 border-b border-ink/60" style={{ background: space.color }} />}
      {!isProp && <span className="h-[10%] w-full shrink-0" style={{ background: space.color }} />}
      <span className="flex flex-1 flex-col items-center justify-center px-0.5 text-center leading-[1.05]">
        {!isProp && <span className="display font-black text-primary" style={{ fontSize: 'clamp(5px, 1.3cqw, 12px)' }}>{GLYPH[space.type]}</span>}
         <span className="max-w-full break-words font-bold" style={{ overflowWrap: 'anywhere', fontSize: 'clamp(5px, 1.12cqw, 10px)' }}>{space.name}</span>
        {space.price != null && <span className="font-mono text-muted-foreground" style={{ fontSize: 'clamp(4px, 1cqw, 9px)' }}>{space.ownerPlayerId ? (space.mortgaged ? 'Rent $0' : space.type === 'utility' ? '4× / 10× dice' : `Rent ${money(space.currentRent)}`) : money(space.price)}</span>}
        {space.buildingLevel > 0 && <span className="font-mono font-black text-primary" style={{ fontSize: 'clamp(5px, 1.12cqw, 10px)' }} data-testid={`marker-build-${space.id}`}>{space.buildingLevel === 5 ? 'HOTEL' : 'H'.repeat(space.buildingLevel)}</span>}
        {space.mortgaged && <span className="rounded bg-ink px-0.5 font-bold text-paper" style={{ fontSize: 'clamp(4px, 0.9cqw, 8px)' }} data-testid={`marker-mortgage-${space.id}`}>MORTGAGED</span>}
      </span>
      {here.length > 0 && (
        <span className="absolute bottom-0.5 left-0.5 right-0.5 flex flex-wrap justify-center gap-0.5">
          {here.map((p) => (
            <motion.span key={p.id} layoutId={`token-${p.id}`} transition={{ type: 'spring', stiffness: 220, damping: 20 }}
              className="rounded-full border border-ink shadow" style={{ background: p.color, width: 'clamp(5px, 1.8cqw, 16px)', height: 'clamp(5px, 1.8cqw, 16px)' }} title={p.name} />
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
         {space.price != null && <p className="font-mono">Price {money(space.price)}{space.rent != null ? ` / Rent ${space.type === 'utility' ? '4× / 10× dice' : money(space.rent)}` : ''}</p>}
        {owner && <p className="font-bold" style={{ color: owner.color }}>Owned by {owner.name}</p>}
        {space.price != null && <p className="font-mono text-xs">Current rent {space.mortgaged ? 'none (mortgaged)' : space.type === 'utility' ? '4× / 10× landing dice' : money(space.currentRent)}</p>}
        {space.type === 'property' && <p className="text-xs">{space.buildingLevel === 0 ? 'No buildings' : space.buildingLevel === 5 ? 'Hotel' : `${space.buildingLevel} house${space.buildingLevel > 1 ? 's' : ''}`} · {money(space.buildCost)} per level</p>}
        {space.developmentRents && <p className="font-mono text-[10px]">1/2/3/4 houses: {space.developmentRents.slice(1, 5).map(money).join(' / ')} · Hotel: {money(space.developmentRents[5])}</p>}
        {space.mortgaged && <p className="text-xs font-bold">Redeem for {money(Math.ceil(Math.floor(space.price! / 2) * 11 / 10))}</p>}
        {!owner && space.price != null && <p className="font-bold text-primary">Available</p>}
      </div>
    </div>
  );
}
