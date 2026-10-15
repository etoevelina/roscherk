// Генератор уровней режима «Потоки» (§2.3, §5.2 спеки).
//
// Детерминирован от seed: единственный источник случайности — src/core/rng.js. Все лимиты —
// по числу попыток и узлов поиска, не по времени. Возвращает levelData без служебных полей
// (id/seed/chapter/difficulty/tip дописывает tools/generate.mjs) или null, если затравка
// отвергнута фильтрами и лимитами.

import { mulberry32 } from '../core/rng.js';
import { neighbors, areAdjacent } from '../core/grid.js';
import { solve, neighborTable } from './flow.solve.js';

/** Кривая кампании (§2.3): главы, диапазоны уровней, размер поля и число потоков. */
export const CHAPTERS = [
  { chapter: 1, from: 1, to: 12, minDifficulty: 0, n: 5, minFlows: 4, maxFlows: 6 },
  { chapter: 2, from: 13, to: 35, minDifficulty: 2, n: 6, minFlows: 4, maxFlows: 6 },
  { chapter: 3, from: 36, to: 60, minDifficulty: 2, n: 7, minFlows: 5, maxFlows: 8 },
  { chapter: 4, from: 61, to: 85, minDifficulty: 2, n: 8, minFlows: 6, maxFlows: 10 },
  { chapter: 5, from: 86, to: 100, minDifficulty: 2, n: 9, minFlows: 9, maxFlows: 12 },
];

function poolSpec(chapter, count) {
  const base = CHAPTERS[chapter - 1];
  return {
    chapter,
    count,
    minDifficulty: base.minDifficulty,
    n: base.n,
    minFlows: base.minFlows,
    maxFlows: base.maxFlows,
  };
}

/** Пул «Бесконечности»: 150 уровней по главам. */
export const POOL = [poolSpec(1, 20), poolSpec(2, 30), poolSpec(3, 35), poolSpec(4, 35), poolSpec(5, 30)];

/** Подпул «Ежедневной»: 40 уровней сложности главы 3. */
export const DAILY = poolSpec(3, 40);

/** Лимит узлов солвера для tools/generate.mjs и tools/verify.mjs (§2.3: ≤ 5·10⁶ на вызов). */
export const MAX_NODES = 5e6;

/**
 * allowNonUnique(spec) → для 9×9 уникальность — best effort (§2.3): при обрыве по лимиту узлов
 * уровень принимается с unique:false; n ≤ 8 — уникальность обязательна.
 */
export function allowNonUnique(spec) {
  return spec.n > 8;
}

/**
 * profile(spec, levelIndex) → ключ слота кривой для tools/generate.mjs (§5.2). У «Потоков» правил,
 * зависящих от номера уровня, нет: все слоты спека взаимозаменяемы, ключ один.
 */
export function profile() {
  return 'any';
}

// Лимиты генератора.
const MAX_PATHS = 12; // гамильтоновых путей на затравку
const MAX_CUTS = 20; // разрезаний одного пути
const MAX_REPAIRS = 10; // ремонтов неуникальности одного разрезания
const SOLVE_NODES = { 5: 2e5, 6: 4e5, 7: 8e5, 8: 1.5e6, 9: 2.5e6 }; // лимит узлов солвера по n
const MIN_FLOW_LEN = 3;

/**
 * hamiltonianPath(rng, n) → [cellIdx…]: случайный гамильтонов путь по сетке n×n.
 * Backbite (Mansfield) от «змейки», 100·N ходов; конец пути для шага выбирается случайно.
 */
export function hamiltonianPath(rng, n) {
  const total = n * n;
  const path = new Array(total);
  let k = 0;
  for (let r = 0; r < n; r++) {
    for (let i = 0; i < n; i++) {
      const c = r % 2 === 0 ? i : n - 1 - i;
      path[k++] = r * n + c;
    }
  }
  const pos = new Int16Array(total);
  for (let i = 0; i < total; i++) pos[path[i]] = i;

  const reverseRange = (from, to) => {
    while (from < to) {
      const tmp = path[from];
      path[from] = path[to];
      path[to] = tmp;
      pos[path[from]] = from;
      pos[path[to]] = to;
      from++;
      to--;
    }
  };

  const candidates = [];
  const moves = 100 * total;
  for (let step = 0; step < moves; step++) {
    if (rng.next() < 0.5) reverseRange(0, total - 1);
    const tail = path[total - 1];
    const nbs = neighbors(tail, n);
    candidates.length = 0;
    for (const c of nbs) if (pos[c] !== total - 2) candidates.push(c);
    if (candidates.length === 0) continue;
    const pivot = pos[candidates[rng.int(candidates.length)]];
    reverseRange(pivot + 1, total - 1);
  }
  return path;
}

/**
 * cutPath(path, flowCount, rng) → [[cellIdx…]…]: разрезание пути на flowCount сегментов
 * длиной ≥ 3 (лишние клетки распределяются случайно). null, если клеток не хватает.
 */
export function cutPath(path, flowCount, rng) {
  const total = path.length;
  const extra = total - MIN_FLOW_LEN * flowCount;
  if (extra < 0) return null;
  const lengths = new Array(flowCount).fill(MIN_FLOW_LEN);
  for (let i = 0; i < extra; i++) lengths[rng.int(flowCount)]++;
  const flows = [];
  let at = 0;
  for (let f = 0; f < flowCount; f++) {
    flows.push(path.slice(at, at + lengths[f]));
    at += lengths[f];
  }
  return flows;
}

function isStraight(path, n) {
  const r0 = Math.floor(path[0] / n);
  const c0 = path[0] % n;
  let sameRow = true;
  let sameCol = true;
  for (let i = 1; i < path.length; i++) {
    if (Math.floor(path[i] / n) !== r0) sameRow = false;
    if (path[i] % n !== c0) sameCol = false;
  }
  return sameRow || sameCol;
}

function turnCount(path, n) {
  let turns = 0;
  for (let i = 2; i < path.length; i++) {
    const d1 = path[i - 1] - path[i - 2];
    const d2 = path[i] - path[i - 1];
    if (d1 !== d2) turns++;
  }
  return turns;
}

/**
 * qualityOk(flows, n) → проверка отбора по качеству (§2.3): нет потоков длины 2, не более трети
 * прямых, ≥ 2 потока с ≥ 2 поворотами, менее половины точек «скучены».
 *
 * Скученность: у точки есть смежная точка другого потока. Потоки — последовательные сегменты
 * одного гамильтонова пути, поэтому конец сегмента и начало следующего смежны всегда (это
 * свойство метода, а не дефект уровня); такая пара-«партнёр» из подсчёта исключается, иначе
 * фильтр отвергал бы любой уровень при F ≥ 2. Считаются только дополнительные соседства.
 */
export function qualityOk(flows, n) {
  const flowCount = flows.length;
  const total = n * n;
  let straight = 0;
  let twisty = 0;
  const dotOf = new Int8Array(total).fill(-1);
  const partner = new Int16Array(total).fill(-1);
  for (let f = 0; f < flowCount; f++) {
    const path = flows[f];
    if (path.length < MIN_FLOW_LEN) return false;
    if (isStraight(path, n)) straight++;
    if (turnCount(path, n) >= 2) twisty++;
    dotOf[path[0]] = f;
    dotOf[path[path.length - 1]] = f;
    if (f > 0) {
      const prevEnd = flows[f - 1][flows[f - 1].length - 1];
      if (areAdjacent(prevEnd, path[0], n)) {
        partner[prevEnd] = path[0];
        partner[path[0]] = prevEnd;
      }
    }
  }
  if (straight * 3 > flowCount) return false;
  if (twisty < 2) return false;

  const nb = neighborTable(n);
  let crowded = 0;
  for (let cell = 0; cell < total; cell++) {
    const f = dotOf[cell];
    if (f < 0) continue;
    for (let k = 0; k < 4; k++) {
      const c = nb[cell * 4 + k];
      if (c >= 0 && dotOf[c] >= 0 && dotOf[c] !== f && partner[cell] !== c) {
        crowded++;
        break;
      }
    }
  }
  return crowded < flowCount; // точек 2F; скученных должно быть меньше половины
}

/**
 * splitAtDivergence(flows, solutions, n) → новые flows, где поток, содержащий первую клетку
 * расхождения чужого решения с эталоном, разрезан в этой клетке на два (оба ≥ 3 клеток);
 * null, если ни одна клетка расхождения не допускает разрезания. Среди solutions берётся
 * первое, чья раскраска клеток отличается от эталона.
 */
export function splitAtDivergence(flows, solutions, n) {
  const total = n * n;
  const ref = new Int8Array(total).fill(-1);
  const alt = new Int8Array(total).fill(-1);
  for (let f = 0; f < flows.length; f++) for (const c of flows[f]) ref[c] = f;
  let other = null;
  for (const sol of solutions) {
    alt.fill(-1);
    for (let f = 0; f < sol.length; f++) for (const c of sol[f]) alt[c] = f;
    let differs = false;
    for (let cell = 0; cell < total && !differs; cell++) if (ref[cell] !== alt[cell]) differs = true;
    if (differs) {
      other = sol;
      break;
    }
  }
  if (!other) return null;
  for (let cell = 0; cell < total; cell++) {
    if (ref[cell] === alt[cell]) continue;
    const f = ref[cell];
    const seg = flows[f];
    if (seg.length < 2 * MIN_FLOW_LEN) continue;
    let i = seg.indexOf(cell);
    // Клетка становится концом первого сегмента; оба сегмента должны остаться ≥ 3 клеток.
    if (i < MIN_FLOW_LEN - 1) i = MIN_FLOW_LEN - 1;
    if (i > seg.length - MIN_FLOW_LEN - 1) i = seg.length - MIN_FLOW_LEN - 1;
    const next = flows.slice();
    next.splice(f, 1, seg.slice(0, i + 1), seg.slice(i + 1));
    return next;
  }
  return null;
}

/**
 * generate(seed, spec, levelIndex) → { n, flows, unique } | null.
 * Гамильтонов путь → разрезание на F сегментов → фильтры качества → солвер. При 2 решениях —
 * разрез потока в клетке первого расхождения (F+1, если не превышен maxFlows главы), иначе
 * другие разрезания того же пути, только потом новый путь. Уровни с difficulty ниже порога
 * главы также отвергаются (как и другие разрезания). Уникальность для n ≤ 8 обязательна;
 * для 9×9 при исчерпании лимита узлов уровень принимается с unique:false.
 */
export function generate(seed, spec, levelIndex = 0) {
  const rng = mulberry32(seed);
  const n = spec.n;
  const maxNodes = SOLVE_NODES[n] || 1e6;
  const minDifficulty = spec.minDifficulty || 0;
  const flowRange = spec.maxFlows - spec.minFlows + 1;

  for (let p = 0; p < MAX_PATHS; p++) {
    const path = hamiltonianPath(rng, n);
    for (let cut = 0; cut < MAX_CUTS; cut++) {
      let flows = cutPath(path, spec.minFlows + rng.int(flowRange), rng);
      if (!flows || !qualityOk(flows, n)) continue;

      for (let repair = 0; repair <= MAX_REPAIRS; repair++) {
        const res = solve({ n, flows }, { maxNodes, maxSolutions: 2 });
        if (res.solutions.length === 1) {
          if (res.complete) {
            if (res.difficulty < minDifficulty) break;
            return { n, flows, unique: true };
          }
          if (n >= 9) return { n, flows, unique: false };
          break;
        }
        if (res.solutions.length !== 2) break; // эталон не найден — только при обрыве по лимиту
        if (flows.length >= spec.maxFlows) break;
        const next = splitAtDivergence(flows, res.solutions, n);
        if (!next || !qualityOk(next, n)) break;
        flows = next;
      }
    }
  }
  return null;
}

/** Обязательные подсказки (§3.1): уровни 1 и 2 кампании. levelIndex — номер уровня с 1. */
export function tipFor(levelData, levelIndex, prevLevels) {
  if (levelIndex === 1) return { ru: 'Соедини пары одного цвета и заполни все клетки' };
  if (levelIndex === 2) return { ru: 'Веди по чужой дорожке, чтобы разрезать её' };
  return undefined;
}
