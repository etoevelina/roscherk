// Проверка данных «Маршрута» в src/data/levels.json (§7.5): каждый zip-уровень кампании, пула и
// ежедневной валиден по сохранённому решению, имеет ровно одно решение, укладывается в кривую главы
// (§2.2) и порог тривиальности (§2.0); difficulty внутри главы не убывает; позиционные правила
// кривой (стены с 15-го, чередование профилей глав 4–5) выполняются по позиции уровня в наборе.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHAPTERS, POOL, DAILY, profile } from '../src/modes/zip.gen.js';
import { solve, validate, solutionOf } from '../src/modes/zip.solve.js';
import { decodeLevels } from '../src/core/levels.js';

const DATA = decodeLevels(JSON.parse(readFileSync(new URL('../src/data/levels.json', import.meta.url), 'utf8')));
const SETS = DATA.zip || { campaign: [], pool: [], daily: [] };
const STRAIGHT_LIMIT = 0.4;

/** Доля клеток пути в прямых отрезках из ≥ minLen клеток (как в zip.gen.js). */
function straightFraction(path, minLen) {
  const N = path.length;
  let cells = 0;
  let run = 2;
  for (let i = 2; i <= N; i++) {
    const same = i < N && path[i] - path[i - 1] === path[i - 1] - path[i - 2];
    if (same) run++;
    else {
      if (run >= minLen) cells += run;
      run = 2;
    }
  }
  return cells / N;
}

function specFor(kind, level, index) {
  if (kind === 'daily') return DAILY;
  const list = kind === 'campaign' ? CHAPTERS : POOL;
  const spec = list.find((c) => c.chapter === level.chapter);
  assert.ok(spec, `${kind}#${index + 1}: нет спека главы ${level.chapter}`);
  return spec;
}

test('levels.json: наборы zip полны — кампания 100, пул 150, ежедневная 40', () => {
  assert.equal(SETS.campaign.length, 100);
  assert.equal(SETS.pool.length, 150);
  assert.equal(SETS.daily.length, 40);
  const ids = new Set();
  for (const kind of ['campaign', 'pool', 'daily']) {
    for (const level of SETS[kind]) {
      assert.match(level.id, /^[0-9a-f]{8}$/);
      assert.ok(!ids.has(level.id), `дубликат id ${level.id}`);
      ids.add(level.id);
    }
  }
});

test('levels.json: каждый zip-уровень валиден по сохранённому решению и имеет ровно одно решение', () => {
  for (const kind of ['campaign', 'pool', 'daily']) {
    SETS[kind].forEach((level, i) => {
      const where = `${kind}#${i + 1} (${level.id})`;
      assert.ok(validate(level, solutionOf(level)), `${where}: эталон невалиден`);
      const res = solve(level, { maxNodes: 2_000_000, maxSolutions: 2 });
      assert.ok(res.complete, `${where}: солвер не завершился`);
      assert.deepEqual(res.solutions, [level.path], `${where}: решение не единственное`);
      assert.equal(res.difficulty, level.difficulty, `${where}: difficulty расходится`);
    });
  }
});

test('levels.json: кривая главы — размер поля, диапазон чисел, лимиты стен, порог сложности, прямолинейность', () => {
  for (const kind of ['campaign', 'pool', 'daily']) {
    SETS[kind].forEach((level, i) => {
      const where = `${kind}#${i + 1}`;
      const spec = specFor(kind, level, i);
      const n = spec.n;
      assert.equal(level.n, n, `${where}: n`);
      const K = level.marks.length;
      const marksCap = Math.max(spec.marksCap ?? spec.marksMax + 1, spec.profileMarksCap ?? 0);
      assert.ok(K >= spec.marksMin && K <= marksCap, `${where}: чисел ${K} вне [${spec.marksMin}, ${marksCap}]`);
      assert.ok(level.walls.length <= Math.min(n, spec.maxWalls), `${where}: стен ${level.walls.length}`);
      if (level.chapter === 1) assert.equal(level.walls.length, 0, `${where}: в главе 1 стен нет`);
      assert.ok(level.difficulty >= spec.minDifficulty, `${where}: difficulty ${level.difficulty} < ${spec.minDifficulty}`);
      assert.ok(straightFraction(level.path, n) <= STRAIGHT_LIMIT, `${where}: прямых отрезков больше 40 %`);
    });
  }
});

test('levels.json: difficulty не убывает внутри главы кампании и пула; главы идут по порядку', () => {
  for (const kind of ['campaign', 'pool']) {
    const list = SETS[kind];
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      assert.ok(b.chapter >= a.chapter, `${kind}#${i + 1}: глава ${b.chapter} после ${a.chapter}`);
      if (a.chapter === b.chapter) assert.ok(b.difficulty >= a.difficulty, `${kind}#${i + 1}: difficulty ${b.difficulty} < ${a.difficulty}`);
    }
  }
  const expected = CHAPTERS.flatMap((c) => Array(c.to - c.from + 1).fill(c.chapter));
  assert.deepEqual(SETS.campaign.map((l) => l.chapter), expected, 'главы кампании — по диапазонам CHAPTERS');
});

test('levels.json: обязательные tip кампании — уровень 1 и первые стены', () => {
  const c = SETS.campaign;
  assert.equal(c[0].tip?.ru, `Проведи пальцем дорожку от 1 до ${c[0].marks.length} через все клетки, не отрывая`);
  const firstWalls = c.findIndex((l) => l.walls.length > 0);
  assert.ok(firstWalls > 0, 'стены в кампании есть');
  assert.equal(c[firstWalls].tip?.ru, 'Сквозь толстые линии нельзя');
  assert.equal(c.filter((l) => l.tip?.ru === 'Сквозь толстые линии нельзя').length, 1);
});

// Регрессия: позиционные правила кривой (§2.2) выполняются в данных поставки, а не только в
// генераторе. tools/generate.mjs раздаёт кандидатов по слотам с ключом profile(spec, levelIndex),
// поэтому позиция уровня в кампании обязана соответствовать его профилю: стены в главе 2 — ровно
// с 15-го уровня, в главах 4–5 чётные уровни — «много чисел, мало стен», нечётные — «мало чисел,
// стены до лимита». Раньше levels.json был собран без отбора по слотам (стены с 7-го, tip на #7).
test('levels.json: кривая по позиции в кампании — стены в главе 2 с 15-го уровня, чередование профилей глав 4–5', () => {
  const c = SETS.campaign;
  const ch2 = CHAPTERS.find((s) => s.chapter === 2);
  assert.equal(ch2.wallsFromLevel, 15);
  for (let idx = 1; idx < ch2.wallsFromLevel; idx++) {
    assert.equal(c[idx - 1].walls.length, 0, `#${idx}: стены до ${ch2.wallsFromLevel}-го уровня`);
  }
  for (let idx = ch2.wallsFromLevel; idx <= 100; idx++) {
    assert.ok(c[idx - 1].walls.length >= 1, `#${idx}: с ${ch2.wallsFromLevel}-го уровня стены есть на каждом уровне`);
  }
  // Первые стены — ровно на 15-м, и tip «Сквозь толстые линии нельзя» стоит именно там.
  assert.equal(c.findIndex((l) => l.walls.length > 0) + 1, ch2.wallsFromLevel, 'первые стены — на уровне wallsFromLevel');
  assert.equal(c[ch2.wallsFromLevel - 1].tip?.ru, 'Сквозь толстые линии нельзя');

  for (const spec of CHAPTERS.filter((s) => s.profiles)) {
    for (let idx = spec.from; idx <= spec.to; idx++) {
      const level = c[idx - 1];
      if (idx % 2 === 0) {
        assert.equal(profile(spec, idx), 'marks', `#${idx}: чётный уровень — профиль «много чисел»`);
        assert.ok(level.walls.length <= (spec.profileWalls ?? 2), `#${idx}: профиль «много чисел»: стен ${level.walls.length}`);
        assert.ok(level.marks.length >= spec.marksMax - 1, `#${idx}: профиль «много чисел»: чисел ${level.marks.length}`);
      } else {
        assert.equal(profile(spec, idx), 'walls', `#${idx}: нечётный уровень — профиль «мало чисел»`);
        assert.ok(level.walls.length >= Math.ceil(spec.maxWalls / 2), `#${idx}: профиль «мало чисел»: стен ${level.walls.length}`);
      }
    }
  }
});

/**
 * Позиционные правила §2.2 для уровня на позиции levelIndex внутри спека по ключу profile():
 * 'base' / 'no-walls' — без стен; 'walls' — стены есть (в главах 4–5 — ≥ половины лимита);
 * 'marks' — стен не больше profileWalls, чисел не меньше marksMax − 1.
 */
function assertCurvePosition(spec, levelIndex, level, where) {
  const key = profile(spec, levelIndex);
  const walls = level.walls.length;
  if (key === 'base' || key === 'no-walls') {
    assert.equal(walls, 0, `${where}: профиль ${key} — без стен`);
    return;
  }
  assert.ok(walls >= 1, `${where}: профиль ${key} без стен`);
  if (key === 'marks') {
    assert.ok(walls <= (spec.profileWalls ?? 2), `${where}: профиль «много чисел»: стен ${walls}`);
    assert.ok(level.marks.length >= spec.marksMax - 1, `${where}: профиль «много чисел»: чисел ${level.marks.length}`);
  } else if (spec.profiles) {
    assert.ok(walls >= Math.ceil(spec.maxWalls / 2), `${where}: профиль «мало чисел»: стен ${walls}`);
  }
}

// Пул «Бесконечности» и ежедневная генерируются с levelIndex = порядковый номер в наборе спека (§5.2),
// поэтому в пуле главы 2 стены — с 15-го уровня набора, в пулах глав 4–5 профили чередуются,
// а в ежедневной (глава 3) стены есть на каждом уровне.
test('levels.json: кривая по позиции в пуле и ежедневной — ключ profile() соответствует порядковому номеру в наборе', () => {
  let offset = 0;
  for (const spec of POOL) {
    const list = SETS.pool.slice(offset, offset + spec.count);
    assert.equal(list.length, spec.count, `пул главы ${spec.chapter}: уровней ${list.length}`);
    list.forEach((level, i) => {
      assert.equal(level.chapter, spec.chapter, `pool#${offset + i + 1}: глава ${level.chapter}`);
      assertCurvePosition(spec, i + 1, level, `pool#${offset + i + 1}`);
    });
    offset += spec.count;
  }
  const ch2 = POOL.find((s) => s.chapter === 2);
  const ch2Offset = POOL.slice(0, POOL.indexOf(ch2)).reduce((s, p) => s + p.count, 0);
  const ch2Walls = SETS.pool.slice(ch2Offset, ch2Offset + ch2.count).map((l) => l.walls.length > 0);
  assert.equal(ch2Walls.indexOf(true) + 1, ch2.wallsFromLevel, 'пул главы 2: первые стены на 15-й позиции набора');
  assert.ok(ch2Walls.slice(ch2.wallsFromLevel - 1).every(Boolean), 'пул главы 2: с 15-й позиции стены есть везде');

  SETS.daily.forEach((level, i) => {
    assert.equal(level.chapter, DAILY.chapter, `daily#${i + 1}: глава ${level.chapter}`);
    assertCurvePosition(DAILY, i + 1, level, `daily#${i + 1}`);
  });
});
