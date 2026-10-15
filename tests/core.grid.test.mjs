// Тесты src/core/grid.js: трассировка свайпа (§4.2), гистерезис, соседство, layout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  traceCells,
  cellAt,
  cellCenter,
  neighbors,
  areAdjacent,
  makeLayout,
} from '../src/core/grid.js';
import { mulberry32 } from '../src/core/rng.js';

const N = 5;
const L = { x0: 0, y0: 0, cell: 10, n: N };
const center = (c, r) => ({ x: c * 10 + 5, y: r * 10 + 5 });
const idx = (c, r) => r * N + c;

/** Проверка 4-связности: каждая пара соседних элементов — ортогональные соседи. */
function assertConnected(cells) {
  for (let i = 1; i < cells.length; i++) {
    assert.ok(areAdjacent(cells[i - 1], cells[i], N), `разрыв между ${cells[i - 1]} и ${cells[i]}`);
  }
}

test('traceCells: горизонтальный свайп', () => {
  assert.deepEqual(traceCells(center(0, 0), center(3, 0), L, N), [0, 1, 2, 3]);
  assert.deepEqual(traceCells(center(3, 2), center(0, 2), L, N), [13, 12, 11, 10]);
});

test('traceCells: вертикальный свайп', () => {
  assert.deepEqual(traceCells(center(0, 0), center(0, 3), L, N), [0, 5, 10, 15]);
  assert.deepEqual(traceCells(center(2, 4), center(2, 1), L, N), [22, 17, 12, 7]);
});

test('traceCells: диагональный свайп даёт 4-связную цепочку', () => {
  const cells = traceCells(center(0, 0), center(2, 2), L, N);
  assert.equal(cells.length, 5);
  assert.equal(cells[0], idx(0, 0));
  assert.equal(cells[cells.length - 1], idx(2, 2));
  assertConnected(cells);
  // Точный угол: ведущая ось (x при равенстве) идёт первой — порядок стабилен.
  assert.deepEqual(cells, [0, 1, 6, 7, 12]);
});

test('traceCells: одна и та же клетка → только она', () => {
  assert.deepEqual(traceCells(center(2, 2), { x: 27, y: 23 }, L, N), [12]);
});

test('traceCells: угол — выбирается легальная промежуточная клетка', () => {
  const from = center(0, 0);
  const to = center(1, 1);
  const forbid = (cell) => (a, b) => b !== cell;
  // Запрещён вход в клетку 1 → идём через клетку 5.
  assert.deepEqual(traceCells(from, to, L, N, forbid(1)), [0, 5, 6]);
  // Запрещён вход в клетку 5 → идём через клетку 1.
  assert.deepEqual(traceCells(from, to, L, N, forbid(5)), [0, 1, 6]);
  // Обе запрещены → остаёмся в исходной клетке.
  assert.deepEqual(traceCells(from, to, L, N, (a, b) => b !== 1 && b !== 5), [0]);
});

test('traceCells: угол — при двух легальных берётся клетка ближе к отрезку', () => {
  // Отрезок (5,5)→(15,14) проходит ближе к центру клетки 1 (15,5), чем к центру 5 (5,15).
  assert.deepEqual(traceCells(center(0, 0), { x: 15, y: 14 }, L, N), [0, 1, 6]);
  // Отрезок (5,5)→(14,15) — наоборот, ближе к клетке 5.
  assert.deepEqual(traceCells(center(0, 0), { x: 14, y: 15 }, L, N), [0, 5, 6]);
});

test('traceCells: точная диагональ — ничья по расстоянию; без prefer ведущая ось, с prefer — предпочтительная', () => {
  // Отрезок (5,5)→(15,15): центры клеток 1 (15,5) и 5 (5,15) равноудалены от диагонали.
  // Без prefer — порядок supercover: ведущая ось x первой → клетка 1.
  assert.deepEqual(traceCells(center(0, 0), center(1, 1), L, N), [0, 1, 6]);
  // prefer «клетка 5 предпочтительна» перебивает ведущую ось.
  assert.deepEqual(traceCells(center(0, 0), center(1, 1), L, N, () => true, (a, b) => b === 5), [0, 5, 6]);
  // prefer подтверждает естественную клетку — порядок не меняется.
  assert.deepEqual(traceCells(center(0, 0), center(1, 1), L, N, () => true, (a, b) => b === 1), [0, 1, 6]);
  // Обе предпочтительны или ни одна — ничья остаётся за ведущей осью.
  assert.deepEqual(traceCells(center(0, 0), center(1, 1), L, N, () => true, () => true), [0, 1, 6]);
  assert.deepEqual(traceCells(center(0, 0), center(1, 1), L, N, () => true, () => false), [0, 1, 6]);
  // prefer получает клетку-источник первым аргументом.
  const seen = [];
  traceCells(center(0, 0), center(1, 1), L, N, () => true, (a, b) => (seen.push([a, b]), false));
  assert.ok(seen.every(([a]) => a === 0));
  // Вне ничьей prefer не влияет: отрезок явно ближе к клетке 1.
  assert.deepEqual(traceCells(center(0, 0), { x: 15, y: 14 }, L, N, () => true, (a, b) => b === 5), [0, 1, 6]);
  // Нелегальную клетку prefer не спасает.
  assert.deepEqual(traceCells(center(0, 0), center(1, 1), L, N, (a, b) => b !== 5, (a, b) => b === 5), [0, 1, 6]);
});

test('traceCells: угол при обратном направлении (вверх-влево)', () => {
  const from = center(3, 3);
  const to = center(2, 2);
  const forbid = (cell) => (a, b) => b !== cell;
  assert.deepEqual(traceCells(from, to, L, N, forbid(idx(2, 3))), [idx(3, 3), idx(3, 2), idx(2, 2)]);
  assert.deepEqual(traceCells(from, to, L, N, forbid(idx(3, 2))), [idx(3, 3), idx(2, 3), idx(2, 2)]);
});

test('traceCells: стена останавливает без телепортации', () => {
  // Стена между клетками 1 и 2.
  const canStep = (a, b) => !((a === 1 && b === 2) || (a === 2 && b === 1));
  const cells = traceCells(center(0, 0), center(3, 0), L, N, canStep);
  assert.deepEqual(cells, [0, 1]);
  assert.ok(!cells.includes(3));
  // Стена сразу у головы — дорожка не растёт вовсе.
  assert.deepEqual(traceCells(center(0, 0), center(3, 0), L, N, () => false), [0]);
});

test('traceCells: стена на пути диагонального свайпа — только легальный префикс', () => {
  // Запрет входа в клетку (1,1) из любой клетки: supercover обходит её через угол, пока может.
  const cells = traceCells(center(0, 0), center(3, 3), L, N, (a, b) => b !== idx(1, 1));
  assertConnected(cells);
  assert.equal(cells[0], 0);
  assert.ok(!cells.includes(idx(1, 1)));
  // Точный угол: (0,0)→(1,0); затем естественная промежуточная (1,1) запрещена,
  // альтернатива (2,0) легальна → обход через неё, далее по диагонали до (3,3).
  assert.deepEqual(cells, [idx(0, 0), idx(1, 0), idx(2, 0), idx(2, 1), idx(2, 2), idx(3, 2), idx(3, 3)]);
});

test('traceCells: быстрый свайп в несколько клеток за один вызов', () => {
  const cells = traceCells(center(0, 0), center(4, 2), L, N);
  assert.equal(cells.length, 4 + 2 + 1);
  assert.equal(cells[0], idx(0, 0));
  assert.equal(cells[cells.length - 1], idx(4, 2));
  assertConnected(cells);
});

test('traceCells: выход указателя за сетку — стоп на границе; старт вне сетки — []', () => {
  assert.deepEqual(traceCells(center(1, 0), { x: -25, y: 5 }, L, N), [1, 0]);
  assert.deepEqual(traceCells(center(4, 4), { x: 45, y: 95 }, L, N), [24]);
  assert.deepEqual(traceCells({ x: -5, y: 5 }, center(1, 0), L, N), []);
});

test('traceCells: учитывает смещение layout', () => {
  const layout = { x0: 100, y0: 50, cell: 20, n: 4 };
  const cells = traceCells({ x: 110, y: 60 }, { x: 170, y: 60 }, layout, 4);
  assert.deepEqual(cells, [0, 1, 2, 3]);
});

test('traceCells: случайные отрезки всегда дают 4-связный путь внутри сетки', () => {
  const rng = mulberry32(5150);
  for (let i = 0; i < 2000; i++) {
    const from = { x: rng.next() * 50, y: rng.next() * 50 };
    const to = { x: rng.next() * 50, y: rng.next() * 50 };
    const cells = traceCells(from, to, L, N);
    assert.equal(cells[0], cellAt(from.x, from.y, L));
    assert.equal(cells[cells.length - 1], cellAt(to.x, to.y, L));
    assert.equal(new Set(cells).size, cells.length, 'клетки не повторяются');
    assertConnected(cells);
    for (const c of cells) assert.ok(c >= 0 && c < N * N);
  }
});

test('traceCells: случайные отрезки со стенами — только легальный префикс', () => {
  const rng = mulberry32(99);
  for (let i = 0; i < 1000; i++) {
    const blocked = new Set();
    for (let k = 0; k < 6; k++) blocked.add(rng.int(N * N));
    const canStep = (a, b) => !blocked.has(b);
    const from = { x: rng.next() * 50, y: rng.next() * 50 };
    const to = { x: rng.next() * 50, y: rng.next() * 50 };
    const cells = traceCells(from, to, L, N, canStep);
    assert.equal(cells[0], cellAt(from.x, from.y, L));
    for (let j = 1; j < cells.length; j++) assert.ok(canStep(cells[j - 1], cells[j]));
    assertConnected(cells);
  }
});

test('cellAt: гистерезис — в центре клетка, у границы -1', () => {
  assert.equal(cellAt(15, 15, L, 0.7), idx(1, 1));
  assert.equal(cellAt(12, 18, L, 0.7), idx(1, 1)); // 0.2 и 0.8 — на краю зоны 70 %
  assert.equal(cellAt(11, 15, L, 0.7), -1); // 0.1 — вне зоны по x
  assert.equal(cellAt(15, 19, L, 0.7), -1); // 0.9 — вне зоны по y
  assert.equal(cellAt(11, 15, L), idx(1, 1)); // без гистерезиса — вся клетка
  assert.equal(cellAt(11, 15, L, 1), idx(1, 1));
});

test('cellAt: вне сетки -1, границы включительно/исключительно', () => {
  assert.equal(cellAt(-1, 5, L), -1);
  assert.equal(cellAt(5, -0.01, L), -1);
  assert.equal(cellAt(50, 5, L), -1); // правая граница — исключительно
  assert.equal(cellAt(0, 0, L), 0); // левая/верхняя — включительно
  assert.equal(cellAt(49.99, 49.99, L), N * N - 1);
});

test('cellCenter: центр клетки с учётом смещения', () => {
  assert.deepEqual(cellCenter(0, L), { x: 5, y: 5 });
  assert.deepEqual(cellCenter(idx(3, 2), L), { x: 35, y: 25 });
  assert.deepEqual(cellCenter(5, { x0: 100, y0: 50, cell: 20, n: 4 }), { x: 130, y: 80 });
});

test('neighbors: углы, края, центр', () => {
  assert.deepEqual(neighbors(0, 3).sort(), [1, 3]);
  assert.deepEqual(neighbors(2, 3).sort(), [1, 5]);
  assert.deepEqual(neighbors(8, 3).sort(), [5, 7]);
  assert.deepEqual(neighbors(1, 3).sort(), [0, 2, 4]);
  assert.deepEqual(neighbors(4, 3).sort(), [1, 3, 5, 7]);
  assert.deepEqual(neighbors(0, 1), []);
});

test('areAdjacent: нет «переноса» через край строки', () => {
  assert.ok(areAdjacent(0, 1, 3));
  assert.ok(areAdjacent(0, 3, 3));
  assert.ok(areAdjacent(5, 2, 3));
  assert.ok(!areAdjacent(2, 3, 3)); // конец строки и начало следующей
  assert.ok(!areAdjacent(0, 4, 3)); // диагональ
  assert.ok(!areAdjacent(0, 0, 3));
  assert.ok(!areAdjacent(-1, 0, 3));
  assert.ok(!areAdjacent(8, 9, 3));
});

test('makeLayout: квадрат по меньшей стороне, по центру rect, с отступом', () => {
  const layout = makeLayout({ x: 0, y: 0, w: 100, h: 200 }, 5, 10);
  assert.deepEqual(layout, { x0: 10, y0: 60, cell: 16, n: 5 });
  const wide = makeLayout({ x: 20, y: 30, w: 300, h: 120 }, 4);
  assert.deepEqual(wide, { x0: 110, y0: 30, cell: 30, n: 4 });
});
