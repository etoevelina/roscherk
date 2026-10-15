// Солвер режима «Один штрих» (§2.4, §5.3 спеки): эйлеров путь по фигуре из точек и отрезков.
// Отрезок с dir=1 проходится только a→b (стрелка), dir=0 — в любую сторону. start — обязательная
// стартовая вершина или null; closed — росчерк должен закончиться в начальной вершине.
//
// Решение — последовательность индексов узлов длиной E+1 (solution[i]→solution[i+1] — i-й отрезок).
// Все лимиты — по числу узлов поиска, не по времени.

const DEFAULT_MAX_NODES = 200_000;

/**
 * buildGraph(level) → граф в CSR-виде с рабочими буферами для проверок.
 * adjStart[v]..adjStart[v+1] — диапазон в adjEdge/adjTo: индекс отрезка и соседняя вершина.
 * Буферы (und, bal, mark, queue) выделяются один раз и переиспользуются в горячих циклах.
 */
export function buildGraph(level) {
  const n = level.nodes.length;
  const E = level.edges.length;
  const ea = new Int32Array(E);
  const eb = new Int32Array(E);
  const ed = new Uint8Array(E);
  const deg = new Int32Array(n + 1);
  for (let e = 0; e < E; e++) {
    const [a, b, dir] = level.edges[e];
    ea[e] = a;
    eb[e] = b;
    ed[e] = dir ? 1 : 0;
    deg[a]++;
    deg[b]++;
  }
  const adjStart = new Int32Array(n + 1);
  for (let v = 0; v < n; v++) adjStart[v + 1] = adjStart[v] + deg[v];
  const fill = adjStart.slice(0, n);
  const adjEdge = new Int32Array(2 * E);
  const adjTo = new Int32Array(2 * E);
  for (let e = 0; e < E; e++) {
    adjEdge[fill[ea[e]]] = e;
    adjTo[fill[ea[e]]++] = eb[e];
    adjEdge[fill[eb[e]]] = e;
    adjTo[fill[eb[e]]++] = ea[e];
  }
  return {
    n,
    E,
    ea,
    eb,
    ed,
    adjStart,
    adjEdge,
    adjTo,
    start: level.start == null ? -1 : level.start,
    closed: !!level.closed,
    // Рабочие буферы.
    und: new Int32Array(n),
    bal: new Int32Array(n),
    mark: new Int32Array(n),
    emark: new Int32Array(E),
    queue: new Int32Array(n),
    markGen: 0,
  };
}

/** canTraverse(g, e, from) → можно ли пройти отрезок e из вершины from (с учётом стрелки). */
export function canTraverse(g, e, from) {
  if (g.ed[e] === 0) return g.ea[e] === from || g.eb[e] === from;
  return g.ea[e] === from;
}

/**
 * feasible(g, used, v, end, remaining) → false, если из вершины v заведомо нельзя завершить
 * росчерк по непройденным отрезкам (end — обязательная конечная вершина или -1).
 * Условия необходимы всегда и достаточны, когда среди непройденных нет стрелок:
 *   1) каждый непройденный отрезок достижим из v по непройденным (стрелки — только по направлению);
 *   2) баланс степеней: для каждой вершины u итоговый out−in (неориентированные отрезки получают
 *      ориентацию) равен +1 у старта, −1 у финиша, 0 у остальных (0 у всех, если старт = финиш).
 */
export function feasible(g, used, v, end, remaining) {
  if (remaining === 0) return end < 0 || end === v;
  const { n, E, ea, eb, ed, und, bal, adjStart, adjEdge, adjTo, mark, emark, queue } = g;
  und.fill(0);
  bal.fill(0);
  for (let e = 0; e < E; e++) {
    if (used[e]) continue;
    if (ed[e] === 0) {
      und[ea[e]]++;
      und[eb[e]]++;
    } else {
      bal[ea[e]]++;
      bal[eb[e]]--;
    }
  }
  // 1) достижимость всех отрезков из v.
  const gen = ++g.markGen;
  let head = 0;
  let tail = 0;
  let reached = 0;
  mark[v] = gen;
  queue[tail++] = v;
  while (head < tail) {
    const u = queue[head++];
    for (let i = adjStart[u], iEnd = adjStart[u + 1]; i < iEnd; i++) {
      const e = adjEdge[i];
      if (used[e] || emark[e] === gen || !canTraverse(g, e, u)) continue;
      emark[e] = gen; // каждый отрезок считается достигнутым один раз
      reached++;
      const to = adjTo[i];
      if (mark[to] !== gen) {
        mark[to] = gen;
        queue[tail++] = to;
      }
    }
  }
  if (reached !== remaining) return false;

  // 2) баланс степеней.
  let oddCount = 0;
  let oddOther = -1;
  for (let u = 0; u < n; u++) {
    const d = und[u];
    const b = bal[u];
    if (((d + b) & 1) !== 0) {
      oddCount++;
      if (u !== v) oddOther = u;
      if (oddCount > 2) return false;
    } else if (Math.abs(b) > d) {
      return false;
    }
  }
  const fits = (u, target) => Math.abs(target - bal[u]) <= und[u];
  if (end >= 0 && end === v) {
    // Замкнутый финиш в текущей вершине: все балансы 0.
    return oddCount === 0;
  }
  if (end >= 0) {
    if (oddCount !== 2 || oddOther !== end || ((und[v] + bal[v]) & 1) === 0) return false;
    return fits(v, 1) && fits(end, -1);
  }
  if (oddCount === 0) return true;
  if (oddCount !== 2 || ((und[v] + bal[v]) & 1) === 0) return false;
  return fits(v, 1) && fits(oddOther, -1);
}

/** hasDirectedLeft(g, used) → остались ли непройденные стрелки (тогда проверка feasible не точна). */
function hasDirectedLeft(g, used) {
  for (let e = 0; e < g.E; e++) if (!used[e] && g.ed[e]) return true;
  return false;
}

/**
 * Поиск одного завершения из вершины v. budget = { nodes, maxNodes } — общий счётчик узлов.
 * Возвращает массив индексов отрезков в порядке прохождения, null — завершения нет,
 * undefined — исчерпан лимит узлов. Для остатка без стрелок проверка feasible точна, поэтому
 * поиск идёт без возвратов (эквивалент Хирхольцера за O(E²)).
 */
export function findCompletion(g, used, v, end, remaining, budget) {
  if (!feasible(g, used, v, end, remaining)) return null;
  const out = [];
  const ok = completeFrom(g, used, v, end, remaining, budget, out);
  if (ok === true) return out;
  return ok === false ? null : undefined;
}

function completeFrom(g, used, v, end, remaining, budget, out) {
  if (remaining === 0) return true;
  if (++budget.nodes > budget.maxNodes) return undefined;
  const { adjStart, adjEdge, adjTo } = g;
  for (let i = adjStart[v], iEnd = adjStart[v + 1]; i < iEnd; i++) {
    const e = adjEdge[i];
    if (used[e] || !canTraverse(g, e, v)) continue;
    const to = adjTo[i];
    used[e] = 1;
    let res = false;
    if (feasible(g, used, to, end, remaining - 1)) {
      out.push(e);
      res = completeFrom(g, used, to, end, remaining - 1, budget, out);
      if (res !== true) out.pop();
    }
    used[e] = 0;
    if (res !== false) return res;
  }
  return false;
}

/**
 * canComplete(g, used, v, end, remaining, budget) → true / false / undefined (лимит).
 * Без стрелок в остатке — точный ответ за O(E) без поиска.
 */
export function canComplete(g, used, v, end, remaining, budget) {
  if (!feasible(g, used, v, end, remaining)) return false;
  if (!hasDirectedLeft(g, used)) return true;
  const res = completeFrom(g, used, v, end, remaining, budget, []);
  return res;
}

/** Индекс отрезка между a и b, проходимого из a и ещё не использованного; -1 если нет. */
export function edgeBetween(g, used, a, b) {
  const { adjStart, adjEdge, adjTo } = g;
  for (let i = adjStart[a], iEnd = adjStart[a + 1]; i < iEnd; i++) {
    if (adjTo[i] !== b) continue;
    const e = adjEdge[i];
    if (!used[e] && canTraverse(g, e, a)) return e;
  }
  return -1;
}

/**
 * difficultyOf(level, g, budget) → число ловушек по §2.0: позиций эталонного решения, из которых
 * есть непройденный легальный отрезок, после которого завершение невозможно. Второй результат —
 * complete=false, если какой-то проверке не хватило лимита узлов (такая позиция ловушкой не считается).
 */
export function difficultyOf(level, g, budget) {
  const sol = level.solution;
  const used = new Uint8Array(g.E);
  const end = g.closed ? sol[0] : -1;
  let difficulty = 0;
  let complete = true;
  for (let i = 0; i < g.E; i++) {
    const v = sol[i];
    const refEdge = edgeBetween(g, used, v, sol[i + 1]);
    if (refEdge < 0) break; // эталон некорректен — difficulty по доступному префиксу
    let trap = false;
    const { adjStart, adjEdge, adjTo } = g;
    for (let k = adjStart[v], kEnd = adjStart[v + 1]; k < kEnd && !trap; k++) {
      const e = adjEdge[k];
      if (e === refEdge || used[e] || !canTraverse(g, e, v)) continue;
      used[e] = 1;
      const res = canComplete(g, used, adjTo[k], end, g.E - i - 1, budget);
      used[e] = 0;
      if (res === false) trap = true;
      else if (res === undefined) complete = false;
    }
    if (trap) difficulty++;
    used[refEdge] = 1;
  }
  return { difficulty, complete };
}

/**
 * solve(level, { maxNodes, maxSolutions }) → { solutions, nodes, difficulty, complete }.
 * DFS по непройденным отрезкам из каждой допустимой стартовой вершины с корректным отсечением
 * feasible (не способно отрезать решение). complete=false — исчерпан лимит узлов (список решений
 * и difficulty могут быть неполными).
 */
export function solve(level, { maxNodes = DEFAULT_MAX_NODES, maxSolutions = 2 } = {}) {
  const g = buildGraph(level);
  const budget = { nodes: 0, maxNodes };
  const solutions = [];
  const used = new Uint8Array(g.E);
  const path = [];
  let complete = true;

  const dfs = (v, remaining) => {
    if (remaining === 0) {
      solutions.push(path.slice());
      return solutions.length < maxSolutions;
    }
    if (++budget.nodes > budget.maxNodes) {
      complete = false;
      return false;
    }
    const { adjStart, adjEdge, adjTo } = g;
    for (let i = adjStart[v], iEnd = adjStart[v + 1]; i < iEnd; i++) {
      const e = adjEdge[i];
      if (used[e] || !canTraverse(g, e, v)) continue;
      const to = adjTo[i];
      used[e] = 1;
      let goOn = true;
      if (feasible(g, used, to, end, remaining - 1)) {
        path.push(to);
        goOn = dfs(to, remaining - 1);
        path.pop();
      }
      used[e] = 0;
      if (!goOn) return false;
    }
    return true;
  };

  let end = -1;
  if (g.E > 0) {
    const starts = g.start >= 0 ? [g.start] : Array.from({ length: g.n }, (_, i) => i);
    for (const s of starts) {
      end = g.closed ? s : -1;
      if (!feasible(g, used, s, end, g.E)) continue;
      path.push(s);
      const goOn = dfs(s, g.E);
      path.pop();
      if (!goOn) break;
    }
  }

  let difficulty = 0;
  if (Array.isArray(level.solution) && validate(level, level.solution)) {
    const d = difficultyOf(level, g, budget);
    difficulty = d.difficulty;
    if (!d.complete) complete = false;
  }
  return { solutions, nodes: budget.nodes, difficulty, complete };
}

/** validate(level, solution) → true, если последовательность узлов — корректный росчерк по правилам. */
export function validate(level, solution) {
  if (!Array.isArray(solution)) return false;
  const E = level.edges.length;
  const n = level.nodes.length;
  if (solution.length !== E + 1) return false;
  for (const v of solution) if (!Number.isInteger(v) || v < 0 || v >= n) return false;
  if (level.start != null && solution[0] !== level.start) return false;
  if (level.closed && solution[0] !== solution[E]) return false;
  const g = buildGraph(level);
  const used = new Uint8Array(E);
  for (let i = 0; i < E; i++) {
    const e = edgeBetween(g, used, solution[i], solution[i + 1]);
    if (e < 0) return false;
    used[e] = 1;
  }
  return true;
}

/** solutionOf(level) → эталонное решение из данных уровня. */
export function solutionOf(level) {
  return level.solution;
}
