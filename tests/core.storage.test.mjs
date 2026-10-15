// Тесты src/core/storage.js: миграция, битый JSON → чистое состояние, код прогресса. Фейковый localStorage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEY, load, save, defaultState, normalize, exportCode, importCode } from '../src/core/storage.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

const MODES = ['zip', 'flow', 'stroke'];

test('пустое хранилище → чистое состояние с секциями всех режимов', () => {
  const s = load(fakeStorage(), MODES);
  assert.deepEqual(s, defaultState(MODES));
  assert.deepEqual(Object.keys(s.progress), MODES);
  assert.equal(s.current, null);
  assert.equal(s.settings.theme, 'system');
  assert.equal(s.endless.best.mix, 0);
});

test('битый JSON → чистое состояние', () => {
  const s = load(fakeStorage({ [KEY]: '{"v":1,"progress":' }), MODES);
  assert.deepEqual(s, defaultState(MODES));
});

test('не-объект и чужая версия → чистое состояние', () => {
  assert.deepEqual(load(fakeStorage({ [KEY]: '42' }), MODES), defaultState(MODES));
  assert.deepEqual(load(fakeStorage({ [KEY]: '[1,2]' }), MODES), defaultState(MODES));
  assert.deepEqual(load(fakeStorage({ [KEY]: JSON.stringify({ v: 2, progress: { zip: { a: { star: true, bestMs: 5 } } } }) }), MODES), defaultState(MODES));
});

test('бросающий getItem → чистое состояние, бросающий setItem → save возвращает false', () => {
  const broken = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('QuotaExceeded');
    },
  };
  assert.deepEqual(load(broken, MODES), defaultState(MODES));
  assert.equal(save(defaultState(MODES), broken), false);
  assert.deepEqual(load(null, MODES), defaultState(MODES));
});

test('миграция: недостающие поля дописываются, мусор в секциях заменяется', () => {
  const raw = {
    v: 1,
    progress: { zip: { abc: { star: true, bestMs: 4100 }, bad: 'x', neg: { star: 'yes', bestMs: -3 } }, flow: 'junk' },
    skipped: { zip: ['a', 5, null], stroke: 'nope' },
    current: { kind: 'weird', mode: 'zip', levelId: 'abc', elapsedMs: '12', state: { path: [0, 1] }, endless: { streak: '3' } },
    settings: { sound: false, theme: 'neon', flowNumbers: 1 },
    daily: { streak: '2', bestStreak: 1, lastDate: 7, history: ['2026-01-01', 3] },
    endless: { best: { zip: 4, mix: -1, flow: 'x' } },
  };
  const s = normalize(raw, MODES);
  assert.deepEqual(s.progress.zip, { abc: { star: true, bestMs: 4100 }, neg: { star: false, bestMs: 0 } });
  assert.deepEqual(s.progress.flow, {});
  assert.deepEqual(s.progress.stroke, {});
  assert.deepEqual(s.skipped.zip, ['a']);
  assert.deepEqual(s.skipped.stroke, []);
  assert.equal(s.current.kind, 'campaign');
  assert.equal(s.current.elapsedMs, 12);
  assert.equal(s.current.hintUsed, false);
  assert.deepEqual(s.current.state, { path: [0, 1] });
  assert.deepEqual(s.current.endless, { streak: 3, modeChoice: 'mix' });
  assert.equal(s.settings.sound, false);
  assert.equal(s.settings.theme, 'system');
  assert.equal(s.settings.flowNumbers, false);
  assert.equal(s.settings.installCardClosed, false);
  assert.equal(s.daily.streak, 2);
  assert.equal(s.daily.bestStreak, 2, 'bestStreak не меньше streak');
  assert.equal(s.daily.lastDate, null);
  assert.deepEqual(s.daily.history, ['2026-01-01']);
  assert.equal(s.endless.best.zip, 4);
  assert.equal(s.endless.best.mix, 0);
  assert.equal(s.endless.best.flow, 0);
});

test('current без mode/levelId отбрасывается', () => {
  const s = normalize({ v: 1, current: { kind: 'campaign', levelId: 'x' } }, MODES);
  assert.equal(s.current, null);
});

test('save → load даёт то же состояние', () => {
  const storage = fakeStorage();
  const s = defaultState(MODES);
  s.progress.zip.deadbeef = { star: true, bestMs: 1234 };
  s.current = { kind: 'daily', mode: 'flow', levelId: 'f1', elapsedMs: 5, hintUsed: true, resets: 1, startedAt: 10, state: { x: 1 } };
  assert.equal(save(s, storage), true);
  assert.deepEqual(load(storage, MODES), s);
});

test('код прогресса: экспорт без current, импорт возвращает нормализованное состояние', () => {
  const s = defaultState(MODES);
  s.progress.flow.ff = { star: false, bestMs: 99 };
  s.daily = { streak: 3, bestStreak: 5, lastDate: '2026-02-03', history: ['2026-02-01', '2026-02-02', '2026-02-03'] };
  s.current = { kind: 'campaign', mode: 'zip', levelId: 'z', elapsedMs: 1, hintUsed: false, resets: 0, startedAt: 0, state: {} };
  const code = exportCode(s);
  assert.match(code, /^[A-Za-z0-9+/=]+$/);
  const back = importCode(code + '\n', MODES);
  assert.equal(back.current, null);
  assert.deepEqual(back.progress.flow, s.progress.flow);
  assert.deepEqual(back.daily, s.daily);
  assert.equal(importCode('не base64 вовсе', MODES), null);
  assert.equal(importCode(Buffer.from('{"v":9}').toString('base64'), MODES), null);
  assert.equal(importCode('', MODES), null);
});
