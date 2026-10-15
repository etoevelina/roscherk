// Солвер режима «Маршрут» (zip) — §2.2, §5.3 спеки.
// DFS по гамильтоновым путям от клетки 1 до клетки K с посещением чисел строго по порядку.
// Все отсечения корректны (sound): ни одно не способно отрезать настоящее решение.
// Поле — типизированные массивы, без BigInt; лимит — по числу узлов поиска, не по времени.
import { neighbors, areAdjacent } from '../core/grid.js';

/**
 * Статическая модель уровня: смежность с учётом стен, числа, цвета клеток.
 * Возвращает null, если данные уровня некорректны (числа не образуют 1…K, K < 2 и т.п.).
 */
function buildModel(level) {
  const n = level.n | 0;
  if (n < 2) return null;
  const N = n * n;
  const marks = Array.isArray(level.marks) ? level.marks : [];
  const walls = Array.isArray(level.walls) ? level.walls : [];

  // Числа 1…K ровно по одному, каждое в своей клетке.
  const markOf = new Uint8Array(N);
  let K = 0;
  for (const pair of marks) {
    const cell = pair[0];
    const m = pair[1];
    if (!Number.isInteger(cell) || cell < 0 || cell >= N) return null;
    if (!Number.isInteger(m) || m < 1 || m > 255) return null;
    if (markOf[cell] !== 0) return null;
    markOf[cell] = m;
    if (m > K) K = m;
  }
  if (K < 2 || marks.length !== K) return null;
  const cellOfMark = new Int16Array(K + 1).fill(-1);
  for (const [cell, m] of marks) {
    if (cellOfMark[m] !== -1) return null;
    cellOfMark[m] = cell;
  }

  // Стены: множество ключей a*N+b (a<b), только между ортогональными соседями.
  const wallSet = new Set();
  for (const w of walls) {
    const a = Math.min(w[0], w[1]);
    const b = Math.max(w[0], w[1]);
    if (!areAdjacent(a, b, n)) return null;
    wallSet.add(a * N + b);
  }

  // Смежность без стен: adj[i*4+k], k < deg[i].
  const adj = new Int16Array(N * 4).fill(-1);
  const deg = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    for (const j of neighbors(i, n)) {
      const key = i < j ? i * N + j : j * N + i;
      if (wallSet.has(key)) continue;
      adj[i * 4 + deg[i]] = j;
      deg[i]++;
    }
  }

  const colorOf = new Uint8Array(N);
  for (let i = 0; i < N; i++) colorOf[i] = (((i / n) | 0) + (i % n)) & 1;

  return { n, N, K, markOf, cellOfMark, adj, deg, colorOf, wallSet };
}

/** Эталонное решение из данных уровня (копия массива path). */
export function solutionOf(level) {
  return level.path.slice();
}

/**
 * validate(level, solution) → boolean: решение — гамильтонов путь от 1 до K по клеткам
 * без стен, числа встречаются строго по порядку 1, 2, …, K.
 */
export function validate(level, solution) {
  const model = buildModel(level);
  if (!model) return false;
  const { n, N, K, markOf, cellOfMark, wallSet } = model;
  if (!Array.isArray(solution) || solution.length !== N) return false;
  const seen = new Uint8Array(N);
  let next = 1;
  for (let i = 0; i < N; i++) {
    const cell = solution[i];
    if (!Number.isInteger(cell) || cell < 0 || cell >= N || seen[cell]) return false;
    seen[cell] = 1;
    if (i > 0) {
      const prev = solution[i - 1];
      if (!areAdjacent(prev, cell, n)) return false;
      const key = prev < cell ? prev * N + cell : cell * N + prev;
      if (wallSet.has(key)) return false;
    }
    const m = markOf[cell];
    if (m !== 0) {
      if (m !== next) return false;
      next++;
    }
  }
  return next === K + 1 && solution[0] === cellOfMark[1] && solution[N - 1] === cellOfMark[K];
}

/**
 * solve(level, { maxNodes, maxSolutions }) → { solutions, nodes, difficulty, complete }.
 * solutions — до maxSolutions путей (массивы индексов клеток); nodes — число узлов поиска;
 * complete — поиск не был прерван лимитом узлов (при maxSolutions найденных решениях поиск
 * останавливается, но ответ на вопрос «≥ maxSolutions решений?» полный);
 * difficulty — число настоящих развилок (§2.0): узлов, где после пропагации принудительных
 * ходов ≥ 2 легальных продолжения и хотя бы одна ложная ветвь живёт ≥ 3 шагов до отсечения.
 *
 * Отсечения (все корректные):
 *  - порядок чисел: в клетку с числом можно войти, только если это следующее ожидаемое; в K — только последним ходом;
 *  - паритет шахматной раскраски среди оставшихся клеток и цвет цели;
 *  - степени: непосещённая клетка без свободных соседей — тупик; степени 1 — только цель;
 *  - принудительные рёбра: клетка степени 2 фиксирует оба ребра; у головы и цели ≤ 1 такого ребра,
 *    у прочих ≤ 2, цикл из принудительных рёбер невозможен, а цепь голова–цель должна покрывать всё;
 *  - «порты»: компоненты непосещённых клеток без чисел должны примыкать к паре соседних портов
 *    (голова, следующее число, …, K), и каждая соседняя пара портов — соседи напрямую либо через общую компоненту
 *    (сильнее обычной связности, включает её).
 */
export function solve(level, { maxNodes = 2_000_000, maxSolutions = 2 } = {}) {
  const model = buildModel(level);
  if (!model) return { solutions: [], nodes: 0, difficulty: 0, complete: true };
  const { N, K, markOf, cellOfMark, adj, deg, colorOf } = model;
  const start = cellOfMark[1];
  const goal = cellOfMark[K];

  const visited = new Uint8Array(N);
  const path = new Int16Array(N);
  const degNow = new Uint8Array(N);
  const forcedCnt = new Uint8Array(N);
  const comp = new Int16Array(N);
  const queue = new Int16Array(N);
  const served = new Uint8Array(N);
  const uf = new Int16Array(N);
  const ufSize = new Int16Array(N);
  const colorCnt = [0, 0];
  for (let i = 0; i < N; i++) colorCnt[colorOf[i]]++;

  const solutions = [];
  let nodes = 0;
  let aborted = false;
  let difficulty = 0;

  function find(x) {
    while (uf[x] !== x) {
      uf[x] = uf[uf[x]];
      x = uf[x];
    }
    return x;
  }

  /**
   * Проверка допустимости позиции. Возвращает -1 (тупик), -2 (ход не принуждён) или индекс
   * клетки, в которую ход головы принуждён.
   */
  function check(head, depth, nextMark) {
    const R = N - depth; // непосещённых клеток
    const hc = colorOf[head];

    // Паритет: путь чередует цвета, начиная с противоположного цвету головы.
    if (colorCnt[1 - hc] !== (R + 1) >> 1 || colorCnt[hc] !== R >> 1) return -1;
    if (colorOf[goal] !== ((R & 1) === 1 ? 1 - hc : hc)) return -1;

    // Степени непосещённых клеток (свободные соседи + голова).
    for (let u = 0; u < N; u++) {
      if (visited[u]) continue;
      let d = 0;
      const base = u * 4;
      for (let k = 0; k < deg[u]; k++) {
        const v = adj[base + k];
        if (!visited[v] || v === head) d++;
      }
      if (d === 0) return -1;
      if (d === 1 && u !== goal) return -1;
      degNow[u] = d;
    }

    // Принудительные рёбра: клетки степени ≤ 2 фиксируют все свои рёбра.
    for (let i = 0; i < N; i++) {
      uf[i] = i;
      ufSize[i] = 1;
      forcedCnt[i] = 0;
    }
    // Принуждающая клетка: обычная — со степенью 2 (ей нужны оба ребра), цель — со степенью 1.
    let forcedHead = -2;
    for (let u = 0; u < N; u++) {
      if (visited[u] || degNow[u] > (u === goal ? 1 : 2)) continue;
      const base = u * 4;
      for (let k = 0; k < deg[u]; k++) {
        const v = adj[base + k];
        if (visited[v] && v !== head) continue;
        // Ребро между двумя принуждающими клетками обрабатывается один раз — от меньшего индекса.
        if (v !== head && v < u && degNow[v] <= (v === goal ? 1 : 2)) continue;
        forcedCnt[u]++;
        forcedCnt[v]++;
        if (u === goal && forcedCnt[u] > 1) return -1;
        if (v === head) {
          if (forcedCnt[v] > 1) return -1;
          forcedHead = u;
        } else if (v === goal) {
          if (forcedCnt[v] > 1) return -1;
        } else if (forcedCnt[v] > 2) {
          return -1;
        }
        const ru = find(u);
        const rv = find(v);
        if (ru === rv) return -1; // цикл из принудительных рёбер
        if (ufSize[ru] < ufSize[rv]) {
          uf[ru] = rv;
          ufSize[rv] += ufSize[ru];
        } else {
          uf[rv] = ru;
          ufSize[ru] += ufSize[rv];
        }
      }
    }
    // Если голова и цель уже соединены принудительной цепью, цепь обязана покрывать всё поле.
    {
      const rh = find(head);
      if (rh === find(goal) && ufSize[rh] !== R + 1) return -1;
    }

    // Компоненты непосещённых клеток без чисел.
    comp.fill(-1);
    let ncomp = 0;
    for (let u = 0; u < N; u++) {
      if (visited[u] || markOf[u] !== 0 || comp[u] !== -1) continue;
      let qh = 0;
      let qt = 0;
      queue[qt++] = u;
      comp[u] = ncomp;
      while (qh < qt) {
        const x = queue[qh++];
        const base = x * 4;
        for (let k = 0; k < deg[x]; k++) {
          const v = adj[base + k];
          if (visited[v] || markOf[v] !== 0 || comp[v] !== -1) continue;
          comp[v] = ncomp;
          queue[qt++] = v;
        }
      }
      served[ncomp] = 0;
      ncomp++;
    }

    // Порты: голова, затем числа nextMark…K по порядку. Соседние порты связаны напрямую
    // или через общую компоненту; каждая компонента обслужена хотя бы одной парой.
    let prev = head;
    for (let m = nextMark; m <= K; m++) {
      const q = cellOfMark[m];
      let ok = false;
      const pb = prev * 4;
      const qb = q * 4;
      for (let k = 0; k < deg[prev]; k++) {
        const a = adj[pb + k];
        if (a === q) ok = true;
        if (visited[a] || comp[a] === -1) continue;
        const c = comp[a];
        for (let l = 0; l < deg[q]; l++) {
          const b = adj[qb + l];
          if (!visited[b] && comp[b] === c) {
            ok = true;
            served[c] = 1;
            break;
          }
        }
      }
      if (!ok) return -1;
      prev = q;
    }
    for (let c = 0; c < ncomp; c++) if (!served[c]) return -1;

    return forcedHead;
  }

  /**
   * Узел поиска: голова в head, в пути depth клеток, следующее ожидаемое число nextMark.
   * Возвращает -1, если позиция отсечена, иначе число «живых» уровней ветви (≥ 1).
   */
  function dfs(head, depth, nextMark) {
    nodes++;
    if (nodes > maxNodes) {
      aborted = true;
      return -1;
    }
    if (depth === N) {
      if (head !== goal) return -1;
      solutions.push(Array.from(path));
      return 1;
    }
    const forced = check(head, depth, nextMark);
    if (forced === -1) return -1;

    const before = solutions.length;
    let passing = 0;
    let maxChild = 0;
    let falseDepth = 0;
    const base = head * 4;
    for (let k = 0; k < deg[head]; k++) {
      const b = adj[base + k];
      if (visited[b]) continue;
      if (forced !== -2 && b !== forced) continue;
      const m = markOf[b];
      if (m !== 0) {
        if (m !== nextMark) continue;
        if (b === goal && depth + 1 !== N) continue;
      }
      const solBefore = solutions.length;
      visited[b] = 1;
      path[depth] = b;
      colorCnt[colorOf[b]]--;
      const r = dfs(b, depth + 1, m !== 0 ? nextMark + 1 : nextMark);
      colorCnt[colorOf[b]]++;
      visited[b] = 0;
      if (aborted) return -1;
      if (r >= 0) {
        passing++;
        if (r > maxChild) maxChild = r;
        if (solutions.length === solBefore && r > falseDepth) falseDepth = r;
      }
      if (solutions.length >= maxSolutions) break;
    }
    if (passing >= 2 && falseDepth >= 3 && solutions.length > before) difficulty++;
    return 1 + maxChild;
  }

  visited[start] = 1;
  path[0] = start;
  colorCnt[colorOf[start]]--;
  dfs(start, 1, 2);

  return { solutions, nodes, difficulty, complete: !aborted };
}
