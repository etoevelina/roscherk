// Тесты генератора «Потоков» (§2.3, §5.2, §7.3): по 2 уровня на главу — валидность, difficulty,
// уникальность, фильтры качества, детерминизм и хэш коммитнутой выборки; структура CHAPTERS/POOL/DAILY; tipFor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTERS, POOL, DAILY, generate, tipFor, profile, hamiltonianPath, cutPath, qualityOk, splitAtDivergence } from '../src/modes/flow.gen.js';
import { solve, validate } from '../src/modes/flow.solve.js';
import { mulberry32, hash32 } from '../src/core/rng.js';
import { areAdjacent } from '../src/core/grid.js';

const MASTER = 20261012;

/** Генерирует count принятых уровней для spec, перебирая попытки от фиксированного seed. */
function generateSome(spec, count, kind = 'campaign') {
  const levels = [];
  let attempts = 0;
  while (levels.length < count && attempts < 60) {
    attempts++;
    const seed = hash32(MASTER, 'flow', kind, spec.chapter, attempts);
    const level = generate(seed, spec, spec.from ? spec.from + levels.length : 0);
    if (level) levels.push({ seed, level });
  }
  return { levels, attempts };
}

let sampleCache = null;
/** Фиксированная выборка §7.3: по 2 уровня кампании на главу (генерируется один раз на процесс). */
function sampleLevels() {
  if (!sampleCache) sampleCache = CHAPTERS.map((spec) => generateSome(spec, 2).levels);
  return sampleCache;
}

test('CHAPTERS: кривая §2.3 — 100 уровней, размеры и число потоков по главам', () => {
  assert.equal(CHAPTERS.length, 5);
  assert.equal(CHAPTERS[0].from, 1);
  assert.equal(CHAPTERS[4].to, 100);
  for (let i = 1; i < CHAPTERS.length; i++) assert.equal(CHAPTERS[i].from, CHAPTERS[i - 1].to + 1);
  assert.deepEqual(
    CHAPTERS.map((c) => [c.n, c.minFlows, c.maxFlows]),
    [
      [5, 4, 6],
      [6, 4, 6],
      [7, 5, 8],
      [8, 6, 10],
      [9, 9, 12],
    ],
  );
  for (const c of CHAPTERS.slice(1)) assert.ok(c.minDifficulty >= 2, 'порог тривиальности ≥ 2 с главы 2');
});

test('POOL — 150 уровней по главам, DAILY — 40 уровней главы 3', () => {
  assert.equal(POOL.reduce((sum, p) => sum + p.count, 0), 150);
  assert.deepEqual(POOL.map((p) => p.chapter), [1, 2, 3, 4, 5]);
  for (const p of POOL) {
    const base = CHAPTERS[p.chapter - 1];
    assert.equal(p.n, base.n);
    assert.equal(p.minDifficulty, base.minDifficulty);
  }
  assert.equal(DAILY.chapter, 3);
  assert.equal(DAILY.count, 40);
  assert.equal(DAILY.n, 7);
});

test('hamiltonianPath: гамильтонов путь по сетке, детерминирован', () => {
  for (const n of [3, 5, 9]) {
    const path = hamiltonianPath(mulberry32(n * 17), n);
    assert.equal(path.length, n * n);
    assert.equal(new Set(path).size, n * n);
    for (let i = 1; i < path.length; i++) assert.ok(areAdjacent(path[i - 1], path[i], n));
  }
  assert.deepEqual(hamiltonianPath(mulberry32(5), 6), hamiltonianPath(mulberry32(5), 6));
  assert.notDeepEqual(hamiltonianPath(mulberry32(5), 6), hamiltonianPath(mulberry32(6), 6));
});

test('cutPath: сегменты ≥ 3 клеток, покрывают путь; null при нехватке клеток', () => {
  const rng = mulberry32(3);
  const path = hamiltonianPath(rng, 5);
  const flows = cutPath(path, 6, rng);
  assert.equal(flows.length, 6);
  assert.deepEqual(flows.flat(), path);
  for (const f of flows) assert.ok(f.length >= 3);
  assert.equal(cutPath(path, 9, rng), null);
});

test('qualityOk: отвергает прямые и скученные точки, принимает извилистые', () => {
  // Три прямых потока 3×3 — все прямые, нет поворотов.
  assert.ok(!qualityOk([[0, 3, 6], [1, 4, 7], [2, 5, 8]], 3));
  // Поток длины 2.
  assert.ok(!qualityOk([[0, 1], [2, 5, 4, 3, 6, 7, 8]], 3));
  // Два извилистых потока 4×4, точки не скучены: 0..3 — змейка в нижней половине.
  const good = [
    [0, 1, 5, 4, 8, 9, 13, 12],
    [3, 2, 6, 7, 11, 10, 14, 15],
  ];
  assert.ok(qualityOk(good, 4));
});

test('splitAtDivergence: режет поток в клетке первого расхождения, оба куска ≥ 3', () => {
  const ref = [[0, 1, 2, 3, 7, 6, 5, 4], [8, 9, 10, 11, 15, 14, 13, 12]];
  assert.equal(splitAtDivergence(ref, [ref.map((p) => p.slice())], 4), null, 'одинаковая раскраска — расхождения нет');
  // Другое заполнение: клетки 10, 11, 14, 15 перекрашены в поток 0 — первое расхождение в клетке 10.
  const alt = [[0, 1, 2, 3, 7, 11, 15, 14, 10, 6, 5, 4], [8, 9, 13, 12]];
  const next = splitAtDivergence(ref, [ref, alt], 4);
  assert.ok(next);
  assert.equal(next.length, 3);
  assert.deepEqual(next[0], ref[0]);
  assert.deepEqual(next[1], [8, 9, 10], 'клетка расхождения стала концом первого куска');
  assert.deepEqual(next[2], [11, 15, 14, 13, 12]);
  // Короткие потоки (< 6 клеток) не режутся.
  const short = [[0, 1, 2, 5, 4, 3], [6, 7, 8]];
  const shortAlt = [[0, 1, 2, 5, 8, 7, 4, 3], [6]];
  assert.equal(splitAtDivergence(short, [shortAlt], 3), null);
});

test('generate: по 2 уровня на главу — валидны, difficulty ≥ порога, уникальны (n ≤ 8), качество', () => {
  const sample = sampleLevels();
  for (let i = 0; i < CHAPTERS.length; i++) {
    const spec = CHAPTERS[i];
    const levels = sample[i];
    assert.equal(levels.length, 2, `глава ${spec.chapter}: не удалось получить 2 уровня`);
    for (const { level } of levels) {
      assert.equal(level.n, spec.n);
      assert.ok(level.flows.length >= spec.minFlows && level.flows.length <= spec.maxFlows);
      assert.ok(validate(level, level.flows), 'эталон валиден');
      assert.ok(qualityOk(level.flows, level.n));
      assert.equal(level.flows.flat().length, level.n * level.n);
      const res = solve(level, { maxNodes: 5e6, maxSolutions: 2 });
      assert.ok(res.difficulty >= spec.minDifficulty, `глава ${spec.chapter}: difficulty ${res.difficulty} < ${spec.minDifficulty}`);
      if (spec.n <= 8 || level.unique) {
        assert.equal(level.unique, true);
        assert.equal(res.solutions.length, 1, 'ровно одно решение');
        assert.ok(res.complete);
      } else {
        assert.equal(res.complete, false, 'unique:false только при обрыве по лимиту');
      }
      assert.deepEqual(Object.keys(level).sort(), ['flows', 'n', 'unique'], 'без служебных полей');
    }
  }
});

test('generate: детерминизм — одинаковый seed даёт одинаковый JSON, разные seed — разные уровни', () => {
  const spec = CHAPTERS[2];
  const a = generate(123456, spec, 36);
  const b = generate(123456, spec, 36);
  assert.ok(a);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  let other = null;
  for (let seed = 1; seed < 20 && !other; seed++) other = generate(seed, spec, 36);
  assert.ok(other);
  assert.notEqual(JSON.stringify(a), JSON.stringify(other));
});

test('generate: хэш фиксированной выборки (§7.3) — 2 уровня на главу совпадают с коммитнутым digest', () => {
  const sample = sampleLevels().flat().map(({ level }) => level);
  assert.equal(sample.length, 10);
  // Повторная генерация по тем же seed даёт те же уровни.
  for (let i = 0; i < CHAPTERS.length; i++) {
    const spec = CHAPTERS[i];
    for (let k = 0; k < 2; k++) {
      const { seed, level } = sampleLevels()[i][k];
      assert.equal(JSON.stringify(generate(seed, spec, spec.from + k)), JSON.stringify(level));
    }
  }
  const digest = hash32(JSON.stringify(sample)).toString(16).padStart(8, '0');
  // Меняется только при намеренном изменении генератора/солвера — тогда нужна перегенерация levels.json.
  assert.equal(digest, 'b8d81990');
});

test('generate: пул и daily используют те же параметры, уровни валидны', () => {
  const { levels } = generateSome(DAILY, 1, 'daily');
  assert.equal(levels.length, 1);
  assert.equal(levels[0].level.n, 7);
  assert.ok(validate(levels[0].level, levels[0].level.flows));
  const pool = generateSome(POOL[0], 1, 'pool');
  assert.equal(pool.levels.length, 1);
  assert.equal(pool.levels[0].level.n, 5);
});

test('tipFor: обязательные подсказки уровней 1 и 2, иначе undefined', () => {
  const level = { n: 5, flows: [] };
  assert.deepEqual(tipFor(level, 1, []), { ru: 'Соедини пары одного цвета и заполни все клетки' });
  assert.deepEqual(tipFor(level, 2, [level]), { ru: 'Веди по чужой дорожке, чтобы разрезать её' });
  assert.equal(tipFor(level, 3, []), undefined);
  assert.equal(tipFor(level, 50, []), undefined);
});

test('profile: у «Потоков» нет позиционных правил — один ключ слота для любого levelIndex (§5.2)', () => {
  for (const spec of [...CHAPTERS, ...POOL, DAILY]) {
    assert.equal(profile(spec, 1), 'any');
    assert.equal(profile(spec, 100), profile(spec, 1));
  }
});
