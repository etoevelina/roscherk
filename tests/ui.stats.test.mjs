// Вкладки «Статистика» и «Ежедневная» (docs/DESIGN.md §5.8–5.9): чистые помощники экранов.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plural, puzzlesLine, rangeCaption, barLevels, modeSummary, campaignIdsByMode } from '../src/ui/stats.js';
import { weekStrip, monthGrid, dailyAction, levelFacts } from '../src/ui/daily.js';

const PUZZLES = ['головоломка', 'головоломки', 'головоломок'];

test('plural и подпись над графиком: 1 головоломка, 3 головоломки, 12 головоломок', () => {
  assert.deepEqual(
    [0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111, 112].map((n) => plural(n, PUZZLES)),
    ['головоломок', 'головоломка', 'головоломки', 'головоломки', 'головоломок', 'головоломок', 'головоломок', 'головоломок', 'головоломка', 'головоломки', 'головоломок', 'головоломка', 'головоломок', 'головоломок'],
  );
  assert.equal(puzzlesLine(12, 'week'), '12 головоломок за неделю');
  assert.equal(puzzlesLine(1, 'month'), '1 головоломка за месяц');
  assert.equal(puzzlesLine(3, 'all'), '3 головоломки за всё время');
  assert.equal(puzzlesLine(0, 'week'), '0 головоломок за неделю');
});

test('rangeCaption: неделя Пн–Вс, месяц — 30 дней, переход месяца и года', () => {
  assert.equal(rangeCaption('week', '2026-10-15'), '12–18 октября');
  assert.equal(rangeCaption('week', '2026-10-01'), '28 сентября — 4 октября');
  assert.equal(rangeCaption('month', '2026-10-15'), '16 сентября — 15 октября');
  assert.equal(rangeCaption('month', '2026-01-10'), '12 декабря 2025 — 10 января 2026');
  assert.equal(rangeCaption('all', '2026-10-15'), 'Последние 12 месяцев');
});

test('barLevels: доля от максимума, пустой график без NaN', () => {
  const bars = [{ value: 0 }, { value: 3 }, { value: 6 }];
  assert.deepEqual(barLevels(bars, 6).map((b) => b.frac), [0, 0.5, 1]);
  assert.deepEqual(barLevels([{ value: 0 }, { value: 0 }], 0).map((b) => b.frac), [0, 0]);
  assert.equal(barLevels(bars, 6)[1].value, 3); // поля бара сохраняются
});

test('modeSummary и campaignIdsByMode: пройдено, всего, звёзды по кампании сборки', () => {
  const campaigns = { zip: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], flow: [{ id: 'x' }] };
  const progress = {
    zip: { a: { star: true, bestMs: 1000, stars: 3 }, b: { star: false, bestMs: 2000, stars: 2 }, gone: { star: true, bestMs: 5, stars: 3 } },
    flow: {},
  };
  const rows = modeSummary([{ id: 'zip' }, { id: 'flow' }], (id) => campaigns[id], progress);
  assert.deepEqual(rows, [
    { id: 'zip', done: 2, total: 3, stars: 5, starsMax: 9 },
    { id: 'flow', done: 0, total: 1, stars: 0, starsMax: 3 },
  ]);
  const app = { modes: [{ id: 'zip' }, { id: 'flow' }], modeSets: (id) => ({ campaign: campaigns[id] }) };
  assert.deepEqual(campaignIdsByMode(app), { zip: ['a', 'b', 'c'], flow: ['x'] });
});

test('weekStrip: Пн–Вс текущей недели, сегодня, решённые и будущие дни', () => {
  const daily = { streak: 2, bestStreak: 2, lastDate: '2026-10-14', history: ['2026-10-11', '2026-10-13', '2026-10-14'] };
  const week = weekStrip(daily, '2026-10-15');
  assert.deepEqual(week.map((d) => d.label), ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']);
  assert.deepEqual(week.map((d) => d.day), [12, 13, 14, 15, 16, 17, 18]);
  assert.deepEqual(week.map((d) => d.done), [false, true, true, false, false, false, false]);
  assert.equal(week.findIndex((d) => d.today), 3);
  assert.deepEqual(week.map((d) => d.future), [false, false, false, false, true, true, true]);
});

test('monthGrid: четыре полные недели Пн–Вс, будущее не решено', () => {
  const daily = { streak: 1, bestStreak: 1, lastDate: '2026-10-15', history: ['2026-09-21', '2026-10-15'] };
  const grid = monthGrid(daily, '2026-10-15');
  assert.equal(grid.length, 28);
  assert.equal(grid[0].date, '2026-09-21'); // понедельник
  assert.equal(grid[27].date, '2026-10-18'); // воскресенье текущей недели
  assert.equal(grid[0].done, true);
  assert.deepEqual(grid.filter((d) => d.today).map((d) => d.date), ['2026-10-15']);
  assert.deepEqual(grid.filter((d) => d.future).map((d) => d.date), ['2026-10-16', '2026-10-17', '2026-10-18']);
  assert.equal(grid.filter((d) => d.done).length, 2);
});

test('dailyAction: решена → продолжить только сегодняшнюю → начать → нет уровня', () => {
  const daily = { streak: 0, bestStreak: 0, lastDate: null, history: [] };
  const cur = { kind: 'daily', mode: 'zip', levelId: 'l1', date: '2026-10-15' };
  assert.equal(dailyAction({ daily: { ...daily, history: ['2026-10-15'] }, current: cur }, '2026-10-15', { currentFound: true }), 'done');
  assert.equal(dailyAction({ daily, current: cur }, '2026-10-15', { currentFound: true }), 'resume');
  assert.equal(dailyAction({ daily, current: cur }, '2026-10-15', { currentFound: false }), 'start');
  assert.equal(dailyAction({ daily, current: { ...cur, date: '2026-10-14' } }, '2026-10-15', { currentFound: true }), 'start');
  assert.equal(dailyAction({ daily, current: { ...cur, kind: 'campaign' } }, '2026-10-15', { currentFound: true }), 'start');
  assert.equal(dailyAction({ daily, current: null }, '2026-10-15', { hasLevel: false }), 'none');
});

test('levelFacts: размеры и состав уровня дня по режиму', () => {
  assert.equal(levelFacts('zip', { n: 6, marks: Array(7).fill([0, 1]) }), '6×6 · 7 чисел');
  assert.equal(levelFacts('zip', { n: 4, marks: Array(3).fill([0, 1]) }), '4×4 · 3 числа');
  assert.equal(levelFacts('flow', { n: 7, flows: Array(8).fill([]) }), '7×7 · 8 пар');
  assert.equal(levelFacts('flow', { n: 5, flows: Array(4).fill([]) }), '5×5 · 4 пары');
  assert.equal(levelFacts('stroke', { nodes: Array(10).fill([0, 0]), edges: Array(15).fill([0, 1, 0]) }), '10 точек · 15 линий');
  assert.equal(levelFacts('stroke', { nodes: Array(21).fill([0, 0]), edges: Array(22).fill([0, 1, 0]) }), '21 точка · 22 линии');
  assert.equal(levelFacts('words', { id: 'w' }), '');
  assert.equal(levelFacts('zip', null), '');
});
