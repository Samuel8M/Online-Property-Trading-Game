import { useEffect, useState } from 'react';

const PIPS: Record<number, number[]> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

export function Die({ value, tumbling }: { value: number; tumbling?: boolean }) {
  return (
    <div className={`die ${tumbling ? 'tumbling' : ''}`} data-testid={`die-${value}`}>
      {Array.from({ length: 9 }).map((_, i) => (
        <span key={i} className={PIPS[value]?.includes(i) ? `pip ${value === 1 ? '' : 'ink'}` : ''} />
      ))}
    </div>
  );
}

export function DicePair({ roll, rolling }: { roll: number[]; rolling: boolean }) {
  const [shown, setShown] = useState<number[]>([1, 1]);
  const [tumble, setTumble] = useState(false);
  const rollKey = roll.join(',');

  useEffect(() => {
    if (!rolling && roll.length === 2) { setShown(roll); setTumble(false); return; }
    if (!rolling) return;
    setTumble(true);
    const id = setInterval(() => setShown([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]), 90);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolling, rollKey]);

  const idle = roll.length !== 2 && !rolling;
  return (
    <div className="flex gap-4 items-center justify-center" data-testid="dice-pair">
      <Die value={idle ? 3 : shown[0]} tumbling={tumble} />
      <Die value={idle ? 4 : shown[1]} tumbling={tumble} />
    </div>
  );
}
