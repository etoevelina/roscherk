// Статистика (docs/DESIGN.md): активность по дням, график недели/месяца/года, итоги.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordActivity, weekStart, chart, totals, rangeTotal } from '../src/core/stats.js';
import { defaultState } from '../src/core/storage.js';

test('recordActivity: +1 за день, старые дни отрезаются', () => {
  let a = recordActivity({}, '2026-10-15');
  a = recordActivity(a, '2026-10-15');
  assert.deepEqual(a, { '2026-10-15': 2 });
  const many = {};
  for (let i = 0; i < 420; i++) many[`2025-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`] = 1;
  assert.ok(Object.keys(recordActivity(many, '2026-10-15')).length <= 400);
});

test('weekStart и график недели: Пн–Вс, сегодня отмечено, будущее — future', () => {
  assert.equal(weekStart('2026-10-15'), '2026-10-12');
  assert.equal(weekStart('2026-10-12'), '2026-10-12');
  assert.equal(weekStart('2026-10-18'), '2026-10-12');
  const { bars, max } = chart({ '2026-10-13': 2, '2026-10-15': 5 }, '2026-10-15', 'week');
  assert.deepEqual(bars.map((b) => b.label), ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']);
  assert.deepEqual(bars.map((b) => b.value), [0, 2, 0, 5, 0, 0, 0]);
  assert.equal(bars[3].current, true);
  assert.equal(bars[4].future, true);
  assert.equal(max, 5);
  assert.equal(rangeTotal({ '2026-10-13': 2, '2026-10-15': 5 }, '2026-10-15', 'week'), 7);
});

test('график месяца — 30 дней, года — 12 месяцев с суммами', () => {
  const m = chart({ '2026-09-20': 1 }, '2026-10-15', 'month');
  assert.equal(m.bars.length, 30);
  assert.equal(m.bars.at(-1).current, true);
  const y = chart({ '2026-09-03': 3, '2026-09-30': 1, '2025-11-01': 2 }, '2026-10-15', 'all');
  assert.equal(y.bars.length, 12);
  assert.equal(y.bars[0].label, 'ноя');
  assert.equal(y.bars[0].value, 2);
  assert.equal(y.bars[10].value, 4);
});

test('totals: пройдено, без подсказок %, серия, всего', () => {
  const s = defaultState(['zip', 'words']);
  s.progress.zip = { a: { star: true, bestMs: 1, stars: 3 }, b: { star: false, bestMs: 1, stars: 1 }, gone: { star: true, bestMs: 1 } };
  s.progress.words = { w: { star: false, bestMs: 1, stars: 2, nh: true } };
  s.activity = { '2026-10-14': 1 };
  s.daily = { streak: 4, bestStreak: 6, lastDate: '2026-10-14', history: [] };
  const t = totals(s, { zip: ['a', 'b'], words: ['w', 'x'] }, '2026-10-15');
  assert.equal(t.completed, 3);
  assert.equal(t.noHintRate, 67);
  assert.equal(t.streak, 4);
  assert.equal(t.bestStreak, 6);
  assert.equal(t.total, 3, 'не меньше пройденного');
  assert.equal(t.stars, 6);
  assert.equal(t.starsMax, 12);
});
