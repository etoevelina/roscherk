// Генератор уровней режима «Маршрут» (zip) — §2.2, §5.2 спеки.
// Детерминирован от seed: единственный источник случайности — src/core/rng.js.
// Возвращает levelData { n, path, marks, walls } без служебных полей либо null (затравка отвергнута).
import { mulberry32 } from '../core/rng.js';
import { neighbors } from '../core/grid.js';
import { solve, validate } from './zip.solve.js';

// Параметры глав (§2.2 «Кривая»): n — сторона поля, marksMin/marksMax — диапазон чисел,
// maxWalls — предел стен (0 — без стен), wallsFromLevel — стены только с этого levelIndex,
// profiles — чередование профилей «много чисел, 0–2 стены» (чётный levelIndex) / «мало чисел,
// стены до лимита» (нечётный), minDifficulty — порог тривиальности (§2.0); marksCap
// (необязательно) — верхний предел чисел после ремонта (по умолчанию marksMax + 1).
// profileWalls / profileMarksCap (необязательно) — пределы стен и чисел профиля «много чисел».
// Глава 5 (8×8): при строгих «≤ 2 стены, ≤ 10 чисел» уникальная затравка — ~1 % (десятки секунд
// на уровень), поэтому профиль там ослаблен до ≤ 3 стен и ≤ 12 чисел — отклонение от §2.2,
// подлежащее явной фиксации в спеке.
const CH1 = { n: 4, marksMin: 3, marksMax: 5, maxWalls: 0, minDifficulty: 1 };
const CH2 = { n: 5, marksMin: 4, marksMax: 6, maxWalls: 5, wallsFromLevel: 15, minDifficulty: 1 };
const CH3 = { n: 6, marksMin: 4, marksMax: 7, maxWalls: 6, minDifficulty: 3 };
const CH4 = { n: 7, marksMin: 4, marksMax: 8, maxWalls: 7, minDifficulty: 3, profiles: true };
const CH5 = { n: 8, marksMin: 5, marksMax: 9, maxWalls: 8, minDifficulty: 3, profiles: true, profileWalls: 3, profileMarksCap: 12 };

export const CHAPTERS = [
  { chapter: 1, from: 1, to: 6, ...CH1 },
  { chapter: 2, from: 7, to: 25, ...CH2 },
  { chapter: 3, from: 26, to: 45, ...CH3 },
  { chapter: 4, from: 46, to: 70, ...CH4 },
  { chapter: 5, from: 71, to: 100, ...CH5 },
];

// Пул «Бесконечности»: 150 уровней по главам. В главе 2 стены — у половины пула (индекс ≥ 15).
export const POOL = [
  { chapter: 1, count: 20, ...CH1 },
  { chapter: 2, count: 30, ...CH2 },
  { chapter: 3, count: 35, ...CH3 },
  { chapter: 4, count: 35, ...CH4 },
  { chapter: 5, count: 30, ...CH5 },
];

export const DAILY = { chapter: 3, count: 40, ...CH3 };

const MAX_SOLVER_CALLS = 10;
const MAX_NODES = 2_000_000;
const MAX_PATH_TRIES = 5;
const REPAIR_SOLUTIONS = 256; // альтернатив за вызов солвера при ремонте
const STRAIGHT_LIMIT = 0.4;
const MARKS_PROFILE_WALLS = 2; // предел стен профиля «много чисел, 0–2 стены» (§2.2)

/**
 * Backbite (Mansfield): случайный гамильтонов путь из «змейки» за moves ходов.
 * path — массив клеток (мутируется), pos — обратный индекс. Конец для шага выбирается случайно.
 */
function backbite(path, pos, n, moves, rng) {
  const N = n * n;
  for (let step = 0; step < moves; step++) {
    // Случайный конец: при выборе начала разворачиваем путь целиком, чтобы работать с хвостом.
    if (rng.int(2) === 0) {
      path.reverse();
      for (let i = 0; i < N; i++) pos[path[i]] = i;
    }
    const tail = path[N - 1];
    const nb = neighbors(tail, n);
    const v = nb[rng.int(nb.length)];
    const i = pos[v];
    if (i === N - 2) continue; // сосед по пути — ход ничего не меняет
    // Разворот отрезка path[i+1 … N-1].
    let lo = i + 1;
    let hi = N - 1;
    while (lo < hi) {
      const tmp = path[lo];
      path[lo] = path[hi];
      path[hi] = tmp;
      lo++;
      hi--;
    }
    for (let k = i + 1; k < N; k++) pos[path[k]] = k;
  }
}

/** Доля клеток пути, лежащих в прямых отрезках из ≥ minLen клеток (≥ minLen−1 рёбер). */
function straightFraction(path, n, minLen) {
  const N = path.length;
  let cells = 0;
  let run = 2; // клеток в текущем прямом отрезке
  for (let i = 2; i <= N; i++) {
    const same = i < N && path[i] - path[i - 1] === path[i - 1] - path[i - 2];
    if (same) {
      run++;
    } else {
      if (run >= minLen) cells += run;
      run = 2;
    }
  }
  return cells / N;
}

/** Случайный гамильтонов путь с фильтром прямых отрезков; null, если фильтр не пройден. */
function randomPath(n, rng) {
  const N = n * n;
  const path = new Array(N);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) path[r * n + c] = r * n + (r % 2 === 0 ? c : n - 1 - c);
  }
  const pos = new Int16Array(N);
  for (let i = 0; i < N; i++) pos[path[i]] = i;
  for (let attempt = 0; attempt < MAX_PATH_TRIES; attempt++) {
    backbite(path, pos, n, 100 * N, rng);
    if (straightFraction(path, n, n) <= STRAIGHT_LIMIT) return path;
  }
  return null;
}

/**
 * Позиции контрольных точек на пути: 0, N-1 и K-2 промежуточных — равномерно с джиттером.
 * Возвращает отсортированный массив позиций.
 */
function markPositions(N, K, rng) {
  const positions = [0];
  const spacing = (N - 1) / (K - 1);
  for (let j = 1; j <= K - 2; j++) {
    const ideal = spacing * j;
    const jitter = (rng.next() * 2 - 1) * spacing * 0.3;
    let p = Math.round(ideal + jitter);
    const minP = positions[positions.length - 1] + 1;
    const maxP = N - 1 - (K - 1 - j); // место для оставшихся точек и конца
    if (p < minP) p = minP;
    if (p > maxP) p = maxP;
    positions.push(p);
  }
  positions.push(N - 1);
  return positions;
}

/** Ключ ребра между соседними клетками (a<b). */
function edgeKey(a, b, N) {
  return a < b ? a * N + b : b * N + a;
}

/** marks из отсортированных позиций на пути: [[cellIdx, number]…], числа 1…K по порядку пути. */
function buildMarks(path, positions) {
  return positions.map((p, i) => [path[p], i + 1]);
}

/**
 * Можно ли поставить стену (a,b): это не ребро пути, не дубликат, и после неё у каждой
 * клетки (кроме начала и конца пути) остаётся ≥ 2 свободных соседа.
 */
function wallAllowed(a, b, ctx) {
  const key = edgeKey(a, b, ctx.N);
  if (ctx.pathEdges.has(key) || ctx.wallKeys.has(key)) return false;
  const minA = a === ctx.start || a === ctx.goal ? 1 : 2;
  const minB = b === ctx.start || b === ctx.goal ? 1 : 2;
  return ctx.freeDeg[a] - 1 >= minA && ctx.freeDeg[b] - 1 >= minB;
}

function addWall(a, b, ctx) {
  ctx.wallKeys.add(edgeKey(a, b, ctx.N));
  ctx.walls.push(a < b ? [a, b] : [b, a]);
  ctx.freeDeg[a]--;
  ctx.freeDeg[b]--;
}

/**
 * Сколько альтернативных решений убивает контрольная точка в клетке с позицией pos на пути.
 * Точка убивает альтернативу, если та посещает клетку вне интервала между соседними по пути
 * точками (порядок чисел нарушается).
 */
function markKills(pos, positions, path, altPosList) {
  let lo = -1;
  let hi = Number.MAX_SAFE_INTEGER;
  for (const p of positions) {
    if (p < pos && p > lo) lo = p;
    if (p > pos && p < hi) hi = p;
  }
  const cell = path[pos];
  let kills = 0;
  for (const altPos of altPosList) {
    const a = altPos[cell];
    if (a < altPos[path[lo]] || a > altPos[path[hi]]) kills++;
  }
  return kills;
}

/** Лучшая по числу убитых альтернатив точка: позиция на пути и число убитых (0 — нет полезной). */
function bestMark(div, N, positions, path, altPosList) {
  let bestPos = -1;
  let bestKills = 0;
  for (let d = 0; d < N; d++) {
    for (let side = 0; side < (d === 0 ? 1 : 2); side++) {
      const pos = side === 0 ? div - d : div + d;
      if (pos <= 0 || pos >= N - 1 || positions.includes(pos)) continue;
      const k = markKills(pos, positions, path, altPosList);
      if (k > bestKills) {
        bestKills = k;
        bestPos = pos;
      }
    }
  }
  return { pos: bestPos, kills: bestKills };
}

/** Лучшая стена: ребро вне пути, которым пользуется больше всего альтернатив, с учётом степеней. */
function bestWall(alts, ctx) {
  const N = ctx.N;
  const useCount = new Map();
  for (const alt of alts) {
    for (let k = 1; k < N; k++) {
      const key = edgeKey(alt[k - 1], alt[k], N);
      if (ctx.pathEdges.has(key)) continue;
      useCount.set(key, (useCount.get(key) || 0) + 1);
    }
  }
  let bestKey = -1;
  let bestUse = 0;
  for (const [key, cnt] of useCount) {
    const a = (key / N) | 0;
    const b = key - a * N;
    if (cnt > bestUse && wallAllowed(a, b, ctx)) {
      bestUse = cnt;
      bestKey = key;
    }
  }
  return { key: bestKey, kills: bestUse };
}

/**
 * Профиль кривой для номера уровня: wallsAllowed — стены разрешены (spec.maxWalls и wallsFromLevel),
 * manyMarks — профиль «много чисел, 0–2 стены» (чётный levelIndex в главах с profiles),
 * key — ключ слота для tools/generate.mjs (см. profile()).
 */
function profileOf(spec, levelIndex) {
  const idx = levelIndex | 0;
  const wallsAllowed = spec.maxWalls > 0 && (spec.wallsFromLevel === undefined || idx >= spec.wallsFromLevel);
  const manyMarks = !!spec.profiles && wallsAllowed && idx % 2 === 0;
  let key = 'base';
  if (wallsAllowed) key = spec.profiles ? (manyMarks ? 'marks' : 'walls') : 'walls';
  else if (spec.maxWalls > 0) key = 'no-walls';
  return { wallsAllowed, manyMarks, key };
}

/**
 * profile(spec, levelIndex) → ключ слота кривой для tools/generate.mjs: кандидат, сгенерированный
 * под levelIndex, годится только в слот с тем же ключом, иначе позиция уровня в кампании отрывалась
 * бы от правил кривой («стены с 15-го», чередование профилей глав 4–5). Ключи: 'base' (глава без
 * стен), 'no-walls' / 'walls' (до и после wallsFromLevel), 'marks' / 'walls' (профили глав 4–5).
 */
export function profile(spec, levelIndex) {
  return profileOf(spec, levelIndex).key;
}

/**
 * generate(seed, spec, levelIndex) → levelData | null.
 * levelIndex — номер уровня кампании (1-based, для CHAPTERS) либо порядковый номер в наборе
 * (POOL/DAILY): влияет на порог появления стен (spec.wallsFromLevel) и чередование профилей.
 * Алгоритм — §2.2 «Генерация»: backbite-путь → контрольные точки → стены → солвер →
 * ремонт неуникальности → жадное удаление точек при сохранении уникальности → фильтр по minDifficulty.
 */
export function generate(seed, spec, levelIndex = 0) {
  return generateDetailed(seed, spec, levelIndex).level;
}

/**
 * generateDetailed(seed, spec, levelIndex) → { level, reason, calls }: как generate, но с причиной
 * отказа ('path', 'incomplete', 'repair-*', 'difficulty') и числом вызовов солвера — для диагностики.
 *
 * Ремонт неуникальности: солвер отдаёт выборку альтернатив (до REPAIR_SOLUTIONS за вызов);
 * контрольная точка ставится там, где она убивает больше всего альтернатив (при равенстве —
 * ближе к клетке первого расхождения); стена — ребро вне пути, которым пользуется больше всего
 * альтернатив. Профиль «много чисел» предпочитает точки (стена — если точка не помогла),
 * профиль «мало чисел, стены до лимита» — стены, пока их лимит не исчерпан. Между вызовами
 * солвера выборка перепроверяется validate(), чтобы одна правка убивала сразу много альтернатив.
 */
export function generateDetailed(seed, spec, levelIndex = 0) {
  const rng = mulberry32(seed);
  const n = spec.n;
  const N = n * n;
  const { wallsAllowed, manyMarks } = profileOf(spec, levelIndex);

  // Профиль уровня: начальное число точек, начальные стены, пределы и порядок предпочтения
  // при ремонте. Начальные точки ставятся по нижней части диапазона: точки, поставленные
  // ремонтом по выборке альтернатив, гораздо ценнее равномерных. Начальных стен — около
  // половины предела, остаток нужен ремонту.
  let wallCap = wallsAllowed ? spec.maxWalls : 0;
  let marksCap = spec.marksCap ?? spec.marksMax + 1; // верхний предел после ремонта (§2.2)
  let K0 = spec.marksMin;
  let marksFloor = spec.marksMin; // ниже этого жадное удаление точек не опускается
  let wallsTarget = 0;
  let preferWalls = false;
  if (spec.profiles && wallsAllowed) {
    if (manyMarks) {
      // «Много чисел, 0–2 стены» (§2.2): стен не больше profileWalls (по умолчанию 2), начальных —
      // 0–1, ремонт — точками (стена — если точка не помогла). Начальных точек — минимум главы:
      // точки, поставленные ремонтом по выборке альтернатив, ценнее равномерных, а жадное удаление
      // не опускает их число ниже marksMax − 1, так что чисел в итоге — верх диапазона.
      wallCap = Math.min(wallCap, spec.profileWalls ?? MARKS_PROFILE_WALLS);
      marksCap = spec.profileMarksCap ?? marksCap;
      marksFloor = Math.max(spec.marksMin, spec.marksMax - 1);
      wallsTarget = rng.int(2);
    } else {
      // «Мало чисел, стены до лимита»: половина стен сразу, при ремонте сначала стены.
      wallsTarget = Math.ceil(wallCap / 2);
      preferWalls = true;
    }
  } else {
    K0 = spec.marksMin + rng.int(Math.max(1, Math.floor((spec.marksMax - spec.marksMin) / 2) + 1));
    if (wallsAllowed) wallsTarget = 1 + rng.int(Math.ceil(wallCap / 2));
  }

  // 1. Гамильтонов путь.
  const path = randomPath(n, rng);
  if (!path) return { level: null, reason: 'path', calls: 0 };
  const start = path[0];
  const goal = path[N - 1];
  const pathEdges = new Set();
  for (let i = 1; i < N; i++) pathEdges.add(edgeKey(path[i - 1], path[i], N));

  // 2. Контрольные точки — равномерно с джиттером.
  let positions = markPositions(N, K0, rng);

  // 3. Стены между соседями, не идущими подряд в пути.
  const ctx = {
    N,
    start,
    goal,
    pathEdges,
    wallKeys: new Set(),
    walls: [],
    freeDeg: new Uint8Array(N),
  };
  for (let i = 0; i < N; i++) ctx.freeDeg[i] = neighbors(i, n).length;
  if (wallsTarget > 0) {
    const candidates = [];
    for (let a = 0; a < N; a++) {
      for (const b of neighbors(a, n)) {
        if (b > a && !pathEdges.has(edgeKey(a, b, N))) candidates.push([a, b]);
      }
    }
    rng.shuffle(candidates);
    for (const [a, b] of candidates) {
      if (ctx.walls.length >= wallsTarget) break;
      if (wallAllowed(a, b, ctx)) addWall(a, b, ctx);
    }
  }

  // 4. Солвер и ремонт неуникальности (≤ MAX_SOLVER_CALLS вызовов солвера на уровень).
  let calls = 0;
  let marks = buildMarks(path, positions);
  let result = null;
  while (calls < MAX_SOLVER_CALLS) {
    result = solve({ n, marks, walls: ctx.walls }, { maxNodes: MAX_NODES, maxSolutions: REPAIR_SOLUTIONS });
    calls++;
    if (!result.complete) return { level: null, reason: 'incomplete', calls };
    if (result.solutions.length === 0) return { level: null, reason: 'nosolution', calls }; // невозможно по построению; защита
    if (result.solutions.length === 1) break;

    let alts = result.solutions.filter((s) => !sameArray(s, path));
    if (alts.length === 0) return { level: null, reason: 'nosolution', calls };
    while (alts.length > 0) {
      const altPosList = alts.map((alt) => {
        const ap = new Int16Array(N);
        for (let i = 0; i < N; i++) ap[alt[i]] = i;
        return ap;
      });
      let div = 0;
      while (div < N && alts[0][div] === path[div]) div++;

      const mark = positions.length < marksCap ? bestMark(div, N, positions, path, altPosList) : { pos: -1, kills: 0 };
      const wall = ctx.walls.length < wallCap ? bestWall(alts, ctx) : { key: -1, kills: 0 };
      const useWall = wall.kills > 0 && (mark.kills === 0 || preferWalls);
      if (useWall) {
        addWall((wall.key / N) | 0, wall.key % N, ctx);
      } else if (mark.kills > 0) {
        positions = positions.concat([mark.pos]).sort((a, b) => a - b);
        marks = buildMarks(path, positions);
      } else {
        const reason = positions.length >= marksCap ? (ctx.walls.length >= wallCap ? 'repair-both' : 'repair-marks') : 'repair-walls';
        return { level: null, reason, calls };
      }
      const lvl = { n, marks, walls: ctx.walls };
      alts = alts.filter((alt) => validate(lvl, alt));
    }
    result = null;
  }
  if (!result || result.solutions.length !== 1) return { level: null, reason: 'repair-calls', calls };
  let difficulty = result.difficulty;

  // 5. Жадное удаление промежуточных точек при сохранении уникальности (≤ K попыток).
  const removable = positions.slice(1, -1);
  rng.shuffle(removable);
  for (let attempt = 0; attempt < removable.length && calls < MAX_SOLVER_CALLS; attempt++) {
    if (positions.length <= marksFloor) break;
    const p = removable[attempt];
    const trial = positions.filter((x) => x !== p);
    const trialMarks = buildMarks(path, trial);
    const res = solve({ n, marks: trialMarks, walls: ctx.walls }, { maxNodes: MAX_NODES, maxSolutions: 2 });
    calls++;
    if (res.complete && res.solutions.length === 1) {
      positions = trial;
      marks = trialMarks;
      difficulty = res.difficulty;
    }
  }

  if (difficulty < spec.minDifficulty) return { level: null, reason: 'difficulty', calls };
  return { level: { n, path: path.slice(), marks, walls: ctx.walls.slice() }, reason: null, calls };
}

function sameArray(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * tipFor(levelData, levelIndex, prevLevels) → {ru}|undefined — обязательные подсказки §3.1:
 * уровень 1 — как вести дорожку; первый уровень со стенами — «Сквозь толстые линии нельзя».
 */
export function tipFor(levelData, levelIndex, prevLevels = []) {
  if (levelIndex === 1) {
    const K = levelData.marks.length;
    return { ru: `Проведи пальцем дорожку от 1 до ${K} через все клетки, не отрывая` };
  }
  const hasWalls = levelData.walls && levelData.walls.length > 0;
  if (hasWalls && !prevLevels.some((l) => l.walls && l.walls.length > 0)) {
    return { ru: 'Сквозь толстые линии нельзя' };
  }
  return undefined;
}
