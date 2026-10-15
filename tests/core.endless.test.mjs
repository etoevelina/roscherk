// Тесты src/core/endless.js (§3.2): главы по серии, выбор уровня среди непройденных, fallback-и,
// детерминизм от seed, лучшие серии, обрыв серии подсказкой/пропуском (регресс: победа после
// подсказки давала streakBefore + 1 и ложный рекорд).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chaptersForStreak, pickEndlessLevel, updateBest, createStreakTracker, MIX } from '../src/core/endless.js';

const MODES = ['zip', 'flow', 'stroke'];
const pool = (mode, chapters) => {
  const out = [];
  for (const chapter of chapters) for (let i = 0; i < 3; i++) out.push({ id: `${mode}-${chapter}-${i}`, chapter });
  return out;
};
const POOLS = { zip: pool('zip', [1, 2, 3, 4, 5]), flow: pool('flow', [1, 2, 3, 4, 5]), stroke: pool('stroke', [1, 2, 3, 4, 5]) };

test('chaptersForStreak: границы 4/5, 9/10, 14/15', () => {
  assert.deepEqual(chaptersForStreak(0), [1, 2]);
  assert.deepEqual(chaptersForStreak(4), [1, 2]);
  assert.deepEqual(chaptersForStreak(5), [3]);
  assert.deepEqual(chaptersForStreak(9), [3]);
  assert.deepEqual(chaptersForStreak(10), [4]);
  assert.deepEqual(chaptersForStreak(14), [4]);
  assert.deepEqual(chaptersForStreak(15), [5]);
  assert.deepEqual(chaptersForStreak(100), [5]);
});

test('pickEndlessLevel: уровень нужной главы и выбранного режима', () => {
  for (const streak of [0, 4, 5, 10, 15]) {
    const picked = pickEndlessLevel({ pools: POOLS, modeIds: MODES, modeChoice: 'flow', streak, seed: 7 });
    assert.equal(picked.mode, 'flow');
    assert.ok(chaptersForStreak(streak).includes(picked.level.chapter), `серия ${streak} → глава ${picked.level.chapter}`);
  }
});

test('микс берёт уровни из всех режимов', () => {
  const seen = new Set();
  for (let seed = 0; seed < 60; seed++) {
    seen.add(pickEndlessLevel({ pools: POOLS, modeIds: MODES, modeChoice: MIX, streak: 7, seed }).mode);
  }
  assert.deepEqual([...seen].sort(), [...MODES].sort());
});

test('использованные в сессии уровни исключаются; при исчерпании главы — любые непройденные; затем любые', () => {
  const used = new Set(['zip-1-0', 'zip-1-1', 'zip-1-2', 'zip-2-0', 'zip-2-1']);
  const p1 = pickEndlessLevel({ pools: POOLS, modeIds: MODES, modeChoice: 'zip', streak: 0, usedIds: used, seed: 3 });
  assert.equal(p1.level.id, 'zip-2-2', 'единственный непройденный уровень глав 1–2');
  used.add('zip-2-2');
  const p2 = pickEndlessLevel({ pools: POOLS, modeIds: MODES, modeChoice: 'zip', streak: 0, usedIds: used, seed: 3 });
  assert.ok(!used.has(p2.level.id) && p2.level.chapter >= 3, 'главы исчерпаны → любой непройденный');
  const all = new Set(POOLS.zip.map((l) => l.id));
  const p3 = pickEndlessLevel({ pools: POOLS, modeIds: MODES, modeChoice: 'zip', streak: 0, usedIds: all, seed: 3 });
  assert.ok(p3 && all.has(p3.level.id), 'пул исчерпан → любой уровень');
  assert.equal(pickEndlessLevel({ pools: { zip: [] }, modeIds: ['zip'], modeChoice: 'zip', streak: 0 }), null);
});

test('детерминизм: одинаковые аргументы → один и тот же уровень', () => {
  const a = pickEndlessLevel({ pools: POOLS, modeIds: MODES, modeChoice: MIX, streak: 12, seed: 99 });
  const b = pickEndlessLevel({ pools: POOLS, modeIds: MODES, modeChoice: MIX, streak: 12, seed: 99 });
  assert.deepEqual(a, b);
});

test('updateBest: растёт только вверх, не мутирует вход, ключ по умолчанию — mix', () => {
  const best = { zip: 3, flow: 0, stroke: 0, mix: 0 };
  assert.equal(updateBest(best, 'zip', 2), best);
  assert.equal(updateBest(best, 'zip', 3), best);
  const next = updateBest(best, 'zip', 5);
  assert.notEqual(next, best);
  assert.equal(next.zip, 5);
  assert.equal(best.zip, 3);
  assert.equal(updateBest(best, null, 2).mix, 2);
});

test('серия: подсказка обрывает серию — победа даёт 1, а не streakBefore + 1; рекорд не завышается', () => {
  const tracker = createStreakTracker(5);
  let best = { zip: 5, flow: 0, stroke: 0, mix: 0 };
  assert.equal(tracker.streak, 5);
  assert.equal(tracker.before, 5);
  // Подсказка: серия обрывается, рекорд фиксируется по прежнему значению.
  const was = tracker.break();
  assert.equal(was, 5);
  best = updateBest(best, 'zip', was);
  assert.equal(tracker.streak, 0);
  assert.equal(tracker.before, 0, '«Повторить» после обрыва не воскрешает серию');
  assert.equal(tracker.broken, true);
  // Победа в той же партии.
  assert.equal(tracker.win(), 1);
  best = updateBest(best, 'zip', tracker.streak);
  assert.equal(best.zip, 5, 'рекорд не растёт после обрыва');
  assert.equal(tracker.streak > best.zip, false, 'нет «Нового рекорда серии»');
});

test('серия без обрыва: победа считает от текущего значения, повторный break — без эффекта', () => {
  const tracker = createStreakTracker(7);
  assert.equal(tracker.win(), 8);
  assert.equal(tracker.before, 7);
  assert.equal(updateBest({ mix: 7 }, 'mix', tracker.streak).mix, 8);
  const t2 = createStreakTracker(0);
  assert.equal(t2.break(), 0, 'обрывать нечего');
  assert.equal(t2.break(), 0);
  assert.equal(t2.win(), 1);
  assert.equal(createStreakTracker(-3).streak, 0);
});
