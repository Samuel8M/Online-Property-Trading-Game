import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuctionSound, AuctionTitle, claimAuctionAlert, getAuctionSoundPreference, setAuctionSoundPreference } from './auction-alerts.js';

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
} });

test('sound defaults off, and the preference is remembered per browser', () => {
  assert.equal(getAuctionSoundPreference(), false);
  setAuctionSoundPreference(true);
  assert.equal(getAuctionSoundPreference(), true);
  setAuctionSoundPreference(false);
  assert.equal(getAuctionSoundPreference(), false);
});

test('new IDs notify once; polls and persisted reload claims do not repeat', () => {
  assert.equal(claimAuctionAlert('room-a', 'first'), true);
  assert.equal(claimAuctionAlert('ROOM-A', 'first'), false);
  assert.equal(claimAuctionAlert('room-a', 'second'), true);
  assert.equal(claimAuctionAlert('room-a', 'second'), false);
  // A separate room has not been seen in memory, simulating a fresh page's stored claim.
  values.set('pp:auction-alert:RELOAD', 'saved');
  assert.equal(claimAuctionAlert('reload', 'saved'), false);
  assert.equal(claimAuctionAlert('another-room', 'first'), true);
});

test('background title stays stable through bids, resets on closure and navigation, and does not re-alert on reload', () => {
  const page = { title: 'Monopoly Online' };
  const title = new AuctionTitle('Table ABC · Monopoly Online', page);
  title.update('id-one', 'Boardwalk', true);
  assert.equal(page.title, 'Auction: Boardwalk · Table ABC · Monopoly Online');
  title.update('id-one', 'Boardwalk', false);
  assert.equal(page.title, 'Auction: Boardwalk · Table ABC · Monopoly Online');
  title.update(undefined, '', false);
  assert.equal(page.title, 'Table ABC · Monopoly Online');
  title.update('id-one', 'Boardwalk', false);
  assert.equal(page.title, 'Table ABC · Monopoly Online');
  title.update('id-two', 'Park Place', true);
  assert.match(page.title, /^Auction: Park Place/);
  title.dispose();
  assert.equal(page.title, 'Monopoly Online');
});

test('sound cannot autoplay; activation plays a preview, new auctions can chime, and mute stops playback', async () => {
  let contexts = 0;
  let tones = 0;
  let closed = 0;
  class FakeAudioContext {
    state = 'suspended';
    currentTime = 0;
    destination = {};
    constructor() { contexts++; }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; closed++; }
    createGain() { return {
      connect() {}, disconnect() {},
      gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
    }; }
    createOscillator() { return {
      type: '', frequency: { setValueAtTime() {} }, onended: null,
      connect() {}, disconnect() {}, start() { tones++; }, stop() {},
    }; }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeAudioContext });
  const sound = new AuctionSound();
  sound.play();
  assert.equal(contexts, 0);
  assert.equal(tones, 0);
  assert.equal(await sound.activate(), true);
  assert.equal(tones, 1);
  sound.play();
  assert.equal(tones, 2);
  sound.mute();
  sound.play();
  assert.equal(closed, 1);
  assert.equal(tones, 2);
  const reloaded = new AuctionSound();
  reloaded.play();
  assert.equal(tones, 2);
});

test('blocked audio reports failure rather than enabling silent sound', async () => {
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class {
    state = 'suspended';
    async resume() {}
    async close() {}
  } });
  const sound = new AuctionSound();
  await assert.rejects(sound.activate(), /blocked/);
  sound.mute();
});

test('storage restrictions do not break the room or in-page deduplication', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); },
  } });
  assert.equal(getAuctionSoundPreference(), false);
  assert.doesNotThrow(() => setAuctionSoundPreference(true));
  assert.equal(claimAuctionAlert('private-storage', 'first'), true);
  assert.equal(claimAuctionAlert('private-storage', 'first'), false);
});