import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { getSavedRoomCodes, getToken, SESSION_CHANGE_EVENT, setToken } from './session.ts';

const values = new Map<string, string>();
const events: Event[] = [];
beforeEach(() => {
  values.clear();
  events.length = 0;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() { return values.size; },
      key: (i: number) => [...values.keys()][i] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { dispatchEvent: (event: Event) => { events.push(event); return true; } },
  });
});
afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
  Reflect.deleteProperty(globalThis, 'window');
});

test('discovers existing browser seats by code without exposing their tokens', () => {
  values.set('pp:token:ZXCVBN', 'private-seat-one');
  values.set('pp:token:ABCDEF', 'private-seat-two');
  values.set('pp:token:EMPTY', '');
  values.set('unrelated', 'private-other-value');
  values.set('pp:token:../invalid', 'invalid-code');
  assert.deepEqual(getSavedRoomCodes(), ['ABCDEF', 'ZXCVBN']);
  assert.equal(getToken('abcdef'), 'private-seat-two');
});

test('saving and forgetting only affect the chosen room and notify the lobby', () => {
  setToken('abcdef', 'private-seat');
  setToken('zxcvbn', 'another-seat');
  assert.deepEqual(getSavedRoomCodes(), ['ABCDEF', 'ZXCVBN']);
  setToken('abcdef', '');
  assert.deepEqual(getSavedRoomCodes(), ['ZXCVBN']);
  assert.equal(getToken('ABCDEF'), '');
  assert.equal(getToken('ZXCVBN'), 'another-seat');
  assert.equal(values.has('pp:token:ABCDEF'), false);
  assert.equal(events.length, 3);
  assert.ok(events.every(e => e.type === SESSION_CHANGE_EVENT));
});

test('blocked browser storage does not break the lobby or delete saved seats', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('Storage unavailable'); },
  });
  assert.deepEqual(getSavedRoomCodes(), []);
  assert.equal(getToken('ABCDEF'), '');
  assert.doesNotThrow(() => setToken('ABCDEF', 'private-seat'));
});