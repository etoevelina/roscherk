// Собранные уровни «Один штрих» в src/data/levels.json (§7.5 и кривая §2.4 по позиции в кампании):
// структура и валидность эталона, difficulty = пересчёт солвером, id = contentId содержимого,
// модификаторы кривой (стрелки/старт/closed/хабы/плотность/порог) на своих номерах уровней,
// зазор узел–чужой отрезок, трассировка эталона «неидеальным пальцем» без единого reject,
// свежесть данных: каждый уровень воспроизводится текущим генератором из своего seed и слота.
// Переменная окружения ROSCHERK_LEVELS — путь к другому levels.json (проверка кандидата перед заменой).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAPTERS, POOL, DAILY, generate, curveRules, minNodeEdgeGap } from '../src/modes/stroke.gen.js';
import { solve, validate, solutionOf } from '../src/modes/stroke.solve.js';
import stroke from '../src/modes/stroke.js';
import { contentId } from '../src/core/hash.js';
import { hash32 } from '../src/core/rng.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVICE_FIELDS = ['id', 'seed', 'chapter', 'difficulty', 'tip', 'unique'];
let data;

before(() => {
  const path = process.env.ROSCHERK_LEVELS ? resolve(process.env.ROSCHERK_LEVELS) : resolve(ROOT, 'src/data/levels.json');
  assert.ok(existsSync(path), `нет ${path} — выполните npm run gen`);
  data = JSON.parse(readFileSync(path, 'utf8'));
  assert.ok(data.stroke, 'в levels.json нет раздела stroke');
});

const all = () => [...data.stroke.campaign, ...data.stroke.pool, ...data.stroke.daily];

function stripService(level) {
  const out = {};
  for (const [k, v] of Object.entries(level)) if (!SERVICE_FIELDS.includes(k)) out[k] = v;
  return out;
}

const degreesOf = (lv) => {
  const deg = new Int32Array(lv.nodes.length);
  for (const [a, b] of lv.edges) deg[a]++, deg[b]++;
  return deg;
};

/** Минимальная дистанция узла до чужого отрезка (единицы решётки). */
function minGapOf(lv) {
  const dist = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2));
    return Math.hypot(ax + t * dx - px, ay + t * dy - py);
  };
  let min = Infinity;
  for (const [a, b] of lv.edges) {
    for (let v = 0; v < lv.nodes.length; v++) {
      if (v === a || v === b) continue;
      min = Math.min(min, dist(lv.nodes[v][0], lv.nodes[v][1], lv.nodes[a][0], lv.nodes[a][1], lv.nodes[b][0], lv.nodes[b][1]));
    }
  }
  return min;
}

/** Уровень против спека своей главы: структура §5.4, эталон, difficulty, id. */
function checkLevel(lv, spec, where) {
  assert.match(String(lv.id), /^[0-9a-f]{8}$/, `${where}: id`);
  assert.equal(lv.id, contentId(stripService(lv)), `${where}: id не совпадает с содержимым`);
  assert.ok(Number.isInteger(lv.seed) && lv.seed >= 0, `${where}: seed`);
  assert.equal(lv.chapter, spec.chapter, `${where}: глава`);
  assert.ok(spec.grids.some(([w, h]) => w === lv.w && h === lv.h), `${where}: решётка ${lv.w}×${lv.h}`);
  assert.ok(lv.nodes.length >= 5, `${where}: узлов ≥ 5`);
  assert.ok(lv.edges.length >= spec.edges[0] && lv.edges.length <= spec.edges[1], `${where}: рёбер ${lv.edges.length}`);
  assert.equal(typeof lv.closed, 'boolean', `${where}: closed`);
  assert.ok(lv.start === null || Number.isInteger(lv.start), `${where}: start`);
  assert.equal(lv.unique, undefined, `${where}: у stroke нет поля unique`);
  assert.ok(validate(lv, solutionOf(lv)), `${where}: эталон невалиден`);
  const res = solve(lv, { maxNodes: 200_000, maxSolutions: 2 });
  assert.equal(res.complete, true, `${where}: солвер не уложился в лимит`);
  assert.ok(res.solutions.length >= 1, `${where}: решений нет`);
  assert.equal(lv.difficulty, res.difficulty, `${where}: difficulty ${lv.difficulty} ≠ пересчёт ${res.difficulty}`);
  assert.ok(lv.difficulty >= spec.minDifficulty, `${where}: difficulty ${lv.difficulty} < ${spec.minDifficulty}`);
  assert.ok(minGapOf(lv) >= minNodeEdgeGap(lv.w, lv.h) - 1e-9, `${where}: зазор узел–отрезок ${minGapOf(lv).toFixed(3)}`);
}

test('кампания: 100 уровней, главы по CHAPTERS, difficulty не убывает и соседние ≤ 2×', () => {
  const campaign = data.stroke.campaign;
  assert.equal(campaign.length, 100);
  for (const spec of CHAPTERS) {
    let prev = -Infinity;
    for (let index = spec.from; index <= spec.to; index++) {
      const lv = campaign[index - 1];
      checkLevel(lv, spec, `кампания ${index}`);
      assert.ok(lv.difficulty >= prev, `уровень ${index}: difficulty убывает (${prev} → ${lv.difficulty})`);
      if (prev > -Infinity) assert.ok(Math.max(1, lv.difficulty) <= 2 * Math.max(1, prev), `уровень ${index}: скачок ${prev} → ${lv.difficulty}`);
      prev = lv.difficulty;
    }
  }
});

test('кривая §2.4 по позиции в кампании: стрелки с 25-го, старт каждый 5-й с 15-го, closed каждый 4-й с 40-го, хабы/плотность/порог', () => {
  const campaign = data.stroke.campaign;
  for (let index = 1; index <= campaign.length; index++) {
    const lv = campaign[index - 1];
    const E = lv.edges.length;
    const rules = curveRules(index, E);
    const where = `уровень ${index}`;
    assert.equal(lv.start != null, rules.fixedStart, `${where}: фиксированный старт`);
    assert.equal(lv.closed, rules.closed, `${where}: closed`);
    const arrows = lv.edges.filter((e) => e[2] === 1).length;
    if (index < 25) assert.equal(arrows, 0, `${where}: стрелок быть не должно`);
    else assert.ok(arrows >= 1 && arrows <= rules.maxArrows, `${where}: стрелок ${arrows}, допустимо 1…${rules.maxArrows}`);
    const hubs = Array.from(degreesOf(lv)).filter((d) => d >= 3).length;
    assert.ok(hubs >= rules.minHubs, `${where}: узлов степени ≥ 3: ${hubs} < ${rules.minHubs}`);
    assert.ok(E / lv.nodes.length >= rules.minRatio - 1e-12, `${where}: плотность ${(E / lv.nodes.length).toFixed(2)} < ${rules.minRatio}`);
    assert.ok(lv.difficulty >= rules.minDifficulty, `${where}: difficulty ${lv.difficulty} < ${rules.minDifficulty}`);
  }
  // Обязательные tip (§3.1) стоят на первом появлении модификатора — и это ровно позиции кривой.
  assert.deepEqual(campaign[0].tip, { ru: 'Обведи все отрезки одним движением' });
  assert.deepEqual(campaign[14].tip, { ru: 'Начни с отмеченной точки' });
  assert.deepEqual(campaign[24].tip, { ru: 'По стрелке — только в её направлении' });
  assert.deepEqual(campaign[39].tip, { ru: 'Закончи там, где начал' });
  const tips = campaign.filter((lv) => lv.tip).map((lv) => lv.tip.ru);
  assert.equal(new Set(tips).size, tips.length, 'каждый обязательный tip — один раз');
});

test('пул «Бесконечности»: 150 уровней по главам POOL; daily: 40 уровней главы 3', () => {
  const pool = data.stroke.pool;
  assert.equal(pool.length, POOL.reduce((sum, p) => sum + p.count, 0));
  let offset = 0;
  for (const spec of POOL) {
    for (let i = 0; i < spec.count; i++) checkLevel(pool[offset + i], spec, `пул ${offset + i}`);
    offset += spec.count;
  }
  const daily = data.stroke.daily;
  assert.equal(daily.length, DAILY.count);
  for (let i = 0; i < daily.length; i++) checkLevel(daily[i], DAILY, `daily ${i}`);
});

/**
 * Слот уровня по его seed (§5.5): seed = hash32(masterSeed, 'stroke', kind, chapter, attempt),
 * кандидат номер attempt сгенерирован для слота firstIndex + attempt % need. Потолок попыток —
 * need × 60, как в tools/generate.mjs. Возвращает levelIndex или null, если seed не из этого спека.
 */
function slotOf(masterSeed, kind, spec, need, firstIndex, seed) {
  for (let attempt = 0; attempt < need * 60; attempt++) {
    if (hash32(masterSeed, 'stroke', kind, spec.chapter, attempt) === seed) return firstIndex + (attempt % need);
  }
  return null;
}

test('данные не устарели: каждый уровень воспроизводится текущим генератором из seed и слота (иначе — npm run gen)', () => {
  const masterSeed = data.meta.masterSeed;
  assert.ok(Number.isInteger(masterSeed), 'meta.masterSeed');
  const stale = [];
  const check = (lv, kind, spec, need, firstIndex, where) => {
    const levelIndex = slotOf(masterSeed, kind, spec, need, firstIndex, lv.seed);
    if (levelIndex === null) {
      stale.push(`${where}: seed ${lv.seed} не из спека главы ${spec.chapter}`);
      return;
    }
    // Сравнение после JSON-обхода, как хранится в levels.json (джиттер −0 сериализуется как 0).
    const regenerated = JSON.parse(JSON.stringify(generate(lv.seed, spec, levelIndex)));
    try {
      assert.deepEqual(stripService(lv), regenerated);
    } catch {
      stale.push(`${where}: содержимое отличается от generate(${lv.seed}, глава ${spec.chapter}, слот ${levelIndex})`);
    }
  };
  for (const spec of CHAPTERS) {
    const need = spec.to - spec.from + 1;
    for (let index = spec.from; index <= spec.to; index++) check(data.stroke.campaign[index - 1], 'campaign', spec, need, spec.from, `кампания ${index}`);
  }
  let offset = 0;
  for (const spec of POOL) {
    for (let i = 0; i < spec.count; i++) check(data.stroke.pool[offset + i], 'pool', spec, spec.count, 1, `пул ${offset + i}`);
    offset += spec.count;
  }
  for (let i = 0; i < DAILY.count; i++) check(data.stroke.daily[i], 'daily', DAILY, DAILY.count, 1, `daily ${i}`);
  assert.deepEqual(stale, [], `levels.json сгенерирован другим генератором (${stale.length} уровней) — выполните npm run gen`);
});

test('id уровней уникальны во всех наборах stroke', () => {
  const ids = new Set();
  for (const lv of all()) {
    assert.ok(!ids.has(lv.id), `повтор id ${lv.id}`);
    ids.add(lv.id);
  }
  assert.equal(ids.size, 290);
});

/**
 * Трассировка эталона «неидеальным пальцем»: вдоль каждого отрезка сэмплы через 4px с боковым
 * синусоидальным отклонением амплитуды amp (фаза непрерывна по длине дуги). Возвращает число
 * reject, число solved и флаг победы.
 */
function tracePlay(level, fieldPt, amp, period = 60) {
  const state = stroke.create(level);
  const layout = stroke.layout(state, { x: 24, y: 0, w: fieldPt, h: fieldPt }, { id: 'dark' });
  const { px, py } = layout;
  const sol = level.solution;
  let rejects = 0;
  let solved = 0;
  let arc = 0;
  const feed = (type, x, y) => {
    for (const ev of stroke.pointer(state, layout, { type, x, y, t: arc })) {
      if (ev.kind === 'reject') rejects++;
      if (ev.kind === 'solved') solved++;
    }
  };
  const offsetAt = (s) => amp * Math.sin((2 * Math.PI * s) / period);
  feed('down', px[sol[0]], py[sol[0]] + offsetAt(0));
  for (let i = 0; i + 1 < sol.length; i++) {
    const ax = px[sol[i]];
    const ay = py[sol[i]];
    const bx = px[sol[i + 1]];
    const by = py[sol[i + 1]];
    const len = Math.hypot(bx - ax, by - ay);
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    for (let s = 4; s < len + 4; s += 4) {
      const d = Math.min(s, len);
      const off = offsetAt(arc + d);
      feed('move', ax + ux * d - uy * off, ay + uy * d + ux * off);
      if (d === len) break;
    }
    arc += len;
  }
  feed('up', px[sol[sol.length - 1]], py[sol[sol.length - 1]]);
  return { rejects, solved, won: stroke.isSolved(state) };
}

test('трассировка эталона на 375pt и 390pt: точное ведение и отклонение 10px — ни одного reject, solved ровно один раз', () => {
  for (const fieldPt of [327, 342]) {
    for (const amp of [0, 10]) {
      const bad = [];
      for (const lv of all()) {
        const r = tracePlay(lv, fieldPt, amp);
        if (r.rejects !== 0 || r.solved !== 1 || !r.won) bad.push(`${lv.id}(${lv.w}×${lv.h}): rejects=${r.rejects} solved=${r.solved} won=${r.won}`);
      }
      assert.deepEqual(bad, [], `поле ${fieldPt}pt, отклонение ${amp}px: ${bad.length} уровней`);
    }
  }
});
