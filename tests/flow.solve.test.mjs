// Тесты солвера «Потоков» (§2.3, §5.3, §7.1–7.2): сравнение с наивным перебором без отсечений,
// рукописные задачи с 0/1/2 решениями, validate/solutionOf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve, validate, solutionOf, neighborTable } from '../src/modes/flow.solve.js';
import { hamiltonianPath, cutPath, generate, CHAPTERS } from '../src/modes/flow.gen.js';
import { mulberry32 } from '../src/core/rng.js';

/** Наивный перебор: все простые пути первого потока, затем второго и т.д.; в конце — проверка заполнения. */
function bruteCount(level) {
  const { n, flows } = level;
  const total = n * n;
  const F = flows.length;
  const nb = neighborTable(n);
  const owner = new Int8Array(total).fill(-1);
  for (let f = 0; f < F; f++) {
    owner[flows[f][0]] = f;
    owner[flows[f][flows[f].length - 1]] = f;
  }
  let count = 0;
  function rec(f) {
    if (f === F) {
      for (let i = 0; i < total; i++) if (owner[i] === -1) return;
      count++;
      return;
    }
    const target = flows[f][flows[f].length - 1];
    const walk = (cur) => {
      for (let k = 0; k < 4; k++) {
        const c = nb[cur * 4 + k];
        if (c < 0) continue;
        if (c === target) {
          rec(f + 1);
          continue;
        }
        if (owner[c] !== -1) continue;
        owner[c] = f;
        walk(c);
        owner[c] = -1;
      }
    };
    walk(flows[f][0]);
  }
  rec(0);
  return count;
}

const ALL = { maxNodes: 1e7, maxSolutions: 1e9 };

test('солвер = наивный перебор: число решений на случайных задачах ≤ 5×5', () => {
  const rng = mulberry32(42);
  let withSolutions = 0;
  let withoutSolutions = 0;
  for (let i = 0; i < 250; i++) {
    const n = 3 + rng.int(3);
    const total = n * n;
    let level;
    if (rng.next() < 0.6) {
      // Разрезанный гамильтонов путь — заведомо ≥ 1 решения.
      const path = hamiltonianPath(rng, n);
      const flows = cutPath(path, 2 + rng.int(n === 5 ? 3 : 2), rng);
      level = { n, flows };
    } else {
      // Случайные точки — часто 0 решений.
      const F = 2 + rng.int(2);
      const cells = rng.shuffle(Array.from({ length: total }, (_, c) => c)).slice(0, 2 * F);
      level = { n, flows: Array.from({ length: F }, (_, f) => [cells[2 * f], cells[2 * f + 1]]) };
    }
    const expected = bruteCount(level);
    const res = solve(level, ALL);
    assert.ok(res.complete);
    assert.equal(res.solutions.length, expected, `уровень ${JSON.stringify(level)}`);
    const seen = new Set();
    for (const sol of res.solutions) {
      assert.ok(validate(level, sol), 'решение солвера проходит validate');
      const key = JSON.stringify(sol);
      assert.ok(!seen.has(key), 'заполнение посчитано ровно один раз');
      seen.add(key);
    }
    if (expected > 0) withSolutions++;
    else withoutSolutions++;
  }
  assert.ok(withSolutions > 50 && withoutSolutions > 30, 'выборка содержит оба типа задач');
});

test('рукописная задача без решений', () => {
  const level = { n: 3, flows: [[0, 2], [6, 8]] };
  assert.equal(bruteCount(level), 0);
  const res = solve(level, ALL);
  assert.equal(res.solutions.length, 0);
  assert.ok(res.complete);
});

test('рукописная задача с одним решением', () => {
  const level = { n: 4, flows: [[0, 1, 5, 4, 8, 9, 13, 12], [2, 3, 7, 6, 10, 11, 15, 14]] };
  assert.equal(bruteCount(level), 1);
  const res = solve(level, { maxNodes: 1e6, maxSolutions: 2 });
  assert.equal(res.solutions.length, 1);
  assert.deepEqual(res.solutions[0], level.flows);
  assert.ok(res.complete);
});

test('рукописная задача с двумя решениями', () => {
  const level = { n: 3, flows: [[0, 1, 2, 5, 8], [3, 4, 7, 6]] };
  assert.equal(bruteCount(level), 2);
  const res = solve(level, { maxNodes: 1e6, maxSolutions: 2 });
  assert.equal(res.solutions.length, 2);
  for (const sol of res.solutions) assert.ok(validate(level, sol));
  assert.notDeepEqual(res.solutions[0], res.solutions[1]);
  // maxSolutions = 1 останавливает поиск после первого решения.
  assert.equal(solve(level, { maxNodes: 1e6, maxSolutions: 1 }).solutions.length, 1);
});

test('рукописная задача с тремя решениями', () => {
  // 4×4: A — [5,6,7,3,2,1,0] (точки 5 и 0), B — [4,8,12,13,14,15,11,10,9] (точки 4 и 9).
  const level = { n: 4, flows: [[5, 6, 7, 3, 2, 1, 0], [4, 8, 12, 13, 14, 15, 11, 10, 9]] };
  assert.equal(bruteCount(level), 3);
  const res = solve(level, { maxNodes: 1e6, maxSolutions: 1e9 });
  assert.equal(res.solutions.length, 3);
  assert.ok(res.complete);
  const keys = new Set();
  for (const sol of res.solutions) {
    assert.ok(validate(level, sol));
    keys.add(JSON.stringify(sol));
  }
  assert.equal(keys.size, 3, 'три различных заполнения');
  assert.ok(res.solutions.some((sol) => JSON.stringify(sol) === JSON.stringify(level.flows)), 'эталон среди решений');
  // maxSolutions = 2 останавливает поиск после двух.
  assert.equal(solve(level, { maxNodes: 1e6, maxSolutions: 2 }).solutions.length, 2);
});

test('лимит узлов: complete = false, nodes ≤ лимит + 1', () => {
  const rng = mulberry32(7);
  const path = hamiltonianPath(rng, 7);
  const level = { n: 7, flows: cutPath(path, 5, rng) };
  const res = solve(level, { maxNodes: 3, maxSolutions: 2 });
  assert.equal(res.complete, false);
  assert.ok(res.nodes <= 4);
});

test('difficulty: без развилок у вынужденной задачи, > 0 у задачи с ложной ветвью', () => {
  // Две прямые дорожки 3×3 вынуждены полностью.
  const forced = { n: 3, flows: [[0, 3, 6], [1, 4, 7], [2, 5, 8]] };
  assert.equal(solve(forced, ALL).difficulty, 0);
  let found = false;
  for (let seed = 1; seed < 20 && !found; seed++) {
    const level = generate(seed, CHAPTERS[1]);
    if (!level) continue;
    const res = solve(level, { maxNodes: 1e6, maxSolutions: 2 });
    assert.equal(res.solutions.length, 1);
    if (res.difficulty >= 2) found = true;
  }
  assert.ok(found, 'есть уникальный уровень с положительной сложностью');
});

test('validate: принимает эталон (в любой ориентации), отвергает испорченное решение', () => {
  const level = { n: 4, flows: [[0, 1, 5, 4, 8, 9, 13, 12], [2, 3, 7, 6, 10, 11, 15, 14]] };
  const ref = solutionOf(level);
  assert.deepEqual(ref, level.flows);
  assert.notEqual(ref[0], level.flows[0], 'solutionOf возвращает копию');
  assert.ok(validate(level, ref));
  assert.ok(validate(level, ref.map((p) => p.slice().reverse())), 'обратная ориентация допустима');

  // Пропущена клетка.
  assert.ok(!validate(level, [[0, 1, 5, 4, 8, 9, 13, 12], [2, 3, 7, 6, 10, 11, 15]]));
  // Клетка дважды.
  assert.ok(!validate(level, [[0, 1, 5, 4, 8, 9, 13, 12], [2, 3, 7, 6, 10, 11, 10, 14]]));
  // Разрыв дорожки.
  assert.ok(!validate(level, [[0, 1, 5, 4, 8, 9, 13, 12], [2, 3, 7, 11, 10, 6, 15, 14]]));
  // Чужие концы.
  assert.ok(!validate(level, [[0, 1, 5, 4, 8, 9, 13, 14], [2, 3, 7, 6, 10, 11, 15, 12]]));
  // Неверное число потоков, не массив, индекс вне поля.
  assert.ok(!validate(level, [ref[0]]));
  assert.ok(!validate(level, null));
  assert.ok(!validate(level, [[0, 1, 5, 4, 8, 9, 13, 12], [2, 3, 7, 6, 10, 11, 15, 16]]));
  // Любое корректное заполнение принимается, не только эталон.
  const two = { n: 3, flows: [[0, 1, 2, 5, 8], [3, 4, 7, 6]] };
  assert.ok(validate(two, [[0, 1, 2, 5, 4, 7, 8], [3, 6]]));
});
