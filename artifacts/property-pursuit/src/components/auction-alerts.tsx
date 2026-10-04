import { useEffect, useRef, useState } from 'react';
import { AuctionSound, AuctionTitle, claimAuctionAlert, getAuctionSoundPreference, setAuctionSoundPreference } from '@/lib/auction-alerts';

export function AuctionAlerts({ code, auctionId, propertyName }: {
  code: string; auctionId?: string; propertyName: string;
}) {
  const [enabled, setEnabled] = useState(getAuctionSoundPreference);
  const [armed, setArmed] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState('');
  const sound = useRef<AuctionSound | null>(null);
  const title = useRef<AuctionTitle | null>(null);

  useEffect(() => {
    const audio = new AuctionSound();
    const tabTitle = new AuctionTitle(`Table ${code} · Monopoly Online`, document);
    sound.current = audio;
    title.current = tabTitle;
    setArmed(false);
    const syncPreference = (event: StorageEvent) => {
      if (event.key !== 'pp:auction-sound' && event.key !== null) return;
      const next = getAuctionSoundPreference();
      setEnabled(next);
      if (!next) { audio.mute(); setArmed(false); }
    };
    window.addEventListener('storage', syncPreference);
    return () => {
      window.removeEventListener('storage', syncPreference);
      audio.mute();
      tabTitle.dispose();
      sound.current = null;
      title.current = null;
    };
  }, [code]);

  useEffect(() => {
    const isNew = !!auctionId && claimAuctionAlert(code, auctionId);
    title.current?.update(auctionId, propertyName, isNew);
    if (isNew && enabled) sound.current?.play();
  }, [code, auctionId, propertyName, enabled]);

  const toggle = async () => {
    setError('');
    if (enabled && armed) {
      setAuctionSoundPreference(false);
      setEnabled(false);
      setArmed(false);
      sound.current?.mute();
      return;
    }
    const audio = sound.current;
    if (!audio) return;
    setActivating(true);
    try {
      const activated = await audio.activate();
      if (!activated || sound.current !== audio) return;
      setAuctionSoundPreference(true);
      setEnabled(true);
      setArmed(true);
    } catch {
      if (sound.current !== audio) return;
      audio.mute();
      setAuctionSoundPreference(false);
      setEnabled(false);
      setArmed(false);
      setError('Sound could not start. Check your browser sound permissions and try again.');
    } finally {
      setActivating(false);
    }
  };

  return <span className="flex flex-col items-end gap-1">
    <span className="flex gap-1">
      <button className="btn !py-1.5" onClick={toggle} disabled={activating} aria-pressed={enabled && armed}
        title="Auction sound is optional and saved in this browser. Enabling plays a test chime. After reloading, click to activate it again."
        data-testid="button-auction-sound">
        {activating ? 'Starting sound…' : enabled && armed ? 'Mute auction sound' : enabled ? 'Activate saved auction sound' : 'Enable auction sound'}
      </button>
      {enabled && !armed && <button className="btn !py-1.5" onClick={() => {
        setAuctionSoundPreference(false); setEnabled(false); sound.current?.mute();
      }} disabled={activating} data-testid="button-auction-sound-mute">Mute</button>}
    </span>
    {error && <span role="status" className="max-w-xs text-xs">{error}</span>}
  </span>;
}