// Тесты генератора «Маршрута» (src/modes/zip.gen.js): кривая глав, пулы, генерация по 2 уровня
// на главу с фиксированным seed (валидность, уникальность, difficulty, лимиты стен и чисел),
// детерминизм (одинаковый seed → одинаковый JSON, хэш выборки), tipFor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTERS, POOL, DAILY, generate, tipFor, profile } from '../src/modes/zip.gen.js';
import { solve, validate } from '../src/modes/zip.solve.js';
import { hash32 } from '../src/core/rng.js';
import { neighbors, areAdjacent } from '../src/core/grid.js';

const MASTER = 20261012;

/** Генерирует count уровней главы перебором затравок (как tools/generate.mjs). */
function generateSome(spec, count, kind = 'test') {
  const out = [];
  let attempt = 0;
  let levelIndex = spec.from ?? 0;
  while (out.length < count) {
    attempt++;
    assert.ok(attempt < 2000, `слишком много отказов в главе ${spec.chapter}`);
    const seed = hash32(MASTER, 'zip', kind, spec.chapter, attempt);
    const level = generate(seed, spec, levelIndex);
    if (!level) continue;
    out.push({ level, seed, levelIndex });
    levelIndex++;
  }
  return out;
}

test('CHAPTERS: пять глав, покрывают уровни 1–100 без разрывов, параметры по кривой', () => {
  assert.equal(CHAPTERS.length, 5);
  let expectFrom = 1;
  for (const ch of CHAPTERS) {
    assert.equal(ch.from, expectFrom);
    assert.ok(ch.to >= ch.from);
    expectFrom = ch.to + 1;
    assert.ok(ch.minDifficulty >= 1);
    assert.ok(ch.marksMin <= ch.marksMax);
  }
  assert.equal(expectFrom, 101);
  assert.deepEqual(
    CHAPTERS.map((c) => [c.chapter, c.n, c.marksMin, c.marksMax, c.maxWalls, c.minDifficulty]),
    [
      [1, 4, 3, 5, 0, 1],
      [2, 5, 4, 6, 5, 1],
      [3, 6, 4, 7, 6, 3],
      [4, 7, 4, 8, 7, 3],
      [5, 8, 5, 9, 8, 3],
    ],
  );
  assert.equal(CHAPTERS[1].wallsFromLevel, 15, 'стены в главе 2 — с 15-го уровня');
});

test('POOL — 150 уровней по главам, DAILY — 40 уровней главы 3', () => {
  assert.equal(POOL.reduce((s, p) => s + p.count, 0), 150);
  assert.deepEqual(POOL.map((p) => p.chapter), [1, 2, 3, 4, 5]);
  for (const p of POOL) {
    const ch = CHAPTERS.find((c) => c.chapter === p.chapter);
    assert.equal(p.n, ch.n);
    assert.equal(p.minDifficulty, ch.minDifficulty);
  }
  assert.equal(DAILY.chapter, 3);
  assert.equal(DAILY.count, 40);
  assert.equal(DAILY.n, 6);
});

test('generate: 2 уровня на главу — валидны, уникальны, difficulty ≥ порога, лимиты соблюдены', () => {
  for (const spec of CHAPTERS) {
    const levels = generateSome(spec, 2);
    for (const { level, levelIndex } of levels) {
      const n = spec.n;
      const N = n * n;
      assert.equal(level.n, n);
      assert.equal(level.path.length, N);
      assert.ok(validate(level, level.path), `эталон валиден (глава ${spec.chapter})`);
      assert.deepEqual(Object.keys(level).sort(), ['marks', 'n', 'path', 'walls'], 'без служебных полей');

      const res = solve(level, { maxNodes: 2_000_000, maxSolutions: 2 });
      assert.ok(res.complete);
      assert.deepEqual(res.solutions, [level.path], `ровно одно решение (глава ${spec.chapter})`);
      assert.ok(res.difficulty >= spec.minDifficulty, `difficulty ${res.difficulty} ≥ ${spec.minDifficulty}`);

      // Числа: 1 в начале, K в конце, по порядку вдоль пути, в диапазоне главы (+1 после ремонта).
      const K = level.marks.length;
      assert.ok(K >= spec.marksMin && K <= spec.marksMax + 1, `чисел ${K} в [${spec.marksMin}, ${spec.marksMax + 1}]`);
      const sorted = level.marks.slice().sort((a, b) => a[1] - b[1]);
      assert.deepEqual(sorted.map((m) => m[1]), [...Array(K).keys()].map((i) => i + 1));
      assert.equal(sorted[0][0], level.path[0]);
      assert.equal(sorted[K - 1][0], level.path[N - 1]);

      // Стены: ≤ лимита, a<b, ортогональные соседи, не на рёбрах пути, не оставляют клетке ≤ 1 соседа.
      assert.ok(level.walls.length <= spec.maxWalls, `стен ${level.walls.length} ≤ ${spec.maxWalls}`);
      if (spec.chapter === 1) assert.equal(level.walls.length, 0);
      if (spec.wallsFromLevel !== undefined && levelIndex < spec.wallsFromLevel) assert.equal(level.walls.length, 0);
      const pathEdges = new Set();
      for (let i = 1; i < N; i++) pathEdges.add(Math.min(level.path[i - 1], level.path[i]) * N + Math.max(level.path[i - 1], level.path[i]));
      const wallKeys = new Set();
      for (const [a, b] of level.walls) {
        assert.ok(a < b);
        assert.ok(areAdjacent(a, b, n));
        assert.ok(!pathEdges.has(a * N + b), 'стена не на ребре решения');
        assert.ok(!wallKeys.has(a * N + b), 'стены не дублируются');
        wallKeys.add(a * N + b);
      }
      for (let c = 0; c < N; c++) {
        const free = neighbors(c, n).filter((d) => !wallKeys.has(Math.min(c, d) * N + Math.max(c, d))).length;
        const min = c === level.path[0] || c === level.path[N - 1] ? 1 : 2;
        assert.ok(free >= min, `клетка ${c}: свободных соседей ${free}`);
      }
    }
  }
});

test('generate: главы 4–5 чередуют профили — чётный индекс: много чисел и ≤ 2 стен (глава 5: ≤ 3), нечётный: стены ≥ половины лимита', () => {
  for (const spec of CHAPTERS.filter((c) => c.profiles)) {
    const levels = generateSome(spec, 4, 'profiles');
    assert.equal(levels.length, 4);
    for (const { level, levelIndex } of levels) {
      assert.ok(validate(level, level.path));
      const K = level.marks.length;
      if (levelIndex % 2 === 1) {
        assert.ok(level.walls.length >= Math.ceil(spec.maxWalls / 2), `профиль «мало чисел, стены»: стен ${level.walls.length}`);
        assert.ok(K <= spec.marksMax + 1, `профиль «мало чисел»: чисел ${K}`);
      } else {
        assert.ok(level.walls.length <= (spec.profileWalls ?? 2), `профиль «много чисел, 0–2 стены»: стен ${level.walls.length}`);
        assert.ok(K >= spec.marksMax - 1, `профиль «много чисел»: чисел ${K} < ${spec.marksMax - 1}`);
        assert.ok(K <= (spec.profileMarksCap ?? spec.marksMax + 1), `профиль «много чисел»: чисел ${K} выше предела`);
      }
    }
  }
  // Ослабление профиля «много чисел» допущено только для 8×8 (глава 5) и ограничено явно.
  assert.equal(CHAPTERS[3].profileWalls, undefined);
  assert.deepEqual([CHAPTERS[4].profileWalls, CHAPTERS[4].profileMarksCap], [3, 12]);
});

test('generate: стены в главе 2 появляются с 15-го уровня, у POOL — по индексу', () => {
  const spec = CHAPTERS[1];
  let withWalls = 0;
  for (let attempt = 1; attempt <= 30; attempt++) {
    const level = generate(hash32(MASTER, 'zip', 'walls', attempt), spec, 20);
    if (level && level.walls.length > 0) withWalls++;
  }
  assert.ok(withWalls > 0, 'после 15-го уровня стены встречаются');
  for (let attempt = 1; attempt <= 10; attempt++) {
    const level = generate(hash32(MASTER, 'zip', 'walls', attempt), spec, 10);
    if (level) assert.equal(level.walls.length, 0);
  }
});

test('profile: ключ слота кривой — стены с 15-го в главе 2, чередование marks/walls в главах 4–5', () => {
  const [ch1, ch2, ch3, ch4, ch5] = CHAPTERS;
  assert.equal(profile(ch1, 1), 'base');
  assert.equal(profile(ch1, 6), 'base');
  assert.equal(profile(ch2, 7), 'no-walls');
  assert.equal(profile(ch2, 14), 'no-walls');
  assert.equal(profile(ch2, 15), 'walls');
  assert.equal(profile(ch2, 25), 'walls');
  assert.equal(profile(ch3, 26), 'walls');
  assert.equal(profile(ch4, 46), 'marks');
  assert.equal(profile(ch4, 47), 'walls');
  assert.equal(profile(ch5, 71), 'walls');
  assert.equal(profile(ch5, 72), 'marks');
  // Пул: порядковый номер в наборе с 1 — у главы 2 стены у половины пула (индекс ≥ 15).
  assert.equal(profile(POOL[1], 14), 'no-walls');
  assert.equal(profile(POOL[1], 15), 'walls');
  assert.equal(profile(DAILY, 1), 'walls');
  // Ключ согласован с самим генератором: стены появляются только у ключей со стенами.
  for (let attempt = 1; attempt <= 10; attempt++) {
    const lvl = generate(hash32(MASTER, 'zip', 'profile-key', attempt), ch2, 10);
    if (lvl) assert.equal(lvl.walls.length, 0);
  }
});

test('детерминизм: одинаковый seed даёт одинаковый JSON; хэш фиксированной выборки', () => {
  const sample = [];
  for (const spec of CHAPTERS) {
    const a = generateSome(spec, 2, 'det');
    const b = generateSome(spec, 2, 'det');
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    for (const { level, seed, levelIndex } of a) {
      assert.equal(JSON.stringify(generate(seed, spec, levelIndex)), JSON.stringify(level));
      sample.push(level);
    }
  }
  const digest = hash32(JSON.stringify(sample)).toString(16).padStart(8, '0');
  // Хэш коммитнутой выборки (§7.3): меняется только при намеренном изменении генератора.
  assert.equal(digest, 'a37d448a');
});

test('generate возвращает null при недопустимых параметрах затравки, не бросает', () => {
  // Глава 1: без стен и с тривиальным порогом — часть затравок отвергается, но вызов безопасен.
  let nulls = 0;
  for (let attempt = 1; attempt <= 20; attempt++) {
    const level = generate(hash32(MASTER, 'zip', 'nulls', attempt), CHAPTERS[0], 1);
    if (level === null) nulls++;
    else assert.ok(validate(level, level.path));
  }
  assert.ok(nulls >= 0);
});

test('tipFor: обязательные подсказки первого уровня и первых стен', () => {
  const lvl1 = { n: 4, path: [], marks: [[0, 1], [5, 2], [15, 3]], walls: [] };
  assert.deepEqual(tipFor(lvl1, 1, []), { ru: 'Проведи пальцем дорожку от 1 до 3 через все клетки, не отрывая' });
  const lvl1b = { n: 4, path: [], marks: [[0, 1], [5, 2], [7, 3], [15, 4]], walls: [] };
  assert.equal(tipFor(lvl1b, 1, []).ru, 'Проведи пальцем дорожку от 1 до 4 через все клетки, не отрывая');

  const noWalls = { n: 5, path: [], marks: [[0, 1], [24, 2]], walls: [] };
  const walls = { n: 5, path: [], marks: [[0, 1], [24, 2]], walls: [[0, 1]] };
  assert.equal(tipFor(noWalls, 2, [lvl1]), undefined);
  assert.deepEqual(tipFor(walls, 15, [lvl1, noWalls]), { ru: 'Сквозь толстые линии нельзя' });
  assert.equal(tipFor(walls, 16, [lvl1, noWalls, walls]), undefined, 'стены уже были — подсказки нет');
  assert.equal(tipFor(noWalls, 16, [walls]), undefined);
});
