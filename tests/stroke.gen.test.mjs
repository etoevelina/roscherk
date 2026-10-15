// Тесты генератора «Один штрих»: валидность, кривая, детерминизм, пулы, tipFor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTERS, POOL, DAILY, generate, tipFor, curveRules, effectiveLevel, profile, minNodeEdgeGap } from '../src/modes/stroke.gen.js';
import { solve, validate } from '../src/modes/stroke.solve.js';
import { hash32 } from '../src/core/rng.js';
import { contentId } from '../src/core/hash.js';

const MASTER = 20261012;

/** Первые count непустых уровней спека (seed = hash32(master, 'stroke', kind, chapter, attempt)). */
function sample(spec, count, kind = 'campaign', levelIndexOf = (attempt) => spec.from + (attempt % (spec.to - spec.from + 1))) {
  const out = [];
  let attempts = 0;
  for (let attempt = 0; out.length < count && attempt < count * 40; attempt++) {
    attempts++;
    const lv = generate(hash32(MASTER, 'stroke', kind, spec.chapter, attempt), spec, levelIndexOf(attempt));
    if (lv) out.push(lv);
  }
  assert.equal(out.length, count, `глава ${spec.chapter}: не набрано ${count} уровней за ${attempts} попыток`);
  return out;
}

/** Структурные проверки levelData по §2.4/§5.4. */
function checkStructure(lv, spec) {
  assert.ok(spec.grids.some(([w, h]) => w === lv.w && h === lv.h), `решётка ${lv.w}×${lv.h}`);
  assert.ok(lv.nodes.length >= 5, 'узлов ≥ 5');
  assert.ok(lv.edges.length >= spec.edges[0] && lv.edges.length <= spec.edges[1], `рёбер ${lv.edges.length}`);
  assert.equal(lv.solution.length, lv.edges.length + 1);
  assert.equal(typeof lv.closed, 'boolean');
  assert.ok(lv.start === null || Number.isInteger(lv.start));
  // Узлы — целочисленная решётка + джиттер ≤ 15 % шага; все узлы различны и используются.
  const deg = new Int32Array(lv.nodes.length);
  const seen = new Set();
  for (const [x, y] of lv.nodes) {
    assert.ok(Math.abs(x - Math.round(x)) <= 0.15 + 1e-9 && Math.abs(y - Math.round(y)) <= 0.15 + 1e-9, `джиттер (${x},${y})`);
    assert.ok(Math.round(x) >= 0 && Math.round(x) < lv.w && Math.round(y) >= 0 && Math.round(y) < lv.h);
    const key = `${Math.round(x)},${Math.round(y)}`;
    assert.ok(!seen.has(key), 'дубликат узла');
    seen.add(key);
  }
  const diagCells = new Set();
  const pairs = new Set();
  for (const e of lv.edges) {
    assert.equal(e.length, 3);
    const [a, b, dir] = e;
    assert.ok(dir === 0 || dir === 1);
    if (dir === 0) assert.ok(a < b, 'dir=0 хранится как a<b');
    deg[a]++;
    deg[b]++;
    const ax = Math.round(lv.nodes[a][0]);
    const ay = Math.round(lv.nodes[a][1]);
    const bx = Math.round(lv.nodes[b][0]);
    const by = Math.round(lv.nodes[b][1]);
    const dx = Math.abs(ax - bx);
    const dy = Math.abs(ay - by);
    assert.ok(dx <= 1 && dy <= 1 && dx + dy > 0, 'ребро — сосед по стороне или диагонали клетки');
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    assert.ok(!pairs.has(key), 'кратное ребро');
    pairs.add(key);
    if (dx === 1 && dy === 1) {
      const cell = `${Math.min(ax, bx)},${Math.min(ay, by)}`;
      assert.ok(!diagCells.has(cell), 'в клетке только одна диагональ');
      diagCells.add(cell);
    }
  }
  for (const d of deg) assert.ok(d > 0, 'изолированный узел');
  // Стрелки — по направлению эталона.
  const stepDir = new Map();
  for (let i = 0; i < lv.solution.length - 1; i++) stepDir.set(`${lv.solution[i]}-${lv.solution[i + 1]}`, true);
  for (const [a, b, dir] of lv.edges) if (dir === 1) assert.ok(stepDir.has(`${a}-${b}`), 'стрелка против эталона');
  if (lv.start != null) assert.equal(lv.solution[0], lv.start);
  if (lv.closed) assert.equal(lv.solution[0], lv.solution[lv.solution.length - 1]);
  // Хвостов нет: за листом не более одной вершины степени 2.
  const adj = lv.nodes.map(() => []);
  for (const [a, b] of lv.edges) adj[a].push(b), adj[b].push(a);
  for (let leaf = 0; leaf < deg.length; leaf++) {
    if (deg[leaf] !== 1) continue;
    let prev = leaf;
    let cur = adj[leaf][0];
    let chain = 0;
    while (deg[cur] === 2) {
      chain++;
      const next = adj[cur][0] === prev ? adj[cur][1] : adj[cur][0];
      prev = cur;
      cur = next;
    }
    assert.ok(chain < 2, 'хвост');
  }
}

test('2 уровня на главу с фиксированным seed: валидны, difficulty ≥ minDifficulty, структура по спеке', () => {
  for (const spec of CHAPTERS) {
    const levels = sample(spec, 2);
    for (const lv of levels) {
      checkStructure(lv, spec);
      assert.ok(validate(lv, lv.solution), 'эталон валиден');
      const res = solve(lv, { maxNodes: 200_000, maxSolutions: 2 });
      assert.ok(res.solutions.length >= 1, 'солвер находит решение');
      assert.equal(res.complete, true);
      assert.ok(res.difficulty >= spec.minDifficulty, `глава ${spec.chapter}: difficulty ${res.difficulty} < ${spec.minDifficulty}`);
    }
  }
});

test('детерминизм: одинаковый seed даёт одинаковый JSON, разные seed — разные уровни', () => {
  const spec = CHAPTERS[2];
  const a = generate(123456, spec, 40);
  const b = generate(123456, spec, 40);
  assert.ok(a);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const c = generate(123457, spec, 40);
  assert.ok(c);
  assert.notEqual(JSON.stringify(a), JSON.stringify(c));
  // generate не трогает глобальное состояние: вызовы в любом порядке дают тот же результат.
  generate(999, CHAPTERS[4], 90);
  assert.equal(JSON.stringify(generate(123456, spec, 40)), JSON.stringify(a));
});

test('правила кривой по номеру уровня: стрелки с 25-го, старт каждый 5-й с 15-го, closed каждый 4-й с 40-го', () => {
  assert.deepEqual(curveRules(1, 8), { maxArrows: 0, fixedStart: false, closed: false, minHubs: 0, minRatio: 0, minDifficulty: 0 });
  assert.equal(curveRules(10, 9).minHubs, 3);
  assert.equal(curveRules(10, 9).minDifficulty, 2);
  assert.equal(curveRules(20, 12).minRatio, 1.3);
  assert.equal(curveRules(24, 14).maxArrows, 0);
  assert.equal(curveRules(25, 14).maxArrows, 2);
  assert.equal(curveRules(70, 24).maxArrows, 12);
  assert.equal(curveRules(100, 32).maxArrows, 16);
  assert.ok(curveRules(15, 10).fixedStart && curveRules(20, 10).fixedStart && !curveRules(10, 10).fixedStart && !curveRules(16, 10).fixedStart);
  assert.ok(curveRules(40, 16).closed && curveRules(44, 16).closed && !curveRules(36, 16).closed && !curveRules(41, 16).closed);

  // На данных: для каждого номера уровня кампании один уровень с нужными модификаторами.
  for (const spec of CHAPTERS) {
    for (let level = spec.from; level <= spec.to; level++) {
      let lv = null;
      for (let attempt = 0; !lv && attempt < 40; attempt++) {
        lv = generate(hash32(MASTER, 'curve', level, attempt), spec, level);
      }
      assert.ok(lv, `уровень ${level} не сгенерирован`);
      const rules = curveRules(level, lv.edges.length);
      assert.equal(lv.start != null, rules.fixedStart, `уровень ${level}: фиксированный старт`);
      assert.equal(lv.closed, rules.closed, `уровень ${level}: closed`);
      const arrows = lv.edges.filter((e) => e[2] === 1).length;
      if (level < 25) assert.equal(arrows, 0, `уровень ${level}: стрелок быть не должно`);
      else assert.ok(arrows >= 1 && arrows <= rules.maxArrows, `уровень ${level}: стрелок ${arrows}`);
      if (level >= 10) {
        const deg = new Int32Array(lv.nodes.length);
        for (const [a, b] of lv.edges) deg[a]++, deg[b]++;
        assert.ok(deg.filter((d) => d >= 3).length >= 3, `уровень ${level}: узлов степени ≥ 3`);
        assert.ok(solve(lv).difficulty >= 2, `уровень ${level}: difficulty ≥ 2`);
      }
      if (level >= 20) assert.ok(lv.edges.length / lv.nodes.length >= 1.3, `уровень ${level}: плотность`);
    }
  }
});

test('effectiveLevel: номер в диапазоне главы остаётся, иной — циклически отображается в диапазон', () => {
  const spec = CHAPTERS[1]; // 11..30
  assert.equal(effectiveLevel(spec, 11), 11);
  assert.equal(effectiveLevel(spec, 30), 30);
  assert.equal(effectiveLevel(spec, 0), 20);
  assert.equal(effectiveLevel(spec, 1), 21);
  assert.equal(effectiveLevel(spec, 10), 30);
  assert.equal(effectiveLevel(spec, 31), 11);
  assert.equal(effectiveLevel(spec, undefined), 11);
});

test('POOL — 150 уровней по главам 1–5, DAILY — 40 уровней главы 3; спеки генерируют валидные уровни', () => {
  assert.equal(POOL.reduce((s, p) => s + p.count, 0), 150);
  assert.deepEqual(POOL.map((p) => p.chapter), [1, 2, 3, 4, 5]);
  assert.equal(DAILY.count, 40);
  assert.equal(DAILY.chapter, 3);
  for (const spec of [...POOL, DAILY]) {
    for (const lv of sample(spec, 1, 'pool', (attempt) => attempt)) {
      checkStructure(lv, spec);
      assert.ok(validate(lv, lv.solution));
      assert.ok(solve(lv).difficulty >= spec.minDifficulty);
    }
  }
});

test('generate возвращает null на отвергнутой затравке (невыполнимый спек)', () => {
  const impossible = { ...CHAPTERS[0], edges: [60, 60] }; // на 3×3 нет 60 рёбер
  assert.equal(generate(1, impossible, 1), null);
});

test('tipFor: обязательные подсказки появляются один раз, на первом уровне с модификатором', () => {
  const plain = { w: 3, h: 3, nodes: [[0, 0], [1, 0], [1, 1], [0, 1], [2, 0]], edges: [[0, 1, 0], [1, 2, 0], [2, 3, 0], [0, 3, 0], [1, 4, 0]], start: null, closed: false, solution: [4, 1, 0, 3, 2, 1] };
  const cycle = { ...plain, edges: plain.edges.slice(0, 4), solution: [0, 1, 2, 3, 0] };
  const arrows = { ...cycle, edges: [[0, 1, 1], [1, 2, 0], [2, 3, 0], [0, 3, 0]] };
  const fixed = { ...cycle, start: 0 };
  const closed = { ...cycle, closed: true };

  assert.deepEqual(tipFor(cycle, 1, []), { ru: 'Обведи все отрезки одним движением' });
  assert.equal(tipFor(cycle, 2, [cycle]), undefined);
  assert.deepEqual(tipFor(plain, 3, [cycle, cycle]), { ru: 'Начинать нужно с правильной точки' });
  assert.equal(tipFor(plain, 4, [cycle, cycle, plain]), undefined);
  assert.deepEqual(tipFor(fixed, 15, [cycle, plain]), { ru: 'Начни с отмеченной точки' });
  assert.equal(tipFor(fixed, 20, [cycle, plain, fixed]), undefined);
  assert.deepEqual(tipFor(arrows, 25, [cycle, plain, fixed]), { ru: 'По стрелке — только в её направлении' });
  assert.equal(tipFor(arrows, 26, [cycle, arrows]), undefined);
  assert.deepEqual(tipFor(closed, 40, [cycle, plain, fixed, arrows]), { ru: 'Закончи там, где начал' });
  // Две нечётные точки при фиксированном старте — старт отмечен, подсказка про поиск старта не нужна.
  assert.equal(tipFor({ ...plain, start: 4 }, 30, [cycle, fixed]), undefined);
});

// Коммитнутый хэш фиксированной выборки (§7.3): 2 первых непустых уровня на главу при MASTER.
// Меняется только вместе с намеренной правкой генератора (тогда levels.json перегенерируется,
// id уровней и привязанный к ним прогресс «уезжают» — это должно быть осознанным решением).
const SAMPLE_HASH = '7d49a4da';

test('детерминизм §7.3: фиксированная выборка 2×5 совпадает с коммитнутым хэшем', () => {
  const ids = [];
  for (const spec of CHAPTERS) for (const lv of sample(spec, 2)) ids.push(contentId(lv));
  assert.equal(ids.length, 10);
  assert.equal(contentId(ids), SAMPLE_HASH, `хэш выборки ${contentId(ids)}; ids: ${ids.join(' ')}`);
});

test('profile: ключ слота для tools/generate.mjs — эффективный номер уровня (кандидат не уходит в чужой слот)', () => {
  const spec = CHAPTERS[1]; // 11..30
  assert.equal(profile(spec, 25), '25');
  assert.notEqual(profile(spec, 24), profile(spec, 25), 'стрелки с 25-го — разные слоты');
  assert.equal(profile(spec, 31), String(effectiveLevel(spec, 31)));
  assert.equal(profile(POOL[2], 1), String(effectiveLevel(POOL[2], 1)));
  // Профили всех слотов главы различны: сортировка по difficulty внутри слота кривую не ломает.
  const keys = new Set();
  for (let level = spec.from; level <= spec.to; level++) keys.add(profile(spec, level));
  assert.equal(keys.size, spec.to - spec.from + 1);
});

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

test('зазор узел–чужой отрезок: ≥ 22pt + 12pt запаса пальца на поле 327pt для каждой решётки, данные его соблюдают', () => {
  // 6×5 при 375pt: наименьший шаг 327 / (5 + 0.3 + 1.2) = 50.3pt, 0.4 шага = 20pt < радиуса захвата
  // 22pt — порог поднимается до (22 + 12) / 50.3 = 0.676. На 3×3 радиус растёт с шагом (0.35·шага).
  assert.ok(Math.abs(minNodeEdgeGap(6, 5) - 34 / (327 / 6.5)) < 1e-9);
  assert.ok(minNodeEdgeGap(3, 3) > 0.47 && minNodeEdgeGap(3, 3) < 0.48);
  assert.ok(minNodeEdgeGap(4, 4) > 0.51 && minNodeEdgeGap(5, 5) > 0.57 && minNodeEdgeGap(6, 5) > 0.67);
  assert.ok(minNodeEdgeGap(6, 5) < 0.707, 'базовая диагональ (0.707) проходит порог');
  for (const [w, h] of [[3, 3], [4, 4], [5, 4], [5, 5], [6, 5]]) {
    const stepPt = 327 / (Math.max(w, h) - 1 + 0.3 + 1.2);
    assert.ok(minNodeEdgeGap(w, h) * stepPt >= Math.max(22, 0.35 * stepPt) + 12 - 1e-9, `${w}×${h}: зазор в pt`);
  }
  for (const spec of CHAPTERS) {
    for (const lv of sample(spec, 4)) {
      assert.ok(minGapOf(lv) >= minNodeEdgeGap(lv.w, lv.h) - 1e-9, `${lv.w}×${lv.h}: зазор ${minGapOf(lv).toFixed(3)}`);
    }
  }
});
