// Тесты src/core/progress.js: окно из 3 уровней, звезда за попытку, пропуск, таймер, undo-стек.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  levelStatuses,
  nextLevelIndex,
  lastPassedIndex,
  startAttempt,
  starFor,
  recordWin,
  recordSkip,
  skipAvailable,
  hintShouldPulse,
  createTimer,
  createUndoStack,
  doneCount,
  WINDOW,
} from '../src/core/progress.js';

const levels = Array.from({ length: 10 }, (_, i) => ({ id: `L${i}`, chapter: i < 5 ? 1 : 2 }));
const statusList = (progress, skipped = []) => levelStatuses(levels, progress, skipped).map((s) => s.status);

test('без прогресса открыты первые 3 уровня, остальные — замок', () => {
  assert.equal(WINDOW, 3);
  assert.deepEqual(statusList({}), ['open', 'open', 'open', ...Array(7).fill('locked')]);
  assert.equal(nextLevelIndex(levels, {}, []), 0);
});

test('окно сдвигается за последним пройденным', () => {
  const progress = { L0: { star: true, bestMs: 10 }, L1: { star: false, bestMs: 20 } };
  assert.equal(lastPassedIndex(levels, progress), 1);
  assert.deepEqual(statusList(progress), ['done', 'done', 'open', 'open', 'open', ...Array(5).fill('locked')]);
  assert.equal(nextLevelIndex(levels, progress, []), 2);
});

test('прохождение уровня внутри окна открывает дальше, пропущенные ранее остаются открытыми', () => {
  const progress = { L0: { star: false, bestMs: 10 }, L2: { star: false, bestMs: 30 } };
  assert.deepEqual(statusList(progress), ['done', 'open', 'done', 'open', 'open', 'open', ...Array(4).fill('locked')]);
  assert.equal(nextLevelIndex(levels, progress, []), 1, 'сначала первый непройденный открытый');
});

test('пропуск: уровень без галочки, следующий открывается', () => {
  let skipped = recordSkip([], 'L0');
  skipped = recordSkip(skipped, 'L0');
  assert.deepEqual(skipped, ['L0']);
  const statuses = levelStatuses(levels, {}, skipped);
  assert.equal(statuses[0].status, 'open');
  assert.equal(statuses[0].skipped, true);
  assert.equal(statuses[3].status, 'open', 'L3 открыт после пропуска L0');
  assert.equal(statuses[4].status, 'locked');
  assert.equal(nextLevelIndex(levels, {}, skipped), 1, 'пропущенный не предлагается, пока есть другие открытые');
});

test('nextLevelIndex: когда остались только пропущенные — предлагает их; всё пройдено → −1', () => {
  const progress = {};
  for (let i = 1; i < 10; i++) progress[`L${i}`] = { star: false, bestMs: 5 };
  assert.equal(nextLevelIndex(levels, progress, ['L0']), 0);
  progress.L0 = { star: false, bestMs: 5 };
  assert.equal(nextLevelIndex(levels, progress, ['L0']), -1);
  assert.equal(doneCount(levels, progress), 10);
});

test('звезда — за попытку без подсказки и perfect; сброс не трогает hintUsed', () => {
  const attempt = startAttempt(1000);
  assert.equal(starFor(attempt, true), true);
  assert.equal(starFor(attempt, false), false, 'flow: ходов больше потоков');
  attempt.resets = 5;
  assert.equal(starFor(attempt, true), true, 'сбросы звезду не отнимают');
  attempt.hintUsed = true;
  assert.equal(starFor(attempt, true), false);
});

test('recordWin: лучшее время — минимум, звезда сохраняется навсегда', () => {
  let p = recordWin({}, 'L0', false, 50000);
  assert.deepEqual(p.L0, { star: false, bestMs: 50000 });
  p = recordWin(p, 'L0', true, 60000);
  assert.deepEqual(p.L0, { star: true, bestMs: 50000 });
  p = recordWin(p, 'L0', false, 41000.4);
  assert.deepEqual(p.L0, { star: true, bestMs: 41000 }, 'звезда не теряется при повторе без звезды');
});

test('«Пропустить» после 3 сбросов или 90 с простоя; подсказка пульсирует через 60 с', () => {
  const a = startAttempt(0);
  assert.equal(skipAvailable(a, 1000), false);
  a.resets = 3;
  assert.equal(skipAvailable(a, 1000), true);
  const b = startAttempt(0);
  assert.equal(skipAvailable(b, 89999), false);
  assert.equal(skipAvailable(b, 90000), true);
  assert.equal(hintShouldPulse(b, 59999), false);
  assert.equal(hintShouldPulse(b, 60000), true);
  b.lastChangeAt = 50000;
  assert.equal(skipAvailable(b, 100000), false, 'изменение состояния сбрасывает простой');
});

test('таймер суммирует только активные интервалы', () => {
  const tm = createTimer(1000);
  assert.equal(tm.elapsed(0), 1000);
  tm.start(100);
  assert.equal(tm.elapsed(600), 1500);
  tm.pause(600);
  assert.equal(tm.elapsed(5000), 1500, 'в фоне время не идёт');
  tm.start(5000);
  tm.start(7000); // повторный start не сдвигает начало
  assert.equal(tm.elapsed(6000), 2500);
  assert.equal(tm.running, true);
});

test('undo-стек ограничен глубиной 50', () => {
  const u = createUndoStack();
  for (let i = 0; i < 60; i++) u.push({ i });
  assert.equal(u.size, 50);
  assert.deepEqual(u.pop(), { i: 59 });
  u.clear();
  assert.equal(u.size, 0);
  assert.equal(u.pop(), undefined);
});

test('byChapter (§2.5): окно из 3 уровней считается в каждой главе отдельно, index сквозной', () => {
  const lv = Array.from({ length: 10 }, (_, i) => ({ id: `W${i}`, chapter: i < 5 ? 1 : 2 }));
  const st = levelStatuses(lv, {}, [], { byChapter: true });
  assert.deepEqual(st.map((s) => s.status), ['open', 'open', 'open', 'locked', 'locked', 'open', 'open', 'open', 'locked', 'locked']);
  assert.deepEqual(st.map((s) => s.index), [...Array(10).keys()]);
  const progress = { W5: { star: true, bestMs: 5 } };
  const st2 = levelStatuses(lv, progress, [], { byChapter: true });
  assert.deepEqual(st2.slice(5).map((s) => s.status), ['done', 'open', 'open', 'open', 'locked']);
  assert.equal(nextLevelIndex(lv, progress, [], { byChapter: true }), 0, 'первый открытый непройденный — в первой теме');
  const all = Object.fromEntries(lv.slice(0, 5).map((l) => [l.id, { star: false, bestMs: 9 }]));
  assert.equal(nextLevelIndex(lv, all, [], { byChapter: true }), 5, 'первая тема пройдена — следующая');
  assert.deepEqual(levelStatuses(lv, {}, []).map((s) => s.status).slice(3, 6), ['locked', 'locked', 'locked'], 'без byChapter — как раньше');
});
