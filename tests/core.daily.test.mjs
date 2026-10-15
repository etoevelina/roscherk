// Тесты src/core/daily.js: dayNumber, выбор режима и индекса, серия, календарь.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayNumber, addDays, pickDaily, recordDailyWin, displayStreak, calendar, localDateString, isDailyDone } from '../src/core/daily.js';
import { hash32 } from '../src/core/rng.js';

const MODES = ['zip', 'flow', 'stroke'];

test('dayNumber: дни от 2026-01-01', () => {
  assert.equal(dayNumber('2026-01-01'), 0);
  assert.equal(dayNumber('2026-01-02'), 1);
  assert.equal(dayNumber('2026-02-01'), 31);
  assert.equal(dayNumber('2026-12-31'), 364);
  assert.equal(dayNumber('2025-12-31'), -1);
  assert.equal(dayNumber('2027-01-01'), 365);
});

test('addDays переходит через месяц и год', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('localDateString даёт YYYY-MM-DD по локальному времени', () => {
  assert.equal(localDateString(new Date(2026, 2, 7, 23, 59)), '2026-03-07');
});

test('режим чередуется zip → flow → stroke по dayNumber % 3', () => {
  assert.equal(pickDaily('2026-01-01', MODES).mode, 'zip');
  assert.equal(pickDaily('2026-01-02', MODES).mode, 'flow');
  assert.equal(pickDaily('2026-01-03', MODES).mode, 'stroke');
  assert.equal(pickDaily('2026-01-04', MODES).mode, 'zip');
  assert.equal(pickDaily('2025-12-31', MODES).mode, 'stroke', 'отрицательные дни тоже дают валидный режим');
  assert.equal(pickDaily('2026-01-05', ['zip']).mode, 'zip');
});

test('индекс = FNV1a(date) % 40, детерминирован и в диапазоне', () => {
  for (let i = 0; i < 200; i++) {
    const date = addDays('2026-01-01', i);
    const { index } = pickDaily(date, MODES, 40);
    assert.equal(index, hash32(date) % 40);
    assert.ok(index >= 0 && index < 40);
  }
  assert.deepEqual(pickDaily('2026-05-05', MODES), pickDaily('2026-05-05', MODES));
});

test('серия растёт на следующий день, обрывается при пропуске, повтор за день не считается', () => {
  let d = { streak: 0, bestStreak: 0, lastDate: null, history: [] };
  d = recordDailyWin(d, '2026-03-01');
  assert.equal(d.streak, 1);
  d = recordDailyWin(d, '2026-03-02');
  assert.equal(d.streak, 2);
  const same = recordDailyWin(d, '2026-03-02');
  assert.equal(same, d, 'повторная победа в тот же день ничего не меняет');
  d = recordDailyWin(d, '2026-03-03');
  assert.equal(d.streak, 3);
  assert.equal(d.bestStreak, 3);
  d = recordDailyWin(d, '2026-03-05'); // пропущен день
  assert.equal(d.streak, 1);
  assert.equal(d.bestStreak, 3);
  assert.equal(d.lastDate, '2026-03-05');
  assert.deepEqual(d.history, ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-05']);
  assert.equal(isDailyDone(d, '2026-03-05'), true);
  assert.equal(isDailyDone(d, '2026-03-04'), false);
});

test('history не длиннее 60', () => {
  let d = { streak: 0, bestStreak: 0, lastDate: null, history: [] };
  for (let i = 0; i < 70; i++) d = recordDailyWin(d, addDays('2026-01-01', i));
  assert.equal(d.history.length, 60);
  assert.equal(d.streak, 70);
  assert.equal(d.history[0], addDays('2026-01-01', 10));
});

test('displayStreak обнуляется, если последняя победа старше вчера', () => {
  const d = { streak: 4, bestStreak: 4, lastDate: '2026-03-03', history: [] };
  assert.equal(displayStreak(d, '2026-03-03'), 4);
  assert.equal(displayStreak(d, '2026-03-04'), 4);
  assert.equal(displayStreak(d, '2026-03-05'), 0);
  assert.equal(displayStreak({ streak: 0, bestStreak: 0, lastDate: null, history: [] }, '2026-03-05'), 0);
});

test('календарь на 28 дней заканчивается сегодня и отмечает пройденные', () => {
  const d = { streak: 1, bestStreak: 1, lastDate: '2026-03-10', history: ['2026-03-10', '2026-02-20'] };
  const cal = calendar(d, '2026-03-10');
  assert.equal(cal.length, 28);
  assert.equal(cal[27].date, '2026-03-10');
  assert.equal(cal[27].today, true);
  assert.equal(cal[27].done, true);
  assert.equal(cal[0].date, '2026-02-11');
  assert.equal(cal.find((c) => c.date === '2026-02-20').done, true);
  assert.equal(cal.filter((c) => c.done).length, 2);
});
