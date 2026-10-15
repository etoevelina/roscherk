// Генератор уровней «Один штрих» (§2.4, §5.2 спеки). Детерминирован от seed: единственный
// источник случайности — src/core/rng.js. Возвращает levelData без служебных полей или null,
// если затравка отвергнута (застревание маршрута, фильтры, порог сложности).
//
// Правила кривой, зависящие от номера уровня (стрелки с 25-го, фиксированный старт — каждый 5-й
// с 15-го, closed — каждый 4-й с 40-го, ≥ 3 узла степени ≥ 3 с 10-го, edges/nodes ≥ 1.3 с 20-го,
// difficulty ≥ 2 с 10-го), берутся по «эффективному номеру уровня»: levelIndex, если он попадает
// в диапазон spec.from..spec.to, иначе — levelIndex циклически отображённый в этот диапазон
// (так пул и ежедневная получают тот же разброс модификаторов, что и глава кампании).
// Чтобы tools/generate.mjs не переставлял кандидатов между слотами при сортировке по difficulty,
// экспортируется profile(spec, levelIndex): кандидат годится только в слот своего эффективного номера.

import { mulberry32 } from '../core/rng.js';
import { buildGraph, difficultyOf, validate } from './stroke.solve.js';

// grids — варианты решётки точек [w, h]; edges — диапазон числа отрезков; circuitShare — доля
// замкнутых маршрутов (старт где угодно) среди уровней без closed.
export const CHAPTERS = [
  { chapter: 1, from: 1, to: 10, minDifficulty: 1, grids: [[3, 3]], edges: [6, 9], circuitShare: 0.7 },
  { chapter: 2, from: 11, to: 30, minDifficulty: 2, grids: [[4, 4]], edges: [9, 14], circuitShare: 0.55 },
  { chapter: 3, from: 31, to: 55, minDifficulty: 2, grids: [[4, 4], [5, 4]], edges: [13, 20], circuitShare: 0.4 },
  { chapter: 4, from: 56, to: 80, minDifficulty: 2, grids: [[5, 5]], edges: [18, 26], circuitShare: 0.3 },
  { chapter: 5, from: 81, to: 100, minDifficulty: 2, grids: [[6, 5]], edges: [24, 32], circuitShare: 0.2 },
];

/** Победа — любой эйлеров путь (§2.4): уникальность решения не требуется, поле unique не пишется. */
export const UNIQUE_REQUIRED = false;
/** Лимит узлов солвера для tools/generate.mjs и tools/verify.mjs (§2.4: ≤ 2·10⁵). */
export const MAX_NODES = 200_000;

const poolSpec = (chapter, count) => ({ ...CHAPTERS[chapter - 1], count });

export const POOL = [poolSpec(1, 20), poolSpec(2, 30), poolSpec(3, 35), poolSpec(4, 35), poolSpec(5, 30)];
export const DAILY = poolSpec(3, 40);

const MAX_ATTEMPTS = 12; // полных попыток (маршрут + фильтры + сложность) на одну затравку
const MAX_WALK_RESTARTS = 40; // рестартов случайного маршрута внутри попытки
const DIFFICULTY_BUDGET = 200_000; // лимит узлов солвера на подсчёт сложности
const JITTER = 0.15; // джиттер узлов, доли шага решётки

// Зазор узел–чужой отрезок после джиттера считается в пикселях самого узкого поддерживаемого экрана:
// iPhone 375pt, поле 327pt (§3.1: отступы ≥ 24pt). stroke.js вписывает bbox узлов с полями MARGIN,
// поэтому наименьший шаг решётки = поле / (сторона − 1 + 2·JITTER + 2·MARGIN), а радиус захвата —
// max(22pt, 0.35·шага) (§2.4). Чужой узел должен оставаться вне радиуса даже при отклонении пальца
// от отрезка на FINGER_SLOP_PT, иначе легальное ведение даёт ложный reject (0.4 шага на 6×5 — это
// 21pt < 22pt радиуса). Требование убывает с ростом шага, так что оценка по наименьшему шагу —
// консервативна. Базовая решётка без джиттера даёт 0.707 для диагоналей и 1.0 для ортогональных
// рёбер, поэтому порог достижим для всех решёток кривой (на 6×5 — ценой почти нулевого джиттера).
const REF_FIELD_PT = 327;
const LAYOUT_MARGIN = 0.6; // как MARGIN в stroke.js
const CAPTURE_PT = 22;
const CAPTURE_STEP_SHARE = 0.35;
const FINGER_SLOP_PT = 12;
const MIN_NODE_EDGE_GAP = 0.4;

/** Минимальный зазор узел–чужой отрезок (доли шага) для решётки w×h. */
export function minNodeEdgeGap(w, h) {
  const stepPt = REF_FIELD_PT / (Math.max(w, h) - 1 + 2 * JITTER + 2 * LAYOUT_MARGIN);
  const capturePt = Math.max(CAPTURE_PT, CAPTURE_STEP_SHARE * stepPt);
  return Math.max(MIN_NODE_EDGE_GAP, (capturePt + FINGER_SLOP_PT) / stepPt);
}

/** Эффективный номер уровня для правил кривой (см. шапку файла). */
export function effectiveLevel(spec, levelIndex) {
  const from = spec.from ?? 1;
  const to = spec.to ?? from;
  const span = to - from + 1;
  if (!Number.isInteger(levelIndex)) return from;
  if (levelIndex >= from && levelIndex <= to) return levelIndex;
  return from + ((((levelIndex - from) % span) + span) % span);
}

/**
 * profile(spec, levelIndex) → ключ слота для tools/generate.mjs: кандидат, сгенерированный под
 * эффективный номер уровня, может занять только слот с тем же номером — правила кривой (стрелки,
 * фиксированный старт, closed, хабы, плотность, порог difficulty) остаются привязаны к позиции.
 */
export function profile(spec, levelIndex) {
  return String(effectiveLevel(spec, levelIndex));
}

/** Модификаторы и фильтры кривой для номера уровня и числа отрезков E. */
export function curveRules(level, E) {
  let maxArrows = 0;
  if (level >= 25) {
    const half = Math.floor(E / 2);
    maxArrows = level >= 70 ? half : Math.max(2, Math.round(2 + ((half - 2) * (level - 25)) / 45));
    maxArrows = Math.min(maxArrows, E);
  }
  return {
    maxArrows,
    fixedStart: level >= 15 && level % 5 === 0,
    closed: level >= 40 && level % 4 === 0,
    minHubs: level >= 10 ? 3 : 0,
    minRatio: level >= 20 ? 1.3 : 0,
    minDifficulty: level >= 10 ? 2 : 0,
  };
}

/**
 * Кандидаты-рёбра решётки w×h: соседи по горизонтали/вертикали и две диагонали каждой единичной
 * клетки (в клетке можно использовать только одну). cell[e] — индекс клетки диагонали или -1.
 */
function buildCandidates(w, h) {
  const ea = [];
  const eb = [];
  const cell = [];
  const id = (x, y) => y * w + x;
  const add = (a, b, c) => {
    ea.push(a);
    eb.push(b);
    cell.push(c);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x + 1 < w) add(id(x, y), id(x + 1, y), -1);
      if (y + 1 < h) add(id(x, y), id(x, y + 1), -1);
      if (x + 1 < w && y + 1 < h) {
        const c = y * (w - 1) + x;
        add(id(x, y), id(x + 1, y + 1), c);
        add(id(x + 1, y), id(x, y + 1), c);
      }
    }
  }
  const n = w * h;
  const adj = Array.from({ length: n }, () => []);
  for (let e = 0; e < ea.length; e++) {
    adj[ea[e]].push(e);
    adj[eb[e]].push(e);
  }
  return { n, w, h, ea, eb, cell, adj, cells: (w - 1) * (h - 1) };
}

/**
 * Случайный маршрут без повтора рёбер. Возвращает { nodes:[…], edges:[…] } (последовательность
 * узлов длиной L+1 и индексов кандидатов) или null при застревании/отказе.
 * wantCircuit: после L−k шагов возвращаемся к старту кратчайшим путём по свободным рёбрам.
 */
function randomTrail(rng, cand, L, wantCircuit, edgesMin, edgesMax) {
  const { n, ea, eb, cell, adj } = cand;
  const used = new Uint8Array(ea.length);
  const cellUsed = new Uint8Array(cand.cells);
  const free = (e) => !used[e] && (cell[e] < 0 || !cellUsed[cell[e]]);
  const take = (e) => {
    used[e] = 1;
    if (cell[e] >= 0) cellUsed[cell[e]] = 1;
  };
  const other = (e, v) => (ea[e] === v ? eb[e] : ea[e]);

  const start = rng.int(n);
  const nodes = [start];
  const edges = [];
  const options = [];
  const target = wantCircuit ? L - (1 + rng.int(3)) : L;
  let v = start;
  for (let s = 0; s < target; s++) {
    options.length = 0;
    for (const e of adj[v]) if (free(e)) options.push(e);
    if (options.length === 0) return null;
    const e = options[rng.int(options.length)];
    take(e);
    v = other(e, v);
    edges.push(e);
    nodes.push(v);
  }
  if (!wantCircuit) {
    return v === start ? null : { nodes, edges };
  }
  if (v === start) return edges.length >= edgesMin ? { nodes, edges } : null;

  // Кратчайший путь к старту по свободным рёбрам (BFS), с проверкой конфликтов диагоналей внутри пути.
  const prevEdge = new Int32Array(n).fill(-1);
  const seen = new Uint8Array(n);
  const queue = [v];
  seen[v] = 1;
  let found = false;
  for (let qi = 0; qi < queue.length && !found; qi++) {
    const u = queue[qi];
    for (const e of adj[u]) {
      if (!free(e)) continue;
      const to = other(e, u);
      if (seen[to]) continue;
      seen[to] = 1;
      prevEdge[to] = e;
      if (to === start) {
        found = true;
        break;
      }
      queue.push(to);
    }
  }
  if (!found) return null;
  const back = [];
  for (let u = start; u !== v; ) {
    const e = prevEdge[u];
    back.push(e);
    u = other(e, u);
  }
  back.reverse();
  if (edges.length + back.length > edgesMax || edges.length + back.length < edgesMin) return null;
  for (const e of back) {
    if (!free(e)) return null; // две диагонали одной клетки внутри обратного пути
    take(e);
    v = other(e, v);
    edges.push(e);
    nodes.push(v);
  }
  return { nodes, edges };
}

/** Фильтры фигуры: узлов ≥ 5, нет хвостов, хабы и плотность по кривой. */
function passesFilters(deg, usedNodes, adjUsed, E, rules) {
  if (usedNodes.length < 5) return false;
  let hubs = 0;
  for (const v of usedNodes) if (deg[v] >= 3) hubs++;
  if (hubs < rules.minHubs) return false;
  if (E / usedNodes.length < rules.minRatio) return false;
  // Хвост: вершина степени 1, за которой ≥ 2 подряд вершины степени 2 (цепочка ≥ 3 вершин).
  for (const leaf of usedNodes) {
    if (deg[leaf] !== 1) continue;
    let prev = leaf;
    let cur = adjUsed[leaf][0];
    let chain = 0;
    while (deg[cur] === 2) {
      chain++;
      const [a, b] = adjUsed[cur];
      const next = a === prev ? b : a;
      prev = cur;
      cur = next;
      if (chain >= 2) return false;
    }
  }
  return true;
}

/** Расстояние от точки до отрезка (единицы решётки). */
function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
}

/** Пересекаются ли отрезки (без общих концов) в собственных внутренних точках. */
function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const cross = (ox, oy, px, py, qx, qy) => (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Геометрия после джиттера допустима: нет пересечений и узлы не ближе gap к чужим отрезкам. */
function geometryOk(pts, edges, gap) {
  for (let i = 0; i < edges.length; i++) {
    const [a, b] = edges[i];
    for (let j = i + 1; j < edges.length; j++) {
      const [c, d] = edges[j];
      if (a === c || a === d || b === c || b === d) continue;
      if (segmentsCross(pts[a][0], pts[a][1], pts[b][0], pts[b][1], pts[c][0], pts[c][1], pts[d][0], pts[d][1])) return false;
    }
    for (let v = 0; v < pts.length; v++) {
      if (v === a || v === b) continue;
      if (pointSegmentDistance(pts[v][0], pts[v][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]) < gap) return false;
    }
  }
  return true;
}

const round3 = (x) => Math.round(x * 1000) / 1000;

/**
 * Детерминированный джиттер ±JITTER шага; при конфликте геометрии амплитуда делится пополам.
 * Если и базовая решётка (без джиттера) не проходит geometryOk — null: затравка отвергается, а не
 * выпускается с прижатыми узлами.
 */
function jitterNodes(rng, base, edges, gap) {
  const jx = base.map(() => (rng.next() * 2 - 1) * JITTER);
  const jy = base.map(() => (rng.next() * 2 - 1) * JITTER);
  let amp = 1;
  for (let k = 0; k < 5; k++) {
    const pts = base.map(([x, y], i) => [round3(x + jx[i] * amp), round3(y + jy[i] * amp)]);
    if (geometryOk(pts, edges, gap)) return pts;
    amp /= 2;
  }
  const plain = base.map(([x, y]) => [x, y]);
  return geometryOk(plain, edges, gap) ? plain : null;
}

/**
 * generate(seed, spec, levelIndex) → levelData | null.
 * levelData = { w, h, nodes, edges:[[a,b,dir]], start, closed, solution }.
 */
export function generate(seed, spec, levelIndex) {
  const rng = mulberry32(seed);
  const level = effectiveLevel(spec, levelIndex);
  const [edgesMin, edgesMax] = spec.edges;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const [w, h] = spec.grids[rng.int(spec.grids.length)];
    const cand = buildCandidates(w, h);
    const L = edgesMin + rng.int(edgesMax - edgesMin + 1);
    const rules = curveRules(level, L);
    const wantCircuit = rules.closed || rng.next() < spec.circuitShare;

    let trail = null;
    for (let r = 0; r < MAX_WALK_RESTARTS && !trail; r++) {
      trail = randomTrail(rng, cand, L, wantCircuit, edgesMin, edgesMax);
    }
    if (!trail) continue;

    // Перенумерация используемых узлов, степени, список смежности по использованным рёбрам.
    const remap = new Int32Array(cand.n).fill(-1);
    const usedNodes = [];
    for (const v of trail.nodes) {
      if (remap[v] < 0) {
        remap[v] = usedNodes.length;
        usedNodes.push(v);
      }
    }
    const E = trail.edges.length;
    const deg = new Int32Array(cand.n);
    const adjUsed = Array.from({ length: cand.n }, () => []);
    for (const e of trail.edges) {
      deg[cand.ea[e]]++;
      deg[cand.eb[e]]++;
      adjUsed[cand.ea[e]].push(cand.eb[e]);
      adjUsed[cand.eb[e]].push(cand.ea[e]);
    }
    const finalRules = curveRules(level, E);
    if (!passesFilters(deg, usedNodes, adjUsed, E, finalRules)) continue;

    const solution = trail.nodes.map((v) => remap[v]);
    // Отрезки в порядке эталона: dir=1 ориентирован по направлению прохождения.
    const arrowCount = finalRules.maxArrows > 0 ? 1 + rng.int(finalRules.maxArrows) : 0;
    const arrowed = new Uint8Array(E);
    if (arrowCount > 0) {
      const order = Array.from({ length: E }, (_, i) => i);
      rng.shuffle(order);
      for (let i = 0; i < arrowCount; i++) arrowed[order[i]] = 1;
    }
    const edges = [];
    for (let i = 0; i < E; i++) {
      const a = solution[i];
      const b = solution[i + 1];
      edges.push(arrowed[i] ? [a, b, 1] : [Math.min(a, b), Math.max(a, b), 0]);
    }

    const base = usedNodes.map((v) => [v % w, Math.floor(v / w)]);
    const nodes = jitterNodes(rng, base, edges, minNodeEdgeGap(w, h));
    if (!nodes) continue;
    const levelData = {
      w,
      h,
      nodes,
      edges,
      start: finalRules.fixedStart ? solution[0] : null,
      closed: finalRules.closed,
      solution,
    };
    if (!validate(levelData, solution)) continue;

    const minDifficulty = Math.max(spec.minDifficulty ?? 0, finalRules.minDifficulty);
    const { difficulty, complete } = difficultyOf(levelData, buildGraph(levelData), {
      nodes: 0,
      maxNodes: DIFFICULTY_BUDGET,
    });
    if (!complete || difficulty < minDifficulty) continue;
    return levelData;
  }
  return null;
}

const TIPS = {
  first: { ru: 'Обведи все отрезки одним движением' },
  arrows: { ru: 'По стрелке — только в её направлении' },
  start: { ru: 'Начни с отмеченной точки' },
  odd: { ru: 'Начинать нужно с правильной точки' },
  closed: { ru: 'Закончи там, где начал' },
};

const hasArrows = (lv) => lv.edges.some((e) => e[2] === 1);
/** Две нечётные точки без отмеченного старта: старт нужно найти. */
const hasOddStart = (lv) => {
  if (lv.start != null) return false;
  const deg = new Int32Array(lv.nodes.length);
  for (const [a, b] of lv.edges) deg[a]++, deg[b]++;
  let odd = 0;
  for (const d of deg) if (d & 1) odd++;
  return odd === 2;
};

/**
 * tipFor(levelData, levelIndex, prevLevels) → {ru} | undefined — обязательные подсказки из §3.1:
 * первый уровень, первые стрелки, первый фиксированный старт, первый уровень с двумя нечётными
 * точками, первый closed.
 */
export function tipFor(levelData, levelIndex, prevLevels = []) {
  if (levelIndex === 1 || prevLevels.length === 0) return TIPS.first;
  const firstWith = (pred) => pred(levelData) && !prevLevels.some(pred);
  if (firstWith((lv) => lv.start != null)) return TIPS.start;
  if (firstWith(hasArrows)) return TIPS.arrows;
  if (firstWith((lv) => !!lv.closed)) return TIPS.closed;
  if (firstWith(hasOddStart)) return TIPS.odd;
  return undefined;
}
