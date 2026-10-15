// Чистые тесты режима «Один штрих» без DOM: create/serialize, pointer (down/move/up), правила
// управления из §2.4, тупики, подсказка, reset, ghost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import stroke from '../src/modes/stroke.js';

// Квадрат 0-1-2-3 с диагональю 0-2 на решётке 2×2 (узлы без джиттера):
//   0 (0,0) — 1 (1,0)
//   |     \      |
//   3 (0,1) — 2 (1,1)
// Степени: 0 и 2 — по 3 (нечётные), 1 и 3 — по 2. Эйлеров путь: 0→1→2→3→0→2.
const SQUARE_DIAG = {
  w: 2,
  h: 2,
  nodes: [[0, 0], [1, 0], [1, 1], [0, 1]],
  edges: [[0, 1, 0], [1, 2, 0], [2, 3, 0], [0, 3, 0], [0, 2, 0]],
  start: null,
  closed: false,
  solution: [0, 1, 2, 3, 0, 2],
};

const RECT = { x: 0, y: 0, w: 300, h: 300 };

function setup(level, saved) {
  const state = stroke.create(level, saved);
  const layout = stroke.layout(state, RECT, { id: 'dark' });
  const at = (v) => ({ x: layout.px[v], y: layout.py[v] });
  const ev = (type, p, t = 0) => ({ type, x: p.x, y: p.y, t });
  const send = (type, p, t) => stroke.pointer(state, layout, ev(type, p, t));
  return { state, layout, at, send };
}

const kinds = (events) => events.map((e) => e.kind);

test('layout: узлы вписаны в rect с полями, радиус захвата ≥ 22', () => {
  const { layout } = setup(SQUARE_DIAG);
  assert.ok(layout.capture >= 22);
  assert.ok(layout.px[0] > 0 && layout.px[1] < 300);
  assert.ok(Math.abs(layout.px[1] - layout.px[0] - layout.step) < 1e-9);
  // Фигура центрирована.
  assert.ok(Math.abs((layout.px[0] + layout.px[1]) / 2 - 150) < 1e-9);
});

test('down на точку начинает путь, down мимо точек игнорируется', () => {
  const { state, send, at } = setup(SQUARE_DIAG);
  assert.deepEqual(send('down', { x: 5, y: 5 }), []);
  assert.deepEqual(state.path, []);
  assert.deepEqual(kinds(send('down', at(0))), ['changed']);
  assert.deepEqual(state.path, [0]);
});

// Линия 0-1-2 и квадрат 1-2-3-4 на решётке 3×2: узлы 0 (0,0), 1 (1,0), 2 (2,0), 3 (2,1), 4 (1,1).
const LINE_SQUARE = {
  w: 3,
  h: 2,
  nodes: [[0, 0], [1, 0], [2, 0], [2, 1], [1, 1]],
  edges: [[0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 4, 0], [1, 4, 0]],
  start: null,
  closed: false,
  solution: [0, 1, 2, 3, 4, 1],
};

test('move по непройденному отрезку закрашивает его (step); быстрый свайп — узлы в порядке прохождения', () => {
  const { state, send, at } = setup(LINE_SQUARE);
  send('down', at(0));
  const ev1 = send('move', at(1));
  assert.deepEqual(kinds(ev1), ['step', 'changed']);
  assert.equal(ev1[0].edge, 0);
  assert.deepEqual(state.path, [0, 1]);
  stroke.reset(state);
  // Один быстрый свайп от 0 сразу к 2 проходит через 1: два шага по порядку.
  send('down', at(0));
  const ev2 = send('move', at(2));
  assert.deepEqual(kinds(ev2), ['step', 'step', 'changed']);
  assert.deepEqual(ev2.slice(0, 2).map((e) => e.node), [1, 2]);
  assert.deepEqual(state.path, [0, 1, 2]);
  assert.deepEqual(Array.from(state.used), [1, 1, 0, 0, 0]);
  // Свайп 2→4 по диагонали клетки: узлы 1 и 3 далеко от отрезка, 4 не смежен с 2, но единственный
  // промежуточный узел 3 (2-3, 3-4 свободны) однозначен → срезанный угол даёт два шага.
  const ev3 = send('move', at(4));
  assert.deepEqual(kinds(ev3), ['step', 'step', 'changed']);
  assert.deepEqual(ev3.slice(0, 2).map((e) => e.node), [3, 4]);
  assert.deepEqual(state.path, [0, 1, 2, 3, 4]);
  // Из 4 узел 2 не смежен, а промежуточного по свободным отрезкам нет (1-2 пройден) → отказ.
  const ev4 = send('move', at(2));
  assert.deepEqual(kinds(ev4), ['reject']);
  assert.equal(ev4[0].reason, 'not-adjacent');
  assert.deepEqual(state.path, [0, 1, 2, 3, 4]);
});

test('срезанный угол: однозначный промежуточный узел проходится, неоднозначный — отказ', () => {
  // Путь 0→1; узел 3 не смежен с 1, единственный путь через 2 (0-1 уже пройден) → шаги 2, 3.
  const s1 = setup(SQUARE_DIAG);
  s1.send('down', s1.at(0));
  s1.send('move', s1.at(1));
  s1.send('move', { x: -100, y: s1.at(3).y }); // подход слева, других узлов не задевая
  const ev = s1.send('move', s1.at(3));
  assert.deepEqual(kinds(ev), ['step', 'step', 'changed']);
  assert.deepEqual(s1.state.path, [0, 1, 2, 3]);
  // Старт в 1, цель 3: промежуточными годятся и 0, и 2 → неоднозначно → отказ not-adjacent.
  const s2 = setup(SQUARE_DIAG);
  s2.send('down', s2.at(1));
  s2.send('move', { x: -100, y: s2.at(3).y });
  const rej = s2.send('move', s2.at(3));
  assert.deepEqual(kinds(rej), ['reject']);
  assert.equal(rej[0].reason, 'not-adjacent');
  assert.deepEqual(s2.state.path, [1]);
  // Пройденный отрезок и стрелка против хода промежуточным узлом не обходятся (reason used/arrow).
  const s3 = setup({ ...SQUARE_DIAG, edges: [[1, 0, 1], [1, 2, 0], [2, 3, 0], [0, 3, 0], [0, 2, 0]], solution: [2, 1, 0, 3, 2, 0] });
  s3.send('down', s3.at(0));
  const rej3 = s3.send('move', s3.at(1));
  assert.deepEqual(kinds(rej3), ['reject']);
  assert.equal(rej3[0].reason, 'arrow');
  assert.deepEqual(s3.state.path, [0]);
});

test('возврат на предыдущую точку отменяет последний отрезок', () => {
  const { state, send, at } = setup(SQUARE_DIAG);
  send('down', at(0));
  send('move', at(1));
  send('move', at(2));
  const ev = send('move', at(1));
  assert.deepEqual(kinds(ev), ['changed']);
  assert.deepEqual(state.path, [0, 1]);
  assert.equal(state.used[1], 0);
  // Отменённый отрезок можно пройти снова.
  assert.deepEqual(kinds(send('move', at(2))), ['step', 'changed']);
});

test('reject: пройденный отрезок, несмежная точка; обработка останавливается на отказе', () => {
  const { state, send, at } = setup(SQUARE_DIAG);
  send('down', at(0));
  send('move', at(1));
  send('move', at(2));
  send('move', at(3));
  send('move', at(0)); // путь 0-1-2-3-0, остался отрезок 0-2
  assert.deepEqual(state.path, [0, 1, 2, 3, 0]);
  // Из 0 в 1 — отрезок уже пройден.
  const rej = send('move', at(1));
  assert.deepEqual(kinds(rej), ['reject']);
  assert.equal(rej[0].reason, 'used');
  assert.equal(rej[0].edge, 0);
  assert.deepEqual(state.path, [0, 1, 2, 3, 0]);
  // Тот же узел повторно — отказ не дублируется, пока палец рядом.
  assert.deepEqual(send('move', { x: at(1).x + 3, y: at(1).y + 2 }), []);
});

test('reject: несмежная точка (подход к далёкому узлу, не задевая другие)', () => {
  // Путь 0→1→2→3; из 3 узел 1 не смежен, промежуточного по свободным отрезкам нет (0-1 пройден).
  // Подходим к 1 сверху по вертикали — другие узлы не задеты.
  const { state, send, at } = setup(SQUARE_DIAG);
  send('down', at(0));
  send('move', at(1));
  send('move', at(2));
  send('move', at(3));
  assert.deepEqual(send('move', { x: at(1).x, y: -100 }), []);
  const rej = send('move', at(1));
  assert.deepEqual(kinds(rej), ['reject']);
  assert.equal(rej[0].reason, 'not-adjacent');
  assert.equal(rej[0].edge, undefined);
  assert.deepEqual(state.path, [0, 1, 2, 3]);
});

test('стрелки: против направления — reject reason=arrow, по направлению — step', () => {
  const level = { ...SQUARE_DIAG, edges: [[1, 0, 1], [1, 2, 0], [2, 3, 0], [0, 3, 0], [0, 2, 0]], solution: [2, 1, 0, 3, 2, 0] };
  const { state, send, at } = setup(level);
  send('down', at(0));
  const rej = send('move', at(1));
  assert.deepEqual(kinds(rej), ['reject']);
  assert.equal(rej[0].reason, 'arrow');
  assert.equal(rej[0].edge, 0);
  assert.deepEqual(state.path, [0]);
  stroke.reset(state);
  send('down', at(1));
  assert.deepEqual(kinds(send('move', at(0))), ['step', 'changed']);
});

test('фиксированный старт: down на другую точку — reject reason=start', () => {
  const level = { ...SQUARE_DIAG, start: 2 };
  const { state, send, at } = setup(level);
  const rej = send('down', at(0));
  assert.deepEqual(kinds(rej), ['reject']);
  assert.equal(rej[0].reason, 'start');
  assert.deepEqual(state.path, []);
  assert.deepEqual(kinds(send('down', at(2))), ['changed']);
});

test('up оставляет путь; продолжить можно только с конца', () => {
  const { state, send, at } = setup(SQUARE_DIAG);
  send('down', at(0));
  send('move', at(1));
  assert.deepEqual(send('up', at(1)), []);
  assert.deepEqual(state.path, [0, 1]);
  // move без down — ничего.
  assert.deepEqual(send('move', at(2)), []);
  // down на не-голову — отказ без изменения пути.
  const rej = send('down', at(3));
  assert.equal(rej[0].kind, 'reject');
  assert.equal(rej[0].reason, 'not-head');
  assert.deepEqual(send('move', at(2)), []);
  // down на голову и продолжение.
  assert.deepEqual(send('down', at(1)), []);
  assert.deepEqual(kinds(send('move', at(2))), ['step', 'changed']);
  // cancel завершает росчерк как up.
  assert.deepEqual(send('cancel', at(2)), []);
  assert.deepEqual(state.path, [0, 1, 2]);
});

test('победа: событие solved ровно один раз, после победы отрезков нет — только отказы', () => {
  const { state, send, at } = setup(SQUARE_DIAG);
  send('down', at(0));
  send('move', at(1));
  send('move', at(2));
  send('move', at(3));
  send('move', at(0));
  assert.equal(stroke.isSolved(state), false);
  const ev = send('move', at(2));
  assert.deepEqual(kinds(ev), ['step', 'solved', 'changed']);
  assert.ok(stroke.isSolved(state));
  assert.deepEqual(stroke.stats(state), { lines: [] });
  assert.equal(stroke.perfect(state), true);
  // Любой дальнейший ход — отказ (отрезки пройдены).
  const rej = send('move', at(1));
  assert.deepEqual(kinds(rej), ['reject']);
  assert.equal(rej[0].reason, 'used');
  // Откат и повторный заход даёт solved снова (ровно один раз на каждое становление true).
  assert.deepEqual(kinds(send('move', at(0))), ['changed']);
  assert.equal(stroke.isSolved(state), false);
  assert.deepEqual(kinds(send('move', at(2))), ['step', 'solved', 'changed']);
});

test('closed: победа только если последний узел = первому', () => {
  // Квадрат без диагонали, closed. Полный обход 0-1-2-3-0 — победа.
  const square = { w: 2, h: 2, nodes: SQUARE_DIAG.nodes, edges: SQUARE_DIAG.edges.slice(0, 4), start: null, closed: true, solution: [0, 1, 2, 3, 0] };
  const { state, send, at } = setup(square);
  send('down', at(1));
  send('move', at(2));
  send('move', at(3));
  send('move', at(0));
  assert.equal(stroke.isSolved(state), false);
  assert.deepEqual(kinds(send('move', at(1))), ['step', 'solved', 'changed']);
  // Фигура с двумя нечётными точками и closed: все отрезки пройдены, но конец ≠ началу → не победа.
  const open = { ...SQUARE_DIAG, closed: true };
  const s2 = setup(open);
  s2.send('down', s2.at(0));
  for (const v of [1, 2, 3, 0, 2]) s2.send('move', s2.at(v));
  assert.equal(s2.state.path.length, 6);
  assert.equal(stroke.isSolved(s2.state), false);
});

test('тупик: событие deadend, счётчик за попытку не сбрасывается reset', () => {
  // Старт с чётной вершины 1: 1→0→3→2→1 — из 1 выходов нет, отрезок 0-2 остался.
  const { state, send, at } = setup(SQUARE_DIAG);
  send('down', at(1));
  send('move', at(0));
  send('move', at(3));
  send('move', at(2));
  const ev = send('move', at(1));
  assert.deepEqual(kinds(ev), ['step', 'deadend', 'changed']);
  assert.equal(state.deadEnds, 1);
  stroke.reset(state);
  assert.deepEqual(state.path, []);
  assert.equal(state.deadEnds, 1);
  // Повторный тупик за ту же попытку: второй — счётчик 2 (нечётные точки начнут пульсировать).
  send('down', at(1));
  send('move', at(2));
  send('move', at(3));
  send('move', at(0));
  assert.deepEqual(kinds(send('move', at(1))), ['step', 'deadend', 'changed']);
  assert.equal(state.deadEnds, 2);
  // Верный маршрут тупика не даёт.
  stroke.reset(state);
  send('down', at(0));
  for (const v of [1, 2, 3, 0]) send('move', at(v));
  assert.equal(state.deadEnds, 2);
  assert.deepEqual(kinds(send('move', at(2))), ['step', 'solved', 'changed']);
});

test('тупик при down на точку без выходов (только входящие стрелки)', () => {
  const level = { w: 2, h: 1, nodes: [[0, 0], [1, 0], [0, 1]], edges: [[0, 1, 1], [2, 1, 1]], start: null, closed: false, solution: [] };
  const { state, send, at } = setup(level);
  assert.deepEqual(kinds(send('down', at(1))), ['changed', 'deadend']);
  assert.equal(state.deadEnds, 1);
});

test('serialize/create: путь восстанавливается, битый путь игнорируется, hintUsed сохраняется', () => {
  const { state, send, at } = setup(SQUARE_DIAG);
  send('down', at(0));
  send('move', at(1));
  send('move', at(2));
  state.hintUsed = true;
  const snap = stroke.serialize(state);
  assert.deepEqual(snap, { path: [0, 1, 2], hintUsed: true, deadEnds: 0 });
  assert.equal(JSON.stringify(snap).includes('_cache'), false);
  const restored = stroke.create(SQUARE_DIAG, JSON.parse(JSON.stringify(snap)));
  assert.deepEqual(restored.path, [0, 1, 2]);
  assert.deepEqual(Array.from(restored.used), [1, 1, 0, 0, 0]);
  assert.equal(restored.hintUsed, true);
  // Битый путь: несмежные узлы — берётся легальный префикс.
  const broken = stroke.create(SQUARE_DIAG, { path: [0, 1, 3], hintUsed: false, deadEnds: 2 });
  assert.deepEqual(broken.path, [0, 1]);
  assert.equal(broken.deadEnds, 2);
  // Старт не с отмеченной точки — путь отбрасывается.
  const wrongStart = stroke.create({ ...SQUARE_DIAG, start: 2 }, { path: [0, 1] });
  assert.deepEqual(wrongStart.path, []);
  // Без снимка — чистое состояние.
  const fresh = stroke.create(SQUARE_DIAG, undefined);
  assert.deepEqual(fresh.path, []);
  assert.equal(fresh.hintUsed, false);
});

test('reset очищает поле и подсказку, не трогает hintUsed', () => {
  const { state, send, at } = setup(SQUARE_DIAG);
  send('down', at(0));
  send('move', at(1));
  stroke.hint(state, 1000);
  assert.equal(state.hintUsed, true);
  stroke.reset(state);
  assert.deepEqual(state.path, []);
  assert.equal(state.hint, null);
  assert.equal(state.hintUsed, true);
  assert.equal(stroke.isSolved(state), false);
});

test('hint: пустой путь → допустимая стартовая вершина (нечётная)', () => {
  const { state } = setup(SQUARE_DIAG);
  const h = stroke.hint(state, 1000);
  assert.equal(h.kind, 'start');
  assert.ok(h.node === 0 || h.node === 2);
  assert.equal(h.until, 3500);
  assert.equal(state.hint, h);
  assert.equal(state.hintUsed, true);
});

test('hint: путь-префикс решения → следующее ребро завершения', () => {
  const { state, send, at } = setup(SQUARE_DIAG);
  send('down', at(0));
  send('move', at(1));
  const h = stroke.hint(state, 0);
  assert.equal(h.kind, 'edge');
  assert.equal(h.from, 1);
  assert.equal(h.to, 2);
  assert.equal(h.edge, 1);
});

// Три треугольника при общей вершине 0 (см. тест солвера): эталон 1→2→0→3→4→0→5→6→0→1.
const TRIPLE = {
  w: 3,
  h: 3,
  nodes: [[1, 1], [0, 0], [1, 0], [2, 0], [2, 1], [0, 2], [1, 2]],
  edges: [[1, 2, 0], [2, 0, 0], [0, 1, 0], [3, 4, 0], [4, 0, 0], [0, 3, 0], [5, 6, 0], [6, 0, 0], [0, 5, 0]],
  start: null,
  closed: false,
  solution: [1, 2, 0, 3, 4, 0, 5, 6, 0, 1],
};

test('hint: неверный старт → start; тупиковый префикс → rollback до вершины', () => {
  // Старт с чётной вершины 1 квадрата: завершения нет вообще → подсказка «начни с …».
  const s1 = setup(SQUARE_DIAG);
  s1.send('down', s1.at(1));
  s1.send('move', s1.at(2));
  const h1 = stroke.hint(s1.state, 0);
  assert.equal(h1.kind, 'start');
  assert.ok(h1.node === 0 || h1.node === 2);
  // Три треугольника: 1→2→0→1 закрывает первый треугольник преждевременно — откат до 0 (index 2).
  const s2 = setup(TRIPLE);
  s2.send('down', s2.at(1));
  for (const v of [2, 0, 1]) s2.send('move', s2.at(v));
  assert.deepEqual(s2.state.path, [1, 2, 0, 1]);
  const h2 = stroke.hint(s2.state, 0);
  assert.equal(h2.kind, 'rollback');
  assert.equal(h2.node, 0);
  assert.equal(h2.index, 2);
  // Путь 0-3-2-1-0 на квадрате: остался 0-2, из 0 завершение есть → подсказка — ребро 0→2.
  const s3 = setup(SQUARE_DIAG);
  s3.send('down', s3.at(0));
  for (const v of [3, 2, 1, 0]) s3.send('move', s3.at(v));
  const h3 = stroke.hint(s3.state, 0);
  assert.equal(h3.kind, 'edge');
  assert.equal(h3.edge, 4);
});

test('hint: фиксированный старт учитывается, после победы — none без hintUsed', () => {
  const fixed = setup({ ...SQUARE_DIAG, start: 2 });
  const h = stroke.hint(fixed.state, 0);
  assert.equal(h.kind, 'start');
  assert.equal(h.node, 2);
  const { state, send, at } = setup(SQUARE_DIAG);
  send('down', at(0));
  for (const v of [1, 2, 3, 0, 2]) send('move', at(v));
  assert.ok(stroke.isSolved(state));
  assert.deepEqual(stroke.hint(state, 0), { kind: 'none' });
  assert.equal(state.hintUsed, false);
});

test('hint: со стрелками (смешанный граф) подсказка корректна', () => {
  // Единственный маршрут: 2→1→0→3→2→0 (стрелка 1→0).
  const level = { ...SQUARE_DIAG, edges: [[1, 0, 1], [1, 2, 0], [2, 3, 0], [0, 3, 0], [0, 2, 0]], solution: [2, 1, 0, 3, 2, 0] };
  const s = setup(level);
  assert.equal(stroke.hint(s.state, 0).kind, 'start');
  s.send('down', s.at(2));
  s.send('move', s.at(1));
  const h = stroke.hint(s.state, 0);
  assert.equal(h.kind, 'edge');
  assert.equal(h.to, 0);
});

test('ghost: первые узлы решения в единицах решётки или в координатах layout', () => {
  const pts = stroke.ghost(SQUARE_DIAG);
  assert.equal(pts.length, 4);
  assert.deepEqual(pts[0], { x: 0, y: 0 });
  assert.deepEqual(pts[1], { x: 1, y: 0 });
  const { layout } = setup(SQUARE_DIAG);
  const px = stroke.ghost(SQUARE_DIAG, layout);
  assert.deepEqual(px[1], { x: layout.px[1], y: layout.py[1] });
  assert.equal(stroke.ghost({ ...SQUARE_DIAG, solution: [] }), null);
  assert.equal(stroke.nextLabel(), null);
  assert.equal(stroke.footer(), null);
});

test('контракт модуля: обязательные поля §5.1', () => {
  assert.equal(stroke.id, 'stroke');
  assert.equal(typeof stroke.name.ru, 'string');
  assert.equal(typeof stroke.tagline.ru, 'string');
  assert.equal(typeof stroke.helpText.ru, 'string');
  assert.match(stroke.color, /^#[0-9A-Fa-f]{6}$/);
  assert.match(stroke.colorLight, /^#[0-9A-Fa-f]{6}$/);
  for (const fn of ['create', 'serialize', 'layout', 'render', 'pointer', 'isSolved', 'reset', 'hint', 'stats', 'perfect', 'ghost', 'nextLabel', 'footer']) {
    assert.equal(typeof stroke[fn], 'function', fn);
  }
});

// ---- Регрессии по ревью: дребезг на коротких рёбрах, перекрытие радиусов, смена старта, bbox ----

/** Прямая A—B длиной len px: rect подобран так, чтобы шаг решётки равнялся len (capture = 22). */
function shortEdgeSetup(len, nodesCount = 2) {
  const nodes = Array.from({ length: nodesCount }, (_, i) => [i, 0]);
  const edges = Array.from({ length: nodesCount - 1 }, (_, i) => [i, i + 1, 0]);
  const level = { w: nodesCount, h: 1, nodes, edges, start: null, closed: false, solution: nodes.map((_, i) => i) };
  const state = stroke.create(level);
  const rect = { x: 0, y: 0, w: len * (nodesCount - 1 + 1.2), h: 400 };
  const layout = stroke.layout(state, rect, { id: 'dark' });
  assert.ok(Math.abs(layout.step - len) < 1e-6);
  assert.equal(layout.capture, 22);
  const y = layout.py[0];
  const send = (type, x) => stroke.pointer(state, layout, { type, x, y, t: 0 });
  return { state, layout, send, x0: layout.px[0] };
}

test('короткое ребро 38px < 2·capture: прямолинейное ведение A→B даёт ровно один step и один solved, без отката', () => {
  const { state, send, x0 } = shortEdgeSetup(38);
  const log = [];
  send('down', x0);
  for (let dx = 4; dx <= 40; dx += 4) for (const ev of send('move', x0 + dx)) log.push(ev.kind);
  assert.deepEqual(log.filter((k) => k !== 'changed'), ['step', 'solved']);
  assert.deepEqual(state.path, [0, 1]);
  assert.ok(stroke.isSolved(state));
});

test('перекрытие радиусов (узлы 37.9px при capture 22): остановка в линзе и дрожание на 1px не меняют путь; настоящий возврат откатывает', () => {
  const { state, send, x0 } = shortEdgeSetup(37.9, 3);
  send('down', x0);
  // Точка 17.9px от A и 20px от B лежит в обоих радиусах захвата — шага нет (голова A ближе).
  assert.deepEqual(send('move', x0 + 17.9), []);
  assert.deepEqual(state.path, [0]);
  // Ближе 0.4·ребра к B — шаг.
  assert.deepEqual(kinds(send('move', x0 + 24)), ['step', 'changed']);
  assert.deepEqual(state.path, [0, 1]);
  // Дрожание пальца в линзе: ни отката, ни повторного шага.
  for (const dx of [23, 24, 25, 24, 23, 22.5]) {
    assert.deepEqual(send('move', x0 + dx), [], `dx=${dx}`);
    assert.deepEqual(state.path, [0, 1]);
  }
  // Дальше к C: шаг и победа ровно один раз.
  const log = [];
  for (let dx = 28; dx <= 76; dx += 4) for (const ev of send('move', x0 + dx)) log.push(ev.kind);
  assert.deepEqual(log.filter((k) => k !== 'changed'), ['step', 'solved']);
  assert.deepEqual(state.path, [0, 1, 2]);
  // Настоящий возврат пальцем к A откатывает оба отрезка.
  for (let dx = 72; dx >= 0; dx -= 4) send('move', x0 + dx);
  assert.deepEqual(state.path, [0]);
  assert.deepEqual(Array.from(state.used), [0, 0]);
  assert.equal(stroke.isSolved(state), false);
});

test('после тупика на стартовой точке касание другой точки меняет старт (а не даёт not-head); фиксированный старт — reject start', () => {
  // Узел 1 — только входящие стрелки: старт в нём — тупик.
  const level = { w: 2, h: 2, nodes: [[0, 0], [1, 0], [0, 1]], edges: [[0, 1, 1], [2, 1, 1]], start: null, closed: false, solution: [] };
  const { state, send, at } = setup(level);
  const ev = send('down', at(1));
  assert.deepEqual(kinds(ev), ['changed', 'deadend']);
  assert.equal(ev[1].startMatters, true); // стрелки без отмеченного старта — старт важен
  send('up', at(1));
  assert.deepEqual(kinds(send('down', at(0))), ['changed']);
  assert.deepEqual(state.path, [0]);
  assert.deepEqual(kinds(send('move', at(1))), ['step', 'deadend', 'changed']);
  assert.deepEqual(state.path, [0, 1]);
  // Один узел в пути после up без шагов — тоже смена старта.
  const s2 = setup(SQUARE_DIAG);
  s2.send('down', s2.at(1));
  s2.send('up', s2.at(1));
  assert.deepEqual(kinds(s2.send('down', s2.at(2))), ['changed']);
  assert.deepEqual(s2.state.path, [2]);
  assert.deepEqual(kinds(s2.send('move', s2.at(3))), ['step', 'changed']);
  // При фиксированном старте смена невозможна.
  const s3 = setup({ ...SQUARE_DIAG, start: 2 });
  s3.send('down', s3.at(2));
  s3.send('up', s3.at(2));
  const rej = s3.send('down', s3.at(0));
  assert.deepEqual(kinds(rej), ['reject']);
  assert.equal(rej[0].reason, 'start');
  assert.deepEqual(s3.state.path, [2]);
  // Когда отрезок уже есть, down на чужую точку — по-прежнему not-head.
  const s4 = setup(SQUARE_DIAG);
  s4.send('down', s4.at(0));
  s4.send('move', s4.at(1));
  s4.send('up', s4.at(1));
  assert.equal(s4.send('down', s4.at(3))[0].reason, 'not-head');
});

test('deadend.startMatters: две нечётные точки — true, цикл — false, фиксированный старт — false', () => {
  // Две нечётные точки (0 и 2): старт с чётной 1 ведёт в тупик.
  const odd = setup(SQUARE_DIAG);
  odd.send('down', odd.at(1));
  for (const v of [0, 3, 2]) odd.send('move', odd.at(v));
  const ev = odd.send('move', odd.at(1));
  assert.equal(ev[1].kind, 'deadend');
  assert.equal(ev[1].startMatters, true);
  // Цикл: два треугольника при общей вершине 0, все степени чётные; 1→2→0→1 — преждевременное замыкание.
  const cycle = {
    w: 3,
    h: 3,
    nodes: [[1, 1], [0, 0], [1, 0], [2, 1], [2, 2]],
    edges: [[0, 1, 0], [1, 2, 0], [0, 2, 0], [0, 3, 0], [3, 4, 0], [0, 4, 0]],
    start: null,
    closed: false,
    solution: [1, 2, 0, 3, 4, 0, 1],
  };
  const c = setup(cycle);
  c.send('down', c.at(1));
  c.send('move', c.at(2));
  c.send('move', c.at(0));
  const ev2 = c.send('move', c.at(1));
  assert.deepEqual(kinds(ev2), ['step', 'deadend', 'changed']);
  assert.equal(ev2[1].startMatters, false);
  // Фиксированный старт: менять его нельзя — дело в порядке обхода.
  const fixed = setup({ ...SQUARE_DIAG, start: 1 });
  fixed.send('down', fixed.at(1));
  for (const v of [0, 3, 2]) fixed.send('move', fixed.at(v));
  assert.equal(fixed.send('move', fixed.at(1))[1].startMatters, false);
});

test('layout центрирует bbox реальных узлов, а не решётку w×h', () => {
  // Фигура только в столбцах 1–2 решётки 3×3: центр масс по x и y — центр rect, шаг — по bbox 1×2.
  const level = {
    w: 3,
    h: 3,
    nodes: [[1, 0], [2, 0], [1, 1], [2, 1], [1, 2]],
    edges: [[0, 1, 0], [0, 2, 0], [1, 3, 0], [2, 3, 0], [2, 4, 0]],
    start: null,
    closed: false,
    solution: [1, 0, 2, 3, 1, 0, 4].slice(0, 6),
  };
  const state = stroke.create(level);
  const rect = { x: 24, y: 100, w: 327, h: 327 };
  const layout = stroke.layout(state, rect, { id: 'dark' });
  const cx = (layout.px[0] + layout.px[1]) / 2;
  const cy = (layout.py[0] + layout.py[4]) / 2;
  assert.ok(Math.abs(cx - (rect.x + rect.w / 2)) < 1e-9, `центр x ${cx}`);
  assert.ok(Math.abs(cy - (rect.y + rect.h / 2)) < 1e-9, `центр y ${cy}`);
  assert.ok(Math.abs(layout.step - 327 / 3.2) < 1e-9, 'шаг по bbox (2 + 2·0.6), а не по решётке (2 + 1.2 = столько же по y, но по x bbox 1)');
  // Рамка статики охватывает все узлы с полями.
  for (let i = 0; i < layout.px.length; i++) {
    assert.ok(layout.px[i] > layout.bx && layout.px[i] < layout.bx + layout.bw);
    assert.ok(layout.py[i] > layout.by && layout.py[i] < layout.by + layout.bh);
  }
  // Джиттер учитывается: bbox по фактическим координатам.
  const jit = { ...level, nodes: [[1.1, -0.1], [2.1, 0.05], [0.9, 1], [2, 1.1], [1, 2.1]] };
  const l2 = stroke.layout(stroke.create(jit), rect, { id: 'dark' });
  assert.ok(Math.abs(Math.min(...l2.px) + Math.max(...l2.px) - 2 * (rect.x + rect.w / 2)) < 1e-9);
  assert.ok(Math.abs(Math.min(...l2.py) + Math.max(...l2.py) - 2 * (rect.y + rect.h / 2)) < 1e-9);
});

test('deadEnds в снимке: create восстанавливает значение как есть (оболочка при undo должна брать максимум)', () => {
  const { state, send, at } = setup(SQUARE_DIAG);
  const before = stroke.serialize(state);
  send('down', at(1));
  for (const v of [0, 3, 2, 1]) send('move', at(v));
  assert.equal(state.deadEnds, 1);
  // Undo оболочки = create(level, снимок до росчерка): счётчик вернётся к 0 — это документированная
  // семантика режима; сохранение счётчика за попытку — зона оболочки (restore).
  const restored = stroke.create(SQUARE_DIAG, before);
  assert.equal(restored.deadEnds, 0);
  assert.equal(stroke.create(SQUARE_DIAG, { ...before, deadEnds: 1 }).deadEnds, 1);
});
