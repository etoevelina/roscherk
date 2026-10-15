// Солвер режима «Потоки» (§2.3, §5.3 спеки).
//
// Данные уровня: { n, flows: [[cellIdx…]…] } — эталонное решение; точки потока — первая и
// последняя клетки его дорожки. Решение — массив дорожек (по одной на поток, от первой точки
// ко второй), покрывающих все клетки поля.
//
// Поиск — DFS с корректными (sound) отсечениями, не способными отрезать существующее решение.
// Расширяемый поток — детерминированная функция состояния (незавершённый поток с наименьшим
// числом вариантов, при равенстве — с меньшим индексом; у потока — голова с меньшим числом
// вариантов, при равенстве — первая), поэтому каждое заполнение считается ровно один раз.
// Все лимиты — по числу узлов, не по времени.
//
// Эвристика «нет 2×2 одного цвета» намеренно не используется: она режет легитимные заполнения.

import { areAdjacent } from '../core/grid.js';

const NEIGHBOR_TABLES = new Map();

/**
 * neighborTable(n) → Int16Array(n²·4): соседи клетки в порядке вверх, вправо, вниз, влево;
 * −1 — соседа нет. Таблица кэшируется по n.
 */
export function neighborTable(n) {
  let table = NEIGHBOR_TABLES.get(n);
  if (table) return table;
  const total = n * n;
  table = new Int16Array(total * 4).fill(-1);
  for (let idx = 0; idx < total; idx++) {
    const r = Math.floor(idx / n);
    const c = idx - r * n;
    if (r > 0) table[idx * 4] = idx - n;
    if (c < n - 1) table[idx * 4 + 1] = idx + 1;
    if (r < n - 1) table[idx * 4 + 2] = idx + n;
    if (c > 0) table[idx * 4 + 3] = idx - 1;
  }
  NEIGHBOR_TABLES.set(n, table);
  return table;
}

/** solutionOf(levelData) → эталонное решение из данных (копия дорожек). */
export function solutionOf(levelData) {
  return levelData.flows.map((path) => path.slice());
}

/**
 * validate(levelData, solution) → true, если solution — корректное заполнение по правилам:
 * по одной дорожке на поток, концы дорожки — точки потока (в любом порядке), шаги по
 * вертикали/горизонтали, клетки не повторяются, заполнены все n² клеток.
 */
export function validate(levelData, solution) {
  const { n, flows } = levelData;
  const total = n * n;
  if (!Array.isArray(solution) || solution.length !== flows.length) return false;
  const seen = new Uint8Array(total);
  let covered = 0;
  for (let f = 0; f < flows.length; f++) {
    const path = solution[f];
    const ref = flows[f];
    if (!Array.isArray(path) || path.length < 2 || ref.length < 2) return false;
    const a = ref[0];
    const b = ref[ref.length - 1];
    const first = path[0];
    const last = path[path.length - 1];
    if (!((first === a && last === b) || (first === b && last === a))) return false;
    for (let i = 0; i < path.length; i++) {
      const cell = path[i];
      if (!Number.isInteger(cell) || cell < 0 || cell >= total) return false;
      if (seen[cell]) return false;
      seen[cell] = 1;
      if (i > 0 && !areAdjacent(path[i - 1], cell, n)) return false;
    }
    covered += path.length;
  }
  return covered === total;
}

/**
 * solve(levelData, { maxNodes = 5e6, maxSolutions = 2 }) →
 *   { solutions: [решение…] (≤ maxSolutions), nodes, difficulty, complete }.
 * complete = false, если поиск остановлен лимитом узлов (тогда solutions и difficulty — частичные).
 * difficulty — число настоящих развилок (§2.0): узлов, где после пропагации принудительных ходов
 * у выбранной головы ≥ 2 легальных продолжения и хотя бы одна ложная ветвь живёт ≥ 3 шагов.
 */
export function solve(levelData, { maxNodes = 5e6, maxSolutions = 2 } = {}) {
  const n = levelData.n;
  const total = n * n;
  const flows = levelData.flows;
  const flowCount = flows.length;
  const nb = neighborTable(n);

  const result = { solutions: [], nodes: 0, difficulty: 0, complete: true };
  if (flowCount === 0 || total === 0) return result;

  // owner[cell] — индекс потока или −1; par[cell] — предыдущая клетка в сторону своей точки;
  // head[f*2+s] — текущая голова s-й стороны потока f; done[f] — поток соединён.
  const owner = new Int8Array(total).fill(-1);
  const par = new Int16Array(total).fill(-1);
  const head = new Int16Array(flowCount * 2);
  const done = new Uint8Array(flowCount);
  const dotA = new Int16Array(flowCount);
  const dotB = new Int16Array(flowCount);

  for (let f = 0; f < flowCount; f++) {
    const path = flows[f];
    if (!Array.isArray(path) || path.length < 2) return result;
    const a = path[0];
    const b = path[path.length - 1];
    if (a === b || a < 0 || b < 0 || a >= total || b >= total) return result;
    if (owner[a] !== -1 || owner[b] !== -1) return result;
    owner[a] = f;
    owner[b] = f;
    head[f * 2] = a;
    head[f * 2 + 1] = b;
    dotA[f] = a;
    dotB[f] = b;
  }

  // Журнал изменений для отката: по 4 числа на операцию (cell, f, s, prevHead); cell = −1 — соединение.
  const trail = new Int32Array((total + flowCount + 8) * 4);
  let trailTop = 0;
  let unfinished = flowCount;
  let empty = total - flowCount * 2;

  // Буферы для отсечения по компонентам пустых клеток.
  const label = new Int16Array(total);
  const queue = new Int16Array(total);
  const served = new Uint8Array(total);

  let nodes = 0;
  let aborted = false;
  let difficulty = 0;
  const solutions = result.solutions;

  function apply(f, s, cell) {
    const h = head[f * 2 + s];
    trail[trailTop] = cell;
    trail[trailTop + 1] = f;
    trail[trailTop + 2] = s;
    trail[trailTop + 3] = h;
    trailTop += 4;
    if (cell === head[f * 2 + 1 - s]) {
      trail[trailTop - 4] = -1;
      done[f] = 1;
      unfinished--;
      return;
    }
    owner[cell] = f;
    par[cell] = h;
    head[f * 2 + s] = cell;
    empty--;
  }

  function undoTo(mark) {
    while (trailTop > mark) {
      trailTop -= 4;
      const cell = trail[trailTop];
      const f = trail[trailTop + 1];
      if (cell === -1) {
        done[f] = 0;
        unfinished++;
      } else {
        owner[cell] = -1;
        par[cell] = -1;
        head[f * 2 + trail[trailTop + 2]] = trail[trailTop + 3];
        empty++;
      }
    }
  }

  /** Число легальных ходов головы (пустые соседи + вторая голова, если смежна). */
  function headOptions(f, s) {
    const h = head[f * 2 + s];
    const other = head[f * 2 + 1 - s];
    let count = 0;
    for (let k = 0; k < 4; k++) {
      const c = nb[h * 4 + k];
      if (c < 0) continue;
      if (owner[c] === -1 || c === other) count++;
    }
    return count;
  }

  function isHead(cell) {
    const f = owner[cell];
    return f >= 0 && !done[f] && (head[f * 2] === cell || head[f * 2 + 1] === cell);
  }

  /**
   * Один проход пропагации: −1 — противоречие; 1 — сделан принудительный ход; 0 — ходов нет.
   * Правила: у головы ровно один легальный ход — делаем его; у пустой клетки < 2 свободных
   * соседей — противоречие; ровно 2 и среди них голова — голова обязана войти в эту клетку.
   */
  function propagateOnce() {
    for (let f = 0; f < flowCount; f++) {
      if (done[f]) continue;
      for (let s = 0; s < 2; s++) {
        const h = head[f * 2 + s];
        const other = head[f * 2 + 1 - s];
        let count = 0;
        let option = -1;
        for (let k = 0; k < 4; k++) {
          const c = nb[h * 4 + k];
          if (c < 0) continue;
          if (owner[c] === -1 || c === other) {
            count++;
            option = c;
          }
        }
        if (count === 0) return -1;
        if (count === 1) {
          apply(f, s, option);
          return 1;
        }
      }
    }
    for (let e = 0; e < total; e++) {
      if (owner[e] !== -1) continue;
      let free = 0;
      let headCell = -1;
      let headFlow = -1;
      let conflict = false;
      for (let k = 0; k < 4; k++) {
        const c = nb[e * 4 + k];
        if (c < 0) continue;
        if (owner[c] === -1) {
          free++;
        } else if (isHead(c)) {
          free++;
          if (headCell === -1) {
            headCell = c;
            headFlow = owner[c];
          } else if (owner[c] !== headFlow) {
            conflict = true;
          }
        }
      }
      if (free < 2) return -1;
      if (free === 2 && headCell !== -1) {
        if (conflict) return -1;
        const s = head[headFlow * 2] === headCell ? 0 : 1;
        apply(headFlow, s, e);
        return 1;
      }
    }
    return 0;
  }

  /**
   * Отсечение по компонентам пустых клеток: головы каждого незавершённого потока связаны
   * (смежны или касаются одной компоненты), и каждая компонента касается обеих голов
   * хотя бы одного незавершённого потока (иначе её нечем заполнить).
   */
  function prune() {
    label.fill(-1);
    let comps = 0;
    for (let e = 0; e < total; e++) {
      if (owner[e] !== -1 || label[e] !== -1) continue;
      label[e] = comps;
      let qh = 0;
      let qt = 0;
      queue[qt++] = e;
      while (qh < qt) {
        const cur = queue[qh++];
        for (let k = 0; k < 4; k++) {
          const c = nb[cur * 4 + k];
          if (c >= 0 && owner[c] === -1 && label[c] === -1) {
            label[c] = comps;
            queue[qt++] = c;
          }
        }
      }
      comps++;
    }
    for (let i = 0; i < comps; i++) served[i] = 0;
    for (let f = 0; f < flowCount; f++) {
      if (done[f]) continue;
      const a = head[f * 2];
      const b = head[f * 2 + 1];
      let connected = false;
      for (let k = 0; k < 4; k++) {
        const ca = nb[a * 4 + k];
        if (ca < 0) continue;
        if (ca === b) {
          connected = true;
          continue;
        }
        if (owner[ca] !== -1) continue;
        const la = label[ca];
        for (let m = 0; m < 4; m++) {
          const cb = nb[b * 4 + m];
          if (cb >= 0 && owner[cb] === -1 && label[cb] === la) {
            served[la] = 1;
            connected = true;
          }
        }
      }
      if (!connected) return false;
    }
    for (let i = 0; i < comps; i++) if (!served[i]) return false;
    return true;
  }

  function recordSolution() {
    const paths = new Array(flowCount);
    for (let f = 0; f < flowCount; f++) {
      const fromA = [];
      for (let c = head[f * 2]; c !== -1; c = par[c]) fromA.push(c);
      fromA.reverse();
      for (let c = head[f * 2 + 1]; c !== -1; c = par[c]) fromA.push(c);
      paths[f] = fromA;
    }
    solutions.push(paths);
  }

  /** Возвращает максимальную глубину (число размещённых клеток) под этим узлом. */
  function dfs() {
    nodes++;
    if (nodes > maxNodes) {
      aborted = true;
      return 0;
    }
    const mark = trailTop;
    let steps = 0;
    let r;
    while ((r = propagateOnce()) === 1) steps++;
    if (r === -1) {
      undoTo(mark);
      return steps;
    }
    if (unfinished === 0) {
      // Все потоки соединены: решение только при полном заполнении поля.
      if (empty === 0) recordSolution();
      undoTo(mark);
      return steps;
    }
    if (!prune()) {
      undoTo(mark);
      return steps;
    }

    // Выбор потока и головы для ветвления.
    let bestFlow = -1;
    let bestSide = 0;
    let bestCount = 99;
    for (let f = 0; f < flowCount; f++) {
      if (done[f]) continue;
      const ca = headOptions(f, 0);
      const cb = headOptions(f, 1);
      const count = ca < cb ? ca : cb;
      if (count < bestCount) {
        bestCount = count;
        bestFlow = f;
        bestSide = ca <= cb ? 0 : 1;
      }
    }

    const f = bestFlow;
    const s = bestSide;
    const h = head[f * 2 + s];
    const other = head[f * 2 + 1 - s];
    let fork = false;
    let deepest = 0;
    for (let k = 0; k < 4; k++) {
      const c = nb[h * 4 + k];
      if (c < 0 || !(owner[c] === -1 || c === other)) continue;
      const childMark = trailTop;
      const before = solutions.length;
      apply(f, s, c);
      const depth = 1 + dfs();
      undoTo(childMark);
      if (depth > deepest) deepest = depth;
      if (solutions.length === before && depth >= 3) fork = true;
      if (aborted || solutions.length >= maxSolutions) break;
    }
    if (fork && bestCount >= 2) difficulty++;
    undoTo(mark);
    return steps + deepest;
  }

  dfs();

  result.nodes = nodes;
  result.difficulty = difficulty;
  result.complete = !aborted;
  return result;
}
