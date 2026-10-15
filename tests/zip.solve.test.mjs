// Тесты солвера «Маршрута» (src/modes/zip.solve.js): сравнение с наивным перебором (§7.1),
// рукописные задачи с 0/1/2/3 решениями (§7.2), validate/solutionOf, лимит узлов, difficulty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve, validate, solutionOf } from '../src/modes/zip.solve.js';
import { mulberry32 } from '../src/core/rng.js';
import { neighbors } from '../src/core/grid.js';

/** Наивный перебор без отсечений: все гамильтоновы пути от 1 до K с числами по порядку. */
function naiveCount(level) {
  const n = level.n;
  const N = n * n;
  const markOf = new Uint8Array(N);
  let K = 0;
  for (const [c, m] of level.marks) {
    markOf[c] = m;
    if (m > K) K = m;
  }
  const walls = new Set(level.walls.map(([a, b]) => Math.min(a, b) * N + Math.max(a, b)));
  const start = level.marks.find((x) => x[1] === 1)[0];
  const goal = level.marks.find((x) => x[1] === K)[0];
  const visited = new Uint8Array(N);
  let count = 0;
  function rec(head, depth, next) {
    if (depth === N) {
      if (head === goal) count++;
      return;
    }
    for (const b of neighbors(head, n)) {
      if (visited[b]) continue;
      if (walls.has(Math.min(head, b) * N + Math.max(head, b))) continue;
      const m = markOf[b];
      if (m !== 0 && m !== next) continue;
      visited[b] = 1;
      rec(b, depth + 1, m !== 0 ? next + 1 : next);
      visited[b] = 0;
    }
  }
  visited[start] = 1;
  rec(start, 1, 2);
  return count;
}

/** Случайный гамильтонов путь: «змейка» + backbite-ходы. */
function randomHamiltonianPath(n, rng) {
  const N = n * n;
  const path = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) path.push(r * n + (r % 2 === 0 ? c : n - 1 - c));
  for (let step = 0; step < 40 * N; step++) {
    if (rng.int(2) === 0) path.reverse();
    const tail = path[N - 1];
    const nb = neighbors(tail, n);
    const i = path.indexOf(nb[rng.int(nb.length)]);
    if (i === N - 2) continue;
    const head = path.slice(0, i + 1);
    const rest = path.slice(i + 1).reverse();
    path.length = 0;
    path.push(...head, ...rest);
  }
  return path;
}

/**
 * Случайная задача 3…5: половина — числа вдоль случайного гамильтонова пути и стены вне его
 * рёбер (есть хотя бы одно решение), половина — числа и стены полностью случайные.
 */
function randomLevel(rng) {
  const n = 3 + rng.int(3); // 3…5
  const N = n * n;
  const K = 2 + rng.int(4);
  const walls = [];
  let marks;
  if (rng.int(2) === 0) {
    const path = randomHamiltonianPath(n, rng);
    const positions = new Set([0, N - 1]);
    while (positions.size < K) positions.add(1 + rng.int(N - 2));
    marks = [...positions].sort((a, b) => a - b).map((p, i) => [path[p], i + 1]);
    const pathEdges = new Set();
    for (let i = 1; i < N; i++) pathEdges.add(Math.min(path[i - 1], path[i]) * N + Math.max(path[i - 1], path[i]));
    const nw = rng.int(n + 1);
    for (let w = 0; w < nw; w++) {
      const a = rng.int(N);
      const nb = neighbors(a, n);
      const b = nb[rng.int(nb.length)];
      if (!pathEdges.has(Math.min(a, b) * N + Math.max(a, b))) walls.push([Math.min(a, b), Math.max(a, b)]);
    }
  } else {
    const cells = rng.shuffle([...Array(N).keys()]);
    marks = cells.slice(0, K).map((c, i) => [c, i + 1]);
    const nw = rng.int(n + 1);
    for (let w = 0; w < nw; w++) {
      const a = rng.int(N);
      const nb = neighbors(a, n);
      const b = nb[rng.int(nb.length)];
      walls.push([Math.min(a, b), Math.max(a, b)]);
    }
  }
  return { n, marks, walls };
}

test('солвер против наивного перебора: число решений совпадает на случайных задачах ≤ 5×5', () => {
  const rng = mulberry32(20261012);
  let withSolutions = 0;
  for (let it = 0; it < 400; it++) {
    const level = randomLevel(rng);
    const expected = naiveCount(level);
    const res = solve(level, { maxNodes: 5_000_000, maxSolutions: 1_000_000 });
    assert.ok(res.complete, `поиск прерван лимитом: ${JSON.stringify(level)}`);
    assert.equal(res.solutions.length, expected, `расхождение на ${JSON.stringify(level)}`);
    for (const s of res.solutions) assert.ok(validate(level, s), 'каждое найденное решение валидно');
    if (expected > 0) withSolutions++;
  }
  assert.ok(withSolutions > 50, 'выборка содержит достаточно разрешимых задач');
});

test('maxSolutions останавливает поиск, complete остаётся true', () => {
  const level = { n: 4, marks: [[0, 1], [3, 2]], walls: [] }; // 8 решений
  const res = solve(level, { maxSolutions: 2 });
  assert.equal(res.solutions.length, 2);
  assert.ok(res.complete);
  const all = solve(level, { maxSolutions: 100 });
  assert.equal(all.solutions.length, 8);
});

test('рукописные задачи: 0 решений (паритет, порядок чисел, стены)', () => {
  // Угол в противоположный угол 4×4 — невозможно по паритету раскраски.
  assert.equal(solve({ n: 4, marks: [[0, 1], [15, 2]], walls: [] }, { maxSolutions: 10 }).solutions.length, 0);
  // 3×3: из середины стороны в соседнюю середину — паритет не сходится.
  assert.equal(solve({ n: 3, marks: [[1, 1], [7, 2]], walls: [] }, { maxSolutions: 10 }).solutions.length, 0);
  // 2×2: 1 и 2 по диагонали — паритет (а соседние 1 и 2 решаются обходом: 0→2→3→1).
  assert.equal(solve({ n: 2, marks: [[0, 1], [3, 2]], walls: [] }, { maxSolutions: 10 }).solutions.length, 0);
  assert.deepEqual(solve({ n: 2, marks: [[0, 1], [1, 2]], walls: [] }, { maxSolutions: 10 }).solutions, [[0, 2, 3, 1]]);
  // Стена отрезает клетку: единственный вход в угол 2 закрыт.
  assert.equal(solve({ n: 3, marks: [[0, 1], [8, 2]], walls: [[1, 2], [2, 5]] }, { maxSolutions: 10 }).solutions.length, 0);
});

test('рукописные задачи: ровно 1 решение', () => {
  const a = { n: 3, marks: [[0, 1], [4, 2], [2, 3]], walls: [[1, 2]] };
  const ra = solve(a, { maxSolutions: 10 });
  assert.deepEqual(ra.solutions, [[0, 1, 4, 3, 6, 7, 8, 5, 2]]);
  assert.ok(ra.complete);

  const b = { n: 3, marks: [[0, 1], [4, 2], [6, 3], [2, 4]], walls: [] };
  const rb = solve(b, { maxSolutions: 10 });
  assert.deepEqual(rb.solutions, [[0, 1, 4, 3, 6, 7, 8, 5, 2]]);

  const c = { n: 4, marks: [[3, 1], [11, 2], [0, 3]], walls: [[5, 9], [10, 14]] };
  const rc = solve(c, { maxSolutions: 10 });
  assert.equal(rc.solutions.length, 1);
  assert.ok(validate(c, rc.solutions[0]));
  assert.ok(rc.difficulty >= 1, 'у задачи с развилками difficulty > 0');
});

test('рукописные задачи: ровно 2 решения', () => {
  const r1 = solve({ n: 3, marks: [[0, 1], [8, 2]], walls: [] }, { maxSolutions: 10 });
  assert.equal(r1.solutions.length, 2);
  assert.deepEqual(
    r1.solutions.slice().sort(),
    [
      [0, 1, 2, 5, 4, 3, 6, 7, 8],
      [0, 3, 6, 7, 4, 1, 2, 5, 8],
    ].sort(),
  );
  const r2 = solve({ n: 3, marks: [[0, 1], [4, 2], [2, 3]], walls: [] }, { maxSolutions: 10 });
  assert.equal(r2.solutions.length, 2);
});

test('рукописные задачи: ровно 3 решения', () => {
  const level = { n: 4, marks: [[9, 1], [15, 2], [6, 3], [5, 4]], walls: [] };
  const res = solve(level, { maxSolutions: 10 });
  assert.equal(res.solutions.length, 3);
  for (const s of res.solutions) assert.ok(validate(level, s));
  assert.equal(naiveCount(level), 3);
});

test('difficulty: задача без развилок — 0; принудительные ходы не считаются развилкой', () => {
  // 2×3-подобная цепочка: 3×3 с числами, задающими путь однозначно почти везде.
  const forced = { n: 3, marks: [[0, 1], [1, 2], [2, 3], [5, 4], [8, 5], [7, 6], [6, 7], [3, 8], [4, 9]], walls: [] };
  const res = solve(forced, { maxSolutions: 10 });
  assert.equal(res.solutions.length, 1);
  assert.equal(res.difficulty, 0);
});

test('лимит узлов: complete=false, difficulty не выдаётся за полную', () => {
  const level = { n: 5, marks: [[0, 1], [24, 2]], walls: [] };
  const res = solve(level, { maxNodes: 20, maxSolutions: 2 });
  assert.equal(res.complete, false);
  assert.ok(res.nodes > 20);
});

test('некорректные данные уровня → нет решений, без исключений', () => {
  assert.equal(solve({ n: 3, marks: [[0, 1]], walls: [] }).solutions.length, 0); // одно число
  assert.equal(solve({ n: 3, marks: [[0, 1], [0, 2]], walls: [] }).solutions.length, 0); // два числа в клетке
  assert.equal(solve({ n: 3, marks: [[0, 1], [8, 3]], walls: [] }).solutions.length, 0); // пропуск 2
  assert.equal(solve({ n: 3, marks: [[0, 1], [8, 2]], walls: [[0, 8]] }).solutions.length, 0); // стена не между соседями
  assert.equal(validate({ n: 3, marks: [[0, 1]], walls: [] }, [0, 1, 2, 5, 4, 3, 6, 7, 8]), false);
});

test('validate: принимает эталон и отвергает испорченные решения', () => {
  const level = { n: 3, path: [0, 1, 4, 3, 6, 7, 8, 5, 2], marks: [[0, 1], [4, 2], [2, 3]], walls: [[1, 2]] };
  const sol = solutionOf(level);
  assert.deepEqual(sol, level.path);
  assert.notEqual(sol, level.path, 'solutionOf возвращает копию');
  assert.ok(validate(level, sol));

  assert.equal(validate(level, sol.slice(0, 8)), false, 'не все клетки');
  assert.equal(validate(level, [0, 1, 4, 3, 6, 7, 8, 5, 5]), false, 'повтор клетки');
  assert.equal(validate(level, [0, 1, 2, 5, 8, 7, 6, 3, 4]), false, 'сквозь стену и не в K');
  assert.equal(validate(level, [0, 3, 6, 7, 8, 5, 4, 1, 2]), false, 'числа не по порядку (4 раньше 2 нарушено: 2 после 5)');
  assert.equal(validate(level, [1, 0, 3, 4, 7, 6, 8, 5, 2]), false, 'старт не в 1 и разрыв');
  assert.equal(validate(level, [0, 1, 4, 3, 6, 7, 8, 5, 9]), false, 'клетка вне поля');
  assert.equal(validate(level, [0, 1, 4, 7, 6, 3, 8, 5, 2]), false, 'несоседние клетки подряд');
  assert.equal(validate(level, null), false);
});
