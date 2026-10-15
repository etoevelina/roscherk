// Тесты отбора уровней в tools/generate.mjs (§2.0, §5.5): раздача кандидатов по слотам с учётом
// профиля кривой, неубывающая difficulty, соседи ≤ 2×, запасной режим.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignSlots, slotProfile, stripService } from '../tools/generate.mjs';

const cand = (difficulty, profile = '*', seed = difficulty * 7 + 1) => ({ difficulty, seed, profile, level: { seed } });
const slotsOf = (profiles) => profiles.map((profile, i) => ({ levelIndex: i + 1, profile }));
const diffs = (res) => res.map((c) => c.difficulty);

test('один профиль: выбранные уровни не убывают и соседи отличаются ≤ 2×', () => {
  const candidates = [1, 9, 2, 3, 20, 4, 6, 5, 8].map((d) => cand(d));
  const res = assignSlots(slotsOf(['*', '*', '*', '*']), candidates);
  assert.ok(res);
  const d = diffs(res);
  for (let i = 1; i < d.length; i++) {
    assert.ok(d[i] >= d[i - 1], `убывание ${d}`);
    assert.ok(d[i] <= Math.max(1, d[i - 1]) * 2, `скачок > 2× ${d}`);
  }
  assert.equal(new Set(res).size, res.length, 'кандидат использован дважды');
});

test('один профиль: старт от медианы, а не от самых лёгких', () => {
  const candidates = [1, 2, 3, 4, 5, 6, 7, 8].map((d) => cand(d));
  const res = assignSlots(slotsOf(['*', '*', '*', '*']), candidates);
  // Центральное окно из 4 кандидатов среди 8: индексы 2…5 → сложности 3…6.
  assert.deepEqual(diffs(res), [3, 4, 5, 6]);
});

test('кандидат попадает только в слот своего профиля (стены с 3-го слота)', () => {
  const candidates = [cand(5, 'walls', 1), cand(1, 'plain', 2), cand(2, 'plain', 3), cand(2, 'walls', 4), cand(3, 'plain', 5), cand(4, 'walls', 6)];
  const res = assignSlots(slotsOf(['plain', 'plain', 'walls', 'walls']), candidates);
  assert.ok(res);
  assert.deepEqual(res.map((c) => c.profile), ['plain', 'plain', 'walls', 'walls']);
  assert.deepEqual(diffs(res), [1, 2, 2, 4]);
});

test('чередующиеся профили: монотонность держится по всей главе', () => {
  const candidates = [];
  for (let d = 1; d <= 12; d++) {
    candidates.push(cand(d, 'even', 100 + d));
    candidates.push(cand(d, 'odd', 200 + d));
  }
  const res = assignSlots(slotsOf(['even', 'odd', 'even', 'odd', 'even', 'odd']), candidates);
  assert.ok(res);
  const d = diffs(res);
  for (let i = 1; i < d.length; i++) assert.ok(d[i] >= d[i - 1] && d[i] <= d[i - 1] * 2, `${d}`);
  assert.deepEqual(res.map((c) => c.profile), ['even', 'odd', 'even', 'odd', 'even', 'odd']);
});

test('нет подходящего набора → null; relaxed даёт ближайших и помечается вызывающим', () => {
  // После сложности 4 идёт профиль, где всё ≤ 2: монотонность невозможна.
  const candidates = [cand(4, 'a', 1), cand(5, 'a', 2), cand(1, 'b', 3), cand(2, 'b', 4)];
  assert.equal(assignSlots(slotsOf(['a', 'b']), candidates), null);
  const relaxed = assignSlots(slotsOf(['a', 'b']), candidates, { relaxed: true });
  assert.ok(relaxed);
  assert.equal(relaxed[0].profile, 'a');
  assert.equal(relaxed[1].profile, 'b');
  assert.equal(relaxed[1].difficulty, 2, 'ближайший по сложности к предыдущему');
});

test('профиль без кандидатов → null даже в relaxed; пустые слоты → []', () => {
  assert.equal(assignSlots(slotsOf(['a', 'zzz']), [cand(1, 'a'), cand(2, 'a')]), null);
  assert.equal(assignSlots(slotsOf(['a', 'zzz']), [cand(1, 'a'), cand(2, 'a')], { relaxed: true }), null);
  assert.equal(assignSlots(slotsOf(['zzz']), [cand(1, 'a')]), null);
  assert.deepEqual(assignSlots([], [cand(1)]), []);
});

test('скачок > 2× между соседями не допускается, даже если монотонно', () => {
  const candidates = [cand(1, '*', 1), cand(3, '*', 2)];
  assert.equal(assignSlots(slotsOf(['*', '*']), candidates), null);
  assert.ok(assignSlots(slotsOf(['*', '*']), [cand(1, '*', 1), cand(2, '*', 2)]));
  // Ноль считается единицей: 0 → 2 допустимо, 0 → 3 нет.
  assert.ok(assignSlots(slotsOf(['*', '*']), [cand(0, '*', 1), cand(2, '*', 2)]));
  assert.equal(assignSlots(slotsOf(['*', '*']), [cand(0, '*', 1), cand(3, '*', 2)]), null);
});

test('slotProfile: экспорт генератора или «*»', () => {
  assert.equal(slotProfile({}, { chapter: 2 }, 15), '*');
  const gen = { profile: (spec, levelIndex) => (levelIndex >= spec.wallsFromLevel ? 'walls' : 'plain') };
  assert.equal(slotProfile(gen, { wallsFromLevel: 15 }, 14), 'plain');
  assert.equal(slotProfile(gen, { wallsFromLevel: 15 }, 15), 'walls');
});

test('stripService убирает только служебные поля', () => {
  const level = { id: 'x', seed: 1, chapter: 2, difficulty: 3, tip: { ru: 'a' }, unique: true, n: 4, path: [0, 1] };
  assert.deepEqual(stripService(level), { n: 4, path: [0, 1] });
});
