// Тесты src/modes/stroke.solve.js: сравнение с наивным перебором, рукописные задачи, validate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve, validate, solutionOf, buildGraph, canComplete, findCompletion } from '../src/modes/stroke.solve.js';
import { mulberry32 } from '../src/core/rng.js';

/** Наивный перебор всех эйлеровых путей без отсечений (только для ≤ 10 рёбер). */
function naiveCount(level) {
  const E = level.edges.length;
  const n = level.nodes.length;
  const used = new Array(E).fill(false);
  let count = 0;
  const dfs = (v, start, remaining) => {
    if (remaining === 0) {
      if (!level.closed || v === start) count++;
      return;
    }
    for (let e = 0; e < E; e++) {
      if (used[e]) continue;
      const [a, b, dir] = level.edges[e];
      let to = -1;
      if (a === v) to = b;
      else if (b === v && !dir) to = a;
      if (to < 0) continue;
      used[e] = true;
      dfs(to, start, remaining - 1);
      used[e] = false;
    }
  };
  const starts = level.start != null ? [level.start] : Array.from({ length: n }, (_, i) => i);
  for (const s of starts) dfs(s, s, E);
  return count;
}

/** Случайный маленький граф без кратных рёбер и петель. */
function randomLevel(rng) {
  const n = 3 + rng.int(4); // 3..6 узлов
  const maxE = Math.min(10, (n * (n - 1)) / 2);
  const E = 1 + rng.int(maxE);
  const pairs = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) pairs.push([a, b]);
  rng.shuffle(pairs);
  const edges = pairs.slice(0, E).map(([a, b]) => {
    const dir = rng.next() < 0.3 ? 1 : 0;
    return rng.next() < 0.5 ? [a, b, dir] : [b, a, dir];
  });
  const nodes = Array.from({ length: n }, (_, i) => [i % 3, Math.floor(i / 3)]);
  const start = rng.next() < 0.3 ? rng.int(n) : null;
  const closed = rng.next() < 0.3;
  return { w: 3, h: 2, nodes, edges, start, closed, solution: [] };
}

test('солвер против наивного перебора: равенство числа решений на случайных задачах', () => {
  const rng = mulberry32(0x5eed);
  let nonZero = 0;
  for (let i = 0; i < 400; i++) {
    const level = randomLevel(rng);
    const expected = naiveCount(level);
    const res = solve(level, { maxNodes: Infinity, maxSolutions: Infinity });
    assert.equal(res.complete, true);
    assert.equal(
      res.solutions.length,
      expected,
      `задача #${i}: ${JSON.stringify(level.edges)} start=${level.start} closed=${level.closed}`,
    );
    for (const sol of res.solutions) assert.ok(validate(level, sol), `решение невалидно: ${sol}`);
    if (expected > 0) nonZero++;
  }
  assert.ok(nonZero > 50, `слишком мало разрешимых задач в выборке: ${nonZero}`);
});

test('maxSolutions ограничивает список решений', () => {
  // Квадрат: из любой вершины 2 направления → 8 решений без ограничений.
  const level = { nodes: [[0, 0], [1, 0], [1, 1], [0, 1]], edges: [[0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 0, 0]], start: null, closed: false, solution: [0, 1, 2, 3, 0] };
  assert.equal(solve(level, { maxSolutions: Infinity }).solutions.length, 8);
  assert.equal(solve(level, { maxSolutions: 2 }).solutions.length, 2);
  assert.equal(solve(level, { maxSolutions: 1 }).solutions.length, 1);
});

// Рукописные задачи.
const square = (extra = {}) => ({
  nodes: [[0, 0], [1, 0], [1, 1], [0, 1]],
  edges: [[0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 0, 0]],
  start: null,
  closed: false,
  solution: [0, 1, 2, 3, 0],
  ...extra,
});

test('0 решений: две несвязные компоненты', () => {
  const level = { nodes: [[0, 0], [1, 0], [2, 0], [3, 0]], edges: [[0, 1, 0], [2, 3, 0]], start: null, closed: false, solution: [] };
  assert.equal(solve(level).solutions.length, 0);
  assert.equal(naiveCount(level), 0);
});

test('0 решений: четыре нечётные вершины', () => {
  // Квадрат с одной диагональю: вершины 0 и 2 — степени 3, 1 и 3 — степени 2 → решимо; добавим вторую
  // диагональ (не грид, но для солвера допустимо): четыре вершины степени 3 → нет эйлерова пути.
  const level = square({ edges: [[0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 0, 0], [0, 2, 0], [1, 3, 0]], solution: [] });
  assert.equal(solve(level).solutions.length, 0);
});

test('0 решений: стрелки образуют противоречие', () => {
  // Путь 0→1→2 с стрелкой 1→2 и стрелкой 2→1? Нет кратных: сделаем 0-1 (любое), 1→2, 2→... тупик:
  // стрелки 0→1 и 2→1 — обе входят в 1, выходов нет.
  const level = { nodes: [[0, 0], [1, 0], [2, 0]], edges: [[0, 1, 1], [2, 1, 1]], start: null, closed: false, solution: [] };
  assert.equal(solve(level).solutions.length, 0);
  assert.equal(naiveCount(level), 0);
});

test('1 решение: фиксированный старт и стрелки на квадрате', () => {
  const level = square({ edges: [[0, 1, 1], [1, 2, 0], [2, 3, 0], [3, 0, 0]], start: 0 });
  const res = solve(level, { maxSolutions: Infinity });
  assert.equal(res.solutions.length, 1);
  assert.deepEqual(res.solutions[0], [0, 1, 2, 3, 0]);
});

test('1 решение: все отрезки со стрелками по кругу, старт зафиксирован, closed', () => {
  const level = square({ edges: [[0, 1, 1], [1, 2, 1], [2, 3, 1], [3, 0, 1]], start: 2, closed: true, solution: [2, 3, 0, 1, 2] });
  const res = solve(level, { maxSolutions: Infinity });
  assert.deepEqual(res.solutions, [[2, 3, 0, 1, 2]]);
});

test('2 решения: квадрат с фиксированным стартом — два направления обхода', () => {
  const res = solve(square({ start: 0 }), { maxSolutions: Infinity });
  assert.equal(res.solutions.length, 2);
  assert.deepEqual(res.solutions.map((s) => s.join('')).sort(), ['01230', '03210']);
});

test('closed отвергает путь, заканчивающийся не в старте', () => {
  // Отрезок 0-1 и 1-2: эйлеров путь есть (0→1→2), но замкнуть его нельзя.
  const level = { nodes: [[0, 0], [1, 0], [2, 0]], edges: [[0, 1, 0], [1, 2, 0]], start: null, closed: true, solution: [] };
  assert.equal(solve(level).solutions.length, 0);
  assert.equal(solve({ ...level, closed: false }).solutions.length, 2);
});

test('difficulty: ловушки по эталонному решению (три треугольника при общей вершине)', () => {
  // Центр 0, треугольники (0,1,2), (0,3,4), (0,5,6). Эталон стартует с угла 1.
  const level = {
    nodes: [[1, 1], [0, 0], [1, 0], [2, 0], [2, 1], [0, 2], [1, 2]],
    edges: [[1, 2, 0], [2, 0, 0], [0, 1, 0], [3, 4, 0], [4, 0, 0], [0, 3, 0], [5, 6, 0], [6, 0, 0], [0, 5, 0]],
    start: null,
    closed: false,
    solution: [1, 2, 0, 3, 4, 0, 5, 6, 0, 1],
  };
  const res = solve(level);
  // В позициях 2 (в центре после первого треугольника) и 5 (после второго) есть отрезок в 1 — ловушка.
  assert.equal(res.difficulty, 2);
  assert.equal(res.complete, true);
  assert.ok(validate(level, level.solution));
});

test('difficulty: чистый цикл — ловушек нет', () => {
  assert.equal(solve(square()).difficulty, 0);
});

test('validate: принимает эталон и отвергает испорченное решение', () => {
  const level = square({ start: 0 });
  assert.ok(validate(level, solutionOf(level)));
  assert.ok(!validate(level, [0, 1, 2, 3])); // короче на один узел
  assert.ok(!validate(level, [0, 2, 1, 3, 0])); // несмежные узлы
  assert.ok(!validate(level, [0, 1, 0, 1, 0])); // повтор отрезка
  assert.ok(!validate(level, [1, 2, 3, 0, 1])); // не с фиксированного старта
  assert.ok(!validate(level, [0, 1, 2, 3, 7])); // узел вне диапазона
  assert.ok(!validate(level, null));
  // Стрелка против направления.
  const arrowed = square({ edges: [[0, 1, 1], [1, 2, 0], [2, 3, 0], [3, 0, 0]] });
  assert.ok(validate(arrowed, [0, 1, 2, 3, 0]));
  assert.ok(!validate(arrowed, [0, 3, 2, 1, 0]));
  // closed требует вернуться в старт.
  const open = { nodes: [[0, 0], [1, 0], [2, 0]], edges: [[0, 1, 0], [1, 2, 0]], start: null, closed: true, solution: [0, 1, 2] };
  assert.ok(!validate(open, [0, 1, 2]));
  assert.ok(validate({ ...open, closed: false }, [0, 1, 2]));
});

test('canComplete и findCompletion согласованы с наивным перебором на остатке', () => {
  const rng = mulberry32(42);
  for (let i = 0; i < 200; i++) {
    const level = randomLevel(rng);
    const g = buildGraph(level);
    const used = new Uint8Array(g.E);
    // Пройдём случайный префикс легальных ходов.
    let v = level.start != null ? level.start : rng.int(g.n);
    const startV = v;
    let remaining = g.E;
    const steps = rng.int(g.E + 1);
    for (let s = 0; s < steps; s++) {
      const options = [];
      for (let e = 0; e < g.E; e++) {
        if (used[e]) continue;
        const [a, b, dir] = level.edges[e];
        if (a === v) options.push([e, b]);
        else if (b === v && !dir) options.push([e, a]);
      }
      if (options.length === 0) break;
      const [e, to] = rng.pick(options);
      used[e] = 1;
      v = to;
      remaining--;
    }
    const end = level.closed ? startV : -1;
    // Наивно: есть ли завершение из v по остатку.
    const rest = { ...level, edges: level.edges.filter((_, e) => !used[e]), start: v, closed: false };
    let naive = naiveCountEnd(rest, end);
    const budget = { nodes: 0, maxNodes: Infinity };
    const res = canComplete(g, used, v, end, remaining, budget);
    assert.equal(res, naive > 0, `задача #${i}`);
    const path = findCompletion(g, used, v, end, remaining, budget);
    assert.equal(path !== null, naive > 0);
    if (path) {
      assert.equal(path.length, remaining);
      // Путь должен быть проходим.
      let cur = v;
      const seen = new Set();
      for (const e of path) {
        assert.ok(!used[e] && !seen.has(e));
        seen.add(e);
        const [a, b, dir] = level.edges[e];
        if (a === cur) cur = b;
        else {
          assert.equal(b, cur);
          assert.equal(dir, 0);
          cur = a;
        }
      }
      if (end >= 0) assert.equal(cur, end);
    }
  }
});

/** Наивный счёт путей из level.start по всем рёбрам с обязательным концом end (или -1). */
function naiveCountEnd(level, end) {
  const E = level.edges.length;
  const used = new Array(E).fill(false);
  let count = 0;
  const dfs = (v, remaining) => {
    if (remaining === 0) {
      if (end < 0 || v === end) count++;
      return;
    }
    for (let e = 0; e < E; e++) {
      if (used[e]) continue;
      const [a, b, dir] = level.edges[e];
      let to = -1;
      if (a === v) to = b;
      else if (b === v && !dir) to = a;
      if (to < 0) continue;
      used[e] = true;
      dfs(to, remaining - 1);
      used[e] = false;
    }
  };
  dfs(level.start, E);
  return count;
}

test('3 решения: треугольник с одной стрелкой — одно направление обхода, три стартовые вершины', () => {
  const level = { nodes: [[0, 0], [1, 0], [1, 1]], edges: [[0, 1, 0], [1, 2, 1], [0, 2, 0]], start: null, closed: false, solution: [0, 1, 2, 0] };
  assert.equal(naiveCount(level), 3);
  const res = solve(level, { maxSolutions: Infinity });
  assert.deepEqual(res.solutions.map((s) => s.join('')).sort(), ['0120', '1201', '2012']);
  assert.ok(validate(level, level.solution));
});
