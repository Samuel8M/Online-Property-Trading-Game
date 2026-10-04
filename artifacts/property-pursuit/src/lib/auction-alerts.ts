const soundKey = 'pp:auction-sound';
const seenKey = (code: string) => `pp:auction-alert:${code.toUpperCase()}`;
const seenInPage = new Map<string, string>();

export function getAuctionSoundPreference(): boolean {
  try { return localStorage.getItem(soundKey) === 'on'; } catch { return false; }
}

export function setAuctionSoundPreference(enabled: boolean): void {
  try { localStorage.setItem(soundKey, enabled ? 'on' : 'off'); } catch { /* Page-only preference when storage is unavailable. */ }
}

// Claim before notifying so remounts, polls and reloads cannot replay an alert.
export function claimAuctionAlert(code: string, id: string): boolean {
  const key = seenKey(code);
  if (seenInPage.get(key) === id) return false;
  try {
    if (localStorage.getItem(key) === id) {
      seenInPage.set(key, id);
      return false;
    }
    localStorage.setItem(key, id);
  } catch { /* In-memory deduplication still works without browser storage. */ }
  seenInPage.set(key, id);
  return true;
}

export class AuctionSound {
  private context: AudioContext | null = null;

  // Only called from an explicit click, never from polling or a mount effect.
  async activate(): Promise<boolean> {
    if (!this.context) this.context = new AudioContext();
    const context = this.context;
    await context.resume();
    if (this.context !== context) return false;
    if (context.state !== 'running') throw new Error('Sound is blocked by this browser.');
    this.play();
    return true;
  }

  play(): void {
    const context = this.context;
    // Do not try to bypass a browser's autoplay restrictions.
    if (!context || context.state !== 'running') return;
    const gain = context.createGain();
    gain.connect(context.destination);
    const start = context.currentTime;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.12, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
    const tone = context.createOscillator();
    tone.type = 'sine';
    tone.frequency.setValueAtTime(660, start);
    tone.frequency.setValueAtTime(880, start + 0.18);
    tone.connect(gain);
    tone.onended = () => { tone.disconnect(); gain.disconnect(); };
    tone.start(start);
    tone.stop(start + 0.5);
  }

  mute(): void {
    const context = this.context;
    this.context = null;
    if (context) void context.close().catch(() => {});
  }
}

export class AuctionTitle {
  private activeId: string | null = null;

  constructor(private normalTitle: string, private page: Pick<Document, 'title'>) {
    page.title = normalTitle;
  }

  update(id: string | undefined, property: string, isNew: boolean): void {
    if (!id) {
      this.activeId = null;
      this.page.title = this.normalTitle;
    } else if (isNew) {
      this.activeId = id;
      this.page.title = `Auction: ${property} · ${this.normalTitle}`;
    } else if (this.activeId !== id) {
      this.page.title = this.normalTitle;
    }
  }

  dispose(): void {
    this.page.title = 'Monopoly Online';
  }
}