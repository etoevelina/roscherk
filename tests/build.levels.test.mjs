// §7 п.5: все уровни src/data/levels.json валидны по сохранённому решению (солвер не запускается —
// секунды), id = sha1 содержимого без служебных полей, главы 1–5, размеры наборов 100/150/40,
// поле unique только у режимов с best-effort уникальностью (flow). Плюс регрессия на отбор по
// слотам (§5.5): seed каждого уровня принадлежит слоту с профилем его позиции, а позиционные
// правила кривой (§2.2 стены с 15-го и профили глав 4–5; §2.4 стрелки, старт, closed, порог)
// выполняются в данных поставки, а не только в генераторе.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodeLevels, modeSets } from '../src/core/levels.js';
import { contentId } from '../src/core/hash.js';
import { stripService, candidateSeed, slotProfile, MAX_ATTEMPT_FACTOR } from '../tools/generate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED = { campaign: 100, pool: 150, daily: 40 };

let data;
let modes = [];
const solvers = {};
const gens = {};

before(async () => {
  const path = resolve(ROOT, 'src/data/levels.json');
  assert.ok(existsSync(path), 'нет src/data/levels.json — выполните npm run gen');
  data = decodeLevels(JSON.parse(readFileSync(path, 'utf8')));
  modes = Object.keys(data).filter((k) => k !== 'meta');
  for (const id of modes) {
    solvers[id] = await import(pathToFileURL(resolve(ROOT, `src/modes/${id}.solve.js`)).href);
    gens[id] = await import(pathToFileURL(resolve(ROOT, `src/modes/${id}.gen.js`)).href);
  }
});

test('levels.json: meta и три режима', () => {
  assert.ok(data.meta && Number.isInteger(data.meta.masterSeed));
  assert.deepEqual([...modes].sort(), ['flow', 'stroke', 'zip']);
});

test('размеры наборов: 100 кампании, 150 пула, 40 ежедневных на режим', () => {
  for (const id of modes) {
    const sets = modeSets(data, id);
    for (const [kind, count] of Object.entries(EXPECTED)) {
      assert.equal(sets[kind].length, count, `${id}/${kind}`);
    }
  }
});

test('каждый уровень валиден по сохранённому решению, id совпадает с содержимым, глава 1–5', () => {
  let checked = 0;
  for (const id of modes) {
    const { validate, solutionOf } = solvers[id];
    const sets = modeSets(data, id);
    for (const kind of Object.keys(EXPECTED)) {
      for (let i = 0; i < sets[kind].length; i++) {
        const level = sets[kind][i];
        const where = `${id}/${kind}#${i + 1} (${level.id})`;
        assert.equal(validate(level, solutionOf(level)), true, `${where}: эталон невалиден`);
        assert.equal(level.id, contentId(stripService(level)), `${where}: id не совпадает с содержимым`);
        assert.ok(Number.isInteger(level.chapter) && level.chapter >= 1 && level.chapter <= 5, `${where}: chapter ${level.chapter}`);
        assert.ok(Number.isInteger(level.difficulty) && level.difficulty >= 0, `${where}: difficulty ${level.difficulty}`);
        assert.ok(Number.isInteger(level.seed), `${where}: seed`);
        checked++;
      }
    }
  }
  assert.equal(checked, modes.length * (100 + 150 + 40));
});

test('id уникальны внутри режима; поле unique — только у режимов с allowNonUnique', () => {
  for (const id of modes) {
    const sets = modeSets(data, id);
    const all = [...sets.campaign, ...sets.pool, ...sets.daily];
    assert.equal(new Set(all.map((l) => l.id)).size, all.length, `${id}: дубликаты id`);
    const gen = gens[id];
    const expectsUnique = gen.UNIQUE_REQUIRED !== false && typeof gen.allowNonUnique === 'function';
    for (const level of all) {
      if (expectsUnique) assert.equal(typeof level.unique, 'boolean', `${id} ${level.id}: нет поля unique`);
      else assert.equal(level.unique, undefined, `${id} ${level.id}: лишнее поле unique`);
    }
  }
});

test('кампания: главы идут по порядку, difficulty не ниже порога главы и не убывает внутри главы', () => {
  for (const id of modes) {
    const sets = modeSets(data, id);
    const chapters = gens[id].CHAPTERS;
    let prev = null;
    for (let i = 0; i < sets.campaign.length; i++) {
      const level = sets.campaign[i];
      const spec = chapters.find((c) => i + 1 >= c.from && i + 1 <= c.to);
      assert.ok(spec, `${id}#${i + 1}: нет спека главы`);
      assert.equal(level.chapter, spec.chapter, `${id}#${i + 1}: chapter ${level.chapter} ≠ ${spec.chapter}`);
      assert.ok(level.difficulty >= (spec.minDifficulty ?? 0), `${id}#${i + 1}: difficulty ${level.difficulty} < порога`);
      if (prev && prev.chapter === level.chapter) {
        assert.ok(level.difficulty >= prev.difficulty, `${id}#${i + 1}: difficulty убывает внутри главы`);
      }
      prev = level;
    }
  }
});

test('обязательные tip первых уровней кампании (§3.1 п.7)', () => {
  for (const id of modes) {
    const first = modeSets(data, id).campaign[0];
    assert.ok(first.tip && typeof first.tip.ru === 'string' && first.tip.ru.length > 0, `${id}: нет tip у уровня 1`);
  }
});

/**
 * Спеки набора в порядке levels.json: [{ spec, need, firstIndex, offset }] — как план в generateAll.
 * offset — индекс первого уровня спека внутри набора.
 */
function specPlan(gen, kind) {
  const plan = [];
  let offset = 0;
  const push = (spec, need, firstIndex) => {
    plan.push({ spec, need, firstIndex, offset });
    offset += need;
  };
  if (kind === 'campaign') for (const spec of gen.CHAPTERS) push(spec, spec.to - spec.from + 1, spec.from);
  else if (kind === 'pool') for (const spec of gen.POOL) push(spec, spec.count, 1);
  else push(gen.DAILY, gen.DAILY.count, 1);
  return plan;
}

/** Номер попытки, давшей seed уровня, или −1. */
function attemptOf(masterSeed, modeId, kind, chapter, seed, maxAttempts) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (candidateSeed(masterSeed, modeId, kind, chapter, attempt) === seed) return attempt;
  }
  return -1;
}

test('отбор по слотам (§5.5): seed уровня восстанавливает слот, и профиль слота = профилю позиции уровня', () => {
  for (const id of modes) {
    const gen = gens[id];
    const sets = modeSets(data, id);
    for (const kind of Object.keys(EXPECTED)) {
      for (const { spec, need, firstIndex, offset } of specPlan(gen, kind)) {
        const list = sets[kind].slice(offset, offset + need);
        assert.equal(list.length, need, `${id}/${kind}/глава ${spec.chapter}: уровней ${list.length}, ожидалось ${need}`);
        list.forEach((level, i) => {
          const position = firstIndex + i;
          const where = `${id}/${kind}#${offset + i + 1} (${level.id})`;
          assert.equal(level.chapter, spec.chapter, `${where}: chapter ${level.chapter} ≠ ${spec.chapter}`);
          const attempt = attemptOf(data.meta.masterSeed, id, kind, spec.chapter, level.seed, need * MAX_ATTEMPT_FACTOR);
          assert.ok(attempt >= 0, `${where}: seed ${level.seed} не из hash(masterSeed, mode, kind, chapter, attempt) — данные устарели, выполните npm run gen`);
          const slot = firstIndex + (attempt % need);
          assert.equal(
            slotProfile(gen, spec, slot),
            slotProfile(gen, spec, position),
            `${where}: сгенерирован под слот ${slot}, стоит на позиции ${position} с другим профилем кривой`,
          );
        });
      }
    }
  }
});

/** Позиционные правила §2.2 для zip-уровня на позиции levelIndex (ключ профиля из zip.gen.js). */
function checkZipCurve(gen, spec, levelIndex, level, where) {
  const key = gen.profile(spec, levelIndex);
  const walls = level.walls.length;
  if (key === 'base' || key === 'no-walls') assert.equal(walls, 0, `${where}: стены до ${spec.wallsFromLevel ?? 'разрешения'} (профиль ${key})`);
  else assert.ok(walls >= 1, `${where}: профиль ${key} без стен`);
  if (key === 'marks') {
    assert.ok(walls <= (spec.profileWalls ?? 2), `${where}: профиль «много чисел»: стен ${walls}`);
    assert.ok(level.marks.length >= spec.marksMax - 1, `${where}: профиль «много чисел»: чисел ${level.marks.length}`);
  }
}

/** Позиционные правила §2.4 для stroke-уровня: стрелки, фиксированный старт, closed, порог сложности. */
function checkStrokeCurve(gen, spec, levelIndex, level, where) {
  const rules = gen.curveRules(gen.effectiveLevel(spec, levelIndex), level.edges.length);
  const arrows = level.edges.filter((e) => e[2] === 1).length;
  assert.ok(arrows <= rules.maxArrows, `${where}: стрелок ${arrows} > ${rules.maxArrows}`);
  assert.equal(level.start !== null && level.start !== undefined, rules.fixedStart, `${where}: фиксированный старт не по расписанию`);
  assert.equal(level.closed === true, rules.closed, `${where}: closed не по расписанию`);
  assert.ok(level.difficulty >= rules.minDifficulty, `${where}: difficulty ${level.difficulty} < ${rules.minDifficulty}`);
}

const CURVE_CHECKS = { zip: checkZipCurve, stroke: checkStrokeCurve };

test('позиционные правила кривой (§2.2, §2.4) выполняются в данных поставки во всех наборах', () => {
  for (const id of modes) {
    const check = CURVE_CHECKS[id];
    if (!check) continue;
    const gen = gens[id];
    const sets = modeSets(data, id);
    for (const kind of Object.keys(EXPECTED)) {
      for (const { spec, need, firstIndex, offset } of specPlan(gen, kind)) {
        sets[kind].slice(offset, offset + need).forEach((level, i) => {
          check(gen, spec, firstIndex + i, level, `${id}/${kind}#${offset + i + 1}`);
        });
      }
    }
  }
});

test('кампания zip: первые стены — на 15-м уровне с tip «Сквозь толстые линии нельзя»; stroke: стрелки с 25-го, старт с 15-го, closed с 40-го', () => {
  if (gens.zip) {
    const c = modeSets(data, 'zip').campaign;
    const ch2 = gens.zip.CHAPTERS.find((s) => s.chapter === 2);
    const firstWalls = c.findIndex((l) => l.walls.length > 0) + 1;
    assert.equal(firstWalls, ch2.wallsFromLevel, `первые стены на уровне ${firstWalls}`);
    assert.equal(c[firstWalls - 1].tip?.ru, 'Сквозь толстые линии нельзя');
  }
  if (gens.stroke) {
    const c = modeSets(data, 'stroke').campaign;
    const firstOf = (pred) => c.findIndex(pred) + 1;
    assert.equal(firstOf((l) => l.edges.some((e) => e[2] === 1)), 25, 'первые стрелки');
    assert.equal(firstOf((l) => l.start !== null && l.start !== undefined), 15, 'первый фиксированный старт');
    assert.equal(firstOf((l) => l.closed === true), 40, 'первый closed');
    assert.equal(c[9].difficulty >= 2, true, 'stroke #10: difficulty ≥ 2');
  }
});
