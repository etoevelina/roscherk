// Чистые тесты ввода режима «Маршрут» (src/modes/zip.js) без DOM: последовательности
// down/move/up на фейковом layout покрывают правила управления §2.2 и трассировку §4.2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zip from '../src/modes/zip.js';
import { solve } from '../src/modes/zip.solve.js';

// Поле 3×3:   0 1 2
//             3 4 5
//             6 7 8
// L1: решение 0→1→4→3→6→7→8→5→2, числа 1@0, 2@4, 3@2, стена между 1 и 2.
const L1 = { n: 3, path: [0, 1, 4, 3, 6, 7, 8, 5, 2], marks: [[0, 1], [4, 2], [2, 3]], walls: [[1, 2]] };
// L2: то же решение без стен, числа 1@0, 2@4, 3@6, 4@2.
const L2 = { n: 3, path: [0, 1, 4, 3, 6, 7, 8, 5, 2], marks: [[0, 1], [4, 2], [6, 3], [2, 4]], walls: [] };

const LAYOUT = { x0: 0, y0: 0, cell: 10, n: 3, size: 30 };
const center = (cell) => ({ x: (cell % 3) * 10 + 5, y: Math.floor(cell / 3) * 10 + 5 });
const ev = (type, cell, t = 0) => ({ type, ...center(cell), t });
const kinds = (events) => events.map((e) => e.kind);

/** Нажать и провести по центрам клеток. */
function drag(state, cells, t = 0) {
  const all = [];
  all.push(...zip.pointer(state, LAYOUT, ev('down', cells[0], t)));
  for (let i = 1; i < cells.length; i++) all.push(...zip.pointer(state, LAYOUT, ev('move', cells[i], t + i)));
  all.push(...zip.pointer(state, LAYOUT, ev('up', cells[cells.length - 1], t + cells.length)));
  return all;
}

test('тестовые уровни имеют ровно одно решение — эталон', () => {
  for (const L of [L1, L2]) {
    const res = solve(L, { maxSolutions: 3 });
    assert.deepEqual(res.solutions, [L.path]);
  }
});

test('down: пустая дорожка начинается только с клетки 1', () => {
  const st = zip.create(L1);
  assert.deepEqual(zip.pointer(st, LAYOUT, ev('down', 5)), []);
  assert.deepEqual(st.path, []);
  assert.deepEqual(zip.pointer(st, LAYOUT, { type: 'down', x: -5, y: 5, t: 0 }), [], 'вне поля');
  const events = zip.pointer(st, LAYOUT, ev('down', 0));
  assert.deepEqual(kinds(events), ['step', 'changed']);
  assert.deepEqual(st.path, [0]);
  assert.equal(zip.nextLabel(st), 'следующая: 2');
});

test('move: дорожка растёт на соседнюю клетку под пальцем, числа по порядку', () => {
  const st = zip.create(L1);
  zip.pointer(st, LAYOUT, ev('down', 0));
  let events = zip.pointer(st, LAYOUT, ev('move', 1, 1));
  assert.deepEqual(kinds(events), ['step', 'changed']);
  assert.equal(events[0].cell, 1);
  events = zip.pointer(st, LAYOUT, ev('move', 4, 2));
  assert.deepEqual(kinds(events), ['step', 'changed']);
  assert.deepEqual(st.path, [0, 1, 4]);
  assert.equal(zip.nextLabel(st), 'следующая: 3');
  assert.equal(st.backtracks, 0);
});

test('гистерезис: палец у границы клетки её не «достигает»', () => {
  const st = zip.create(L1);
  zip.pointer(st, LAYOUT, ev('down', 0));
  // Клетка 1 — x∈[10,20); центральные 70 % — [11.5, 18.5]. Точка x=10.8 — вне зоны.
  assert.deepEqual(zip.pointer(st, LAYOUT, { type: 'move', x: 10.8, y: 5, t: 1 }), []);
  assert.deepEqual(st.path, [0]);
  assert.deepEqual(kinds(zip.pointer(st, LAYOUT, { type: 'move', x: 12, y: 5, t: 2 })), ['step', 'changed']);
  assert.deepEqual(st.path, [0, 1]);
});

test('быстрый свайп через несколько клеток за одно событие', () => {
  const st = zip.create(L1);
  zip.pointer(st, LAYOUT, ev('down', 0));
  const events = zip.pointer(st, LAYOUT, ev('move', 6, 1)); // 0→3→6 по вертикали
  assert.deepEqual(kinds(events), ['step', 'step', 'changed']);
  assert.deepEqual(st.path, [0, 3, 6]);
});

test('возврат пальцем на пройденную клетку укорачивает дорожку, считаются возвраты', () => {
  const st = zip.create(L1);
  drag(st, [0, 1, 4]);
  assert.deepEqual(st.path, [0, 1, 4]);
  zip.pointer(st, LAYOUT, ev('down', 4));
  const events = zip.pointer(st, LAYOUT, ev('move', 1, 1));
  assert.deepEqual(kinds(events), ['changed']);
  assert.deepEqual(st.path, [0, 1]);
  assert.equal(st.backtracks, 1);
  assert.equal(zip.nextLabel(st), 'следующая: 2', 'ожидаемое число откатилось');
  assert.deepEqual(zip.stats(st).lines[0].ru, 'Возвратов: 1');
});

test('pointerdown на клетке дорожки не укорачивает; движение вперёд по дорожке ничего не меняет', () => {
  const st = zip.create(L1);
  drag(st, [0, 1, 4, 3]);
  assert.deepEqual(zip.pointer(st, LAYOUT, ev('down', 1)), []);
  assert.deepEqual(st.path, [0, 1, 4, 3]);
  assert.deepEqual(zip.pointer(st, LAYOUT, ev('move', 4, 1)), []);
  assert.deepEqual(zip.pointer(st, LAYOUT, ev('move', 3, 2)), []);
  assert.deepEqual(st.path, [0, 1, 4, 3]);
  // Продолжение с конца после касания середины дорожки.
  const events = zip.pointer(st, LAYOUT, ev('move', 6, 3));
  assert.deepEqual(kinds(events), ['step', 'changed']);
  assert.deepEqual(st.path, [0, 1, 4, 3, 6]);
  assert.equal(st.backtracks, 0);
});

test('движение с середины дорожки в сторону обрезает хвост и растёт от точки касания', () => {
  const st = zip.create(L1);
  drag(st, [0, 1, 4, 5]);
  assert.deepEqual(st.path, [0, 1, 4, 5]);
  zip.pointer(st, LAYOUT, ev('down', 4));
  const events = zip.pointer(st, LAYOUT, ev('move', 3, 1));
  assert.deepEqual(kinds(events), ['step', 'changed']);
  assert.deepEqual(st.path, [0, 1, 4, 3]);
  assert.equal(st.backtracks, 1, 'обрезанная клетка 5 — возврат');
});

test('отпустили — дорожка остаётся; без down движение игнорируется', () => {
  const st = zip.create(L1);
  drag(st, [0, 1]);
  assert.deepEqual(st.path, [0, 1]);
  assert.deepEqual(zip.pointer(st, LAYOUT, ev('move', 4, 5)), []);
  assert.deepEqual(st.path, [0, 1]);
  assert.deepEqual(zip.pointer(st, LAYOUT, ev('cancel', 4, 6)), []);
});

test('шаг сквозь стену: reject со стеной, без повторов пока палец стоит, снова при новой попытке', () => {
  const st = zip.create(L1);
  drag(st, [0, 1]);
  zip.pointer(st, LAYOUT, ev('down', 1));
  let events = zip.pointer(st, LAYOUT, ev('move', 2, 1));
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'reject');
  assert.equal(events[0].reason, 'wall');
  assert.deepEqual(events[0].edge, [1, 2]);
  assert.deepEqual(st.path, [0, 1]);
  // Палец остаётся за стеной — отказ не повторяется.
  assert.deepEqual(zip.pointer(st, LAYOUT, { type: 'move', x: 26, y: 6, t: 2 }), []);
  // Вернулись на голову и снова в стену — новый отказ.
  assert.deepEqual(zip.pointer(st, LAYOUT, ev('move', 1, 3)), []);
  events = zip.pointer(st, LAYOUT, ev('move', 2, 4));
  assert.deepEqual(kinds(events), ['reject']);
  assert.deepEqual(st.path, [0, 1]);
});

test('возврат на свою дорожку через стену — укорочение без reject и блокировки (canStep ≡ applyStep)', () => {
  // 3×3, решение 0,1,2,5,4,3,6,7,8, стена 0|3: дорожка 0,1,2,5,4,3, голова 3, палец назад на 0.
  const L4 = { n: 3, path: [0, 1, 2, 5, 4, 3, 6, 7, 8], marks: [[0, 1], [8, 2]], walls: [[0, 3]] };
  const st = zip.create(L4);
  const route = [0, 1, 2, 5, 4, 3];
  zip.pointer(st, LAYOUT, ev('down', 0, 0));
  for (let i = 1; i < route.length; i++) zip.pointer(st, LAYOUT, ev('move', route[i], i));
  assert.deepEqual(st.path, route);
  const events = zip.pointer(st, LAYOUT, ev('move', 0, 10));
  assert.deepEqual(kinds(events), ['changed'], 'никакого reject:wall');
  assert.deepEqual(st.path, [0]);
  assert.equal(st.drag.blocked, false);
  assert.equal(st.backtracks, 5);
  // Рост от клетки 0 продолжается сразу (через стену 0|3 — по-прежнему отказ).
  assert.deepEqual(kinds(zip.pointer(st, LAYOUT, ev('move', 1, 11))), ['step', 'changed']);
  assert.deepEqual(st.path, [0, 1]);
});

test('после отказа дорожка не растёт, пока палец не вернётся к голове (без телепортации)', () => {
  const st = zip.create(L1);
  drag(st, [0, 1]);
  zip.pointer(st, LAYOUT, ev('down', 1));
  zip.pointer(st, LAYOUT, ev('move', 2, 1)); // стена
  // Палец уходит далеко (клетка 8): не сосед головы и не на дорожке — ничего.
  assert.deepEqual(zip.pointer(st, LAYOUT, ev('move', 8, 2)), []);
  assert.deepEqual(zip.pointer(st, LAYOUT, ev('move', 5, 3)), []);
  assert.deepEqual(st.path, [0, 1]);
  // Сосед головы — рост возобновляется от центра головы.
  const events = zip.pointer(st, LAYOUT, ev('move', 4, 4));
  assert.deepEqual(kinds(events), ['step', 'changed']);
  assert.deepEqual(st.path, [0, 1, 4]);
});

test('проход через угол выбирает легальную промежуточную клетку (стена закрывает естественную)', () => {
  const st = zip.create(L1);
  drag(st, [0, 1]);
  zip.pointer(st, LAYOUT, ev('down', 1));
  // Из 1 по диагонали в 5: естественный порядок 1→2 закрыт стеной, альтернатива 1→4 легальна.
  const events = zip.pointer(st, LAYOUT, ev('move', 5, 1));
  assert.deepEqual(kinds(events), ['step', 'step', 'changed']);
  assert.deepEqual(st.path, [0, 1, 4, 5]);
});

test('проход через угол рядом с K: промежуточной выбирается легальная клетка, а не K (§4.2)', () => {
  // L2: K=4@2. Из 1 по точной диагонали в 5 ведущая ось x даёт естественный порядок 1→2(K)→5;
  // вход в K при 6 незакрытых клетках нелегален — трассировка должна пойти через 4 (число 2).
  const st = zip.create(L2);
  drag(st, [0, 1]);
  zip.pointer(st, LAYOUT, ev('down', 1));
  const events = zip.pointer(st, LAYOUT, ev('move', 5, 1));
  assert.deepEqual(kinds(events), ['step', 'step', 'changed']);
  assert.deepEqual(st.path, [0, 1, 4, 5]);
  assert.equal(st.drag.blocked, false);
});

test('точная диагональ через угол решения: промежуточной берётся непосещённая клетка, дорожка не укорачивается', () => {
  // L1, дорожка [0,1], голова 1. Палец по точной диагонали в 3: ведущая ось x дала бы 1→0→3
  // (0 уже на дорожке → укорочение до [0] и рост в 3). Предпочтение непосещённой → 1→4→3.
  const st = zip.create(L1);
  drag(st, [0, 1]);
  zip.pointer(st, LAYOUT, ev('down', 1));
  const events = zip.pointer(st, LAYOUT, ev('move', 3, 1));
  assert.deepEqual(kinds(events), ['step', 'step', 'changed']);
  assert.deepEqual(st.path, [0, 1, 4, 3]);
  assert.equal(st.backtracks, 0);
  assert.equal(st.drag.blocked, false);
});

test('угол после гипотетических клеток трассы: K и число не по порядку нелегальны и для них', () => {
  // L2, дорожка [0]: свайп в 5 через 1 с перегибом у клетки 1, где естественная промежуточная — 2 (K).
  const st = zip.create(L2);
  zip.pointer(st, LAYOUT, ev('down', 0));
  const events = zip.pointer(st, LAYOUT, { type: 'move', x: 28, y: 11.6, t: 1 });
  assert.deepEqual(kinds(events), ['step', 'step', 'step', 'changed']);
  assert.deepEqual(st.path, [0, 1, 4, 5]);

  // Число не по порядку за гипотетической клеткой: 0→3→6, где 6 — число 3 при ожидаемом 2.
  const st2 = zip.create(L2);
  zip.pointer(st2, LAYOUT, ev('down', 0));
  const ev2 = zip.pointer(st2, LAYOUT, ev('move', 6, 1));
  assert.deepEqual(kinds(ev2), ['step', 'reject', 'changed']);
  assert.equal(ev2[1].reason, 'order');
  assert.equal(ev2[1].cell, 6);
  assert.equal(ev2[1].expected, 2);
  assert.deepEqual(st2.path, [0, 3]);
  assert.equal(st2.drag.blocked, true);
});

test('после отказа палец на дальней клетке дорожки укорачивает до неё напрямую, без фантомных шагов', () => {
  // 4×4:  0  1  2  3      дорожка 0,1,2,3,7,6,5,4,8 (голова 8), стена 8|12.
  //       4  5  6  7
  //       8  9 10 11
  //      12 13 14 15
  const L3 = { n: 4, path: [], marks: [[0, 1], [15, 2]], walls: [[8, 12]] };
  const lay = { x0: 0, y0: 0, cell: 10, n: 4, size: 40 };
  const c4 = (cell) => ({ x: (cell % 4) * 10 + 5, y: Math.floor(cell / 4) * 10 + 5 });
  const e4 = (type, cell, t) => ({ type, ...c4(cell), t });
  const st = zip.create(L3);
  const route = [0, 1, 2, 3, 7, 6, 5, 4, 8];
  zip.pointer(st, lay, e4('down', 0, 0));
  for (let i = 1; i < route.length; i++) zip.pointer(st, lay, e4('move', route[i], i));
  assert.deepEqual(st.path, route);
  let events = zip.pointer(st, lay, e4('move', 12, 20));
  assert.deepEqual(kinds(events), ['reject']);
  assert.equal(events[0].reason, 'wall');
  // Палец скользит по непосещённым клеткам (не соседям головы) — ничего не происходит.
  for (const cell of [13, 14, 10]) assert.deepEqual(zip.pointer(st, lay, e4('move', cell, 21)), []);
  assert.deepEqual(st.path, route);
  // Палец на клетке 3 дорожки: прямая 8→3 прошла бы по непосещённым 9, 10, 6 — вместо этого срез.
  events = zip.pointer(st, lay, e4('move', 3, 22));
  assert.deepEqual(kinds(events), ['changed']);
  assert.deepEqual(st.path, [0, 1, 2, 3]);
  assert.equal(st.backtracks, 5, 'возвраты — ровно срезанные клетки');
  assert.equal(st.drag.blocked, false);
  // Рост продолжается от клетки под пальцем.
  events = zip.pointer(st, lay, e4('move', 7, 23));
  assert.deepEqual(kinds(events), ['step', 'changed']);
  assert.deepEqual(st.path, [0, 1, 2, 3, 7]);
});

test('число больше ожидаемого — reject с причиной order, клетка не добавляется', () => {
  const st = zip.create(L2);
  drag(st, [0, 3]);
  zip.pointer(st, LAYOUT, ev('down', 3));
  const events = zip.pointer(st, LAYOUT, ev('move', 6, 1)); // 6 — число 3, ожидается 2
  assert.deepEqual(kinds(events), ['reject']);
  assert.equal(events[0].reason, 'order');
  assert.equal(events[0].cell, 6);
  assert.equal(events[0].expected, 2);
  assert.deepEqual(st.path, [0, 3]);
});

test('вход в K при незакрытых клетках — reject early-finish с числом оставшихся', () => {
  const st = zip.create(L2);
  drag(st, [0, 1]);
  zip.pointer(st, LAYOUT, ev('down', 1));
  const events = zip.pointer(st, LAYOUT, ev('move', 2, 1));
  assert.deepEqual(kinds(events), ['reject']);
  assert.equal(events[0].reason, 'early-finish');
  assert.equal(events[0].remaining, 6);
  assert.deepEqual(st.path, [0, 1]);
});

test('победа: solved ровно один раз, K терминальна, дальнейший ввод игнорируется', () => {
  const st = zip.create(L1);
  const events = drag(st, L1.path);
  assert.equal(events.filter((e) => e.kind === 'solved').length, 1);
  assert.ok(zip.isSolved(st));
  assert.equal(zip.nextLabel(st), null);
  assert.deepEqual(st.path, L1.path);
  // Из K дорожка не растёт и ничего не меняется.
  assert.deepEqual(zip.pointer(st, LAYOUT, ev('down', 2)), []);
  assert.deepEqual(zip.pointer(st, LAYOUT, ev('move', 1, 1)), []);
  assert.deepEqual(zip.pointer(st, LAYOUT, ev('down', 4)), []);
  assert.deepEqual(st.path, L1.path);
  assert.ok(zip.perfect(st));
  assert.equal(zip.footer(st), null);
});

test('инвариант: полностью закрытое поле — всегда победа', () => {
  const st = zip.create(L2);
  drag(st, L2.path);
  assert.ok(zip.isSolved(st));
  assert.equal(st.path.length, 9);
});

test('serialize/create: снимок восстанавливает дорожку, возвраты и hintUsed; битый снимок игнорируется', () => {
  const st = zip.create(L1);
  drag(st, [0, 1, 4]);
  zip.pointer(st, LAYOUT, ev('down', 4));
  zip.pointer(st, LAYOUT, ev('move', 1, 1));
  zip.pointer(st, LAYOUT, ev('up', 1, 2));
  zip.hint(st, 100);
  const snap = zip.serialize(st);
  assert.deepEqual(snap, { path: [0, 1], backtracks: 1, hintUsed: true });
  assert.equal(JSON.stringify(snap).includes('_cache'), false);
  JSON.parse(JSON.stringify(snap));

  const restored = zip.create(L1, snap);
  assert.deepEqual(restored.path, [0, 1]);
  assert.equal(restored.backtracks, 1);
  assert.equal(restored.hintUsed, true);
  assert.equal(zip.nextLabel(restored), 'следующая: 2');
  // Продолжение после восстановления работает.
  assert.deepEqual(kinds(drag(restored, [1, 4])), ['step', 'changed']);

  const bad = zip.create(L1, { path: [0, 1, 2], backtracks: -3, hintUsed: 'yes' });
  assert.deepEqual(bad.path, [], 'путь сквозь стену отвергнут');
  assert.equal(bad.backtracks, 0);
  assert.equal(bad.hintUsed, false);
  assert.deepEqual(zip.create(L1, { path: [1, 4] }).path, [], 'путь не с клетки 1 отвергнут');
  assert.deepEqual(zip.create(L1, { path: [0, 3, 4, 1, 2] }).path, [], 'ранний вход в K отвергнут');
  assert.deepEqual(zip.create(L1, undefined).path, []);
});

test('reset очищает поле, не трогает hintUsed и возвраты', () => {
  const st = zip.create(L1);
  drag(st, [0, 1, 4]);
  zip.pointer(st, LAYOUT, ev('down', 4));
  zip.pointer(st, LAYOUT, ev('move', 1, 1));
  zip.pointer(st, LAYOUT, ev('up', 1, 2));
  zip.hint(st, 10);
  zip.reset(st);
  assert.deepEqual(st.path, []);
  assert.equal(st.hintUsed, true);
  assert.equal(st.backtracks, 1);
  assert.equal(zip.isSolved(st), false);
  assert.equal(zip.nextLabel(st), 'следующая: 1');
  assert.deepEqual(kinds(zip.pointer(st, LAYOUT, ev('down', 0))), ['step', 'changed']);
});

test('hint: префикс решения → следующие 3 клетки; иначе первая расходящаяся клетка и откат', () => {
  const st = zip.create(L1);
  let h = zip.hint(st, 1000);
  assert.equal(h.kind, 'cells');
  assert.deepEqual(h.cells, [0, 1, 4]);
  assert.equal(h.until, 3500);
  assert.equal(st.hintUsed, true);
  assert.equal(st.hint, h);

  drag(st, [0, 1, 4, 3, 6, 7, 8]);
  h = zip.hint(st, 2000);
  assert.deepEqual(h.cells, [5, 2], 'в конце решения — сколько осталось');

  const st2 = zip.create(L1);
  drag(st2, [0, 3, 4, 1]);
  h = zip.hint(st2, 0);
  assert.equal(h.kind, 'rollback');
  assert.equal(h.cell, 3);
  assert.equal(h.keep, 1);
  assert.equal(h.label.ru, 'Укоротить до неё');
  const events = zip.rollbackTo(st2, h.cell, 5);
  assert.deepEqual(kinds(events), ['changed']);
  assert.deepEqual(st2.path, [0]);
  assert.equal(st2.backtracks, 3);
  assert.deepEqual(zip.rollbackTo(st2, 8), [], 'клетка не на дорожке — ничего');

  const solved = zip.create(L1);
  drag(solved, L1.path);
  assert.equal(zip.hint(solved, 0).kind, 'none');
  assert.equal(solved.hintUsed, false, 'подсказки не было — hintUsed не ставится');
});

test('truncate: кнопка «Укоротить до неё» режет до hint.keep только пока подсказка актуальна', () => {
  const st = zip.create(L1);
  drag(st, [0, 3, 4, 1]);
  const h = zip.hint(st, 0);
  assert.deepEqual([h.kind, h.cell, h.keep], ['rollback', 3, 1]);
  assert.equal(zip.truncate(st, h, 5), true);
  assert.deepEqual(st.path, [0]);
  assert.equal(st.backtracks, 3);
  assert.equal(st.hint, null);
  assert.equal(zip.truncate(st, h, 6), false, 'повторно — дорожка уже короче');

  // Игрок за время тоста перерисовал дорожку верно: та же клетка 3 теперь стоит на своём месте.
  const st2 = zip.create(L1);
  drag(st2, [0, 3, 4, 1]);
  const h2 = zip.hint(st2, 0);
  zip.reset(st2);
  drag(st2, [0, 1, 4, 3, 6]);
  const before = st2.path.slice();
  assert.equal(zip.truncate(st2, h2, 10), false);
  assert.deepEqual(st2.path, before, 'верный префикс не тронут');
  assert.equal(zip.truncate(st2, { kind: 'cells', cells: [7] }, 10), false);
  assert.equal(zip.truncate(st2, null, 10), false);
});

test('ghost, layout, nextLabel, метаданные режима', () => {
  assert.equal(zip.id, 'zip');
  assert.equal(zip.name.ru, 'Маршрут');
  assert.match(zip.color, /^#[0-9A-Fa-f]{6}$/);
  assert.match(zip.colorLight, /^#[0-9A-Fa-f]{6}$/);

  const g = zip.ghost(L1);
  assert.equal(g.length, 4);
  assert.deepEqual(g[0], { x: 0.5, y: 0.5, cell: 0 });
  assert.deepEqual(g[2], { x: 1.5, y: 1.5, cell: 4 });
  const gl = zip.ghost(L1, LAYOUT);
  assert.deepEqual(gl[1], { x: 15, y: 5, cell: 1 });

  const st = zip.create(L1);
  const lay = zip.layout(st, { x: 10, y: 20, w: 100, h: 200 }, { id: 'dark' });
  assert.equal(lay.n, 3);
  assert.ok(lay.cell > 0 && lay.cell * 3 <= 100);
  assert.equal(lay.size, lay.cell * 3);
  assert.equal(lay.x0 + lay.size / 2, 60, 'сетка по центру по горизонтали');
  assert.equal(lay.y0 + lay.size / 2, 120, 'сетка по центру по вертикали');
  assert.equal(zip.nextLabel(st), 'следующая: 1');
});

test('работа с другим layout: клетки под пальцем считаются по смещённой сетке', () => {
  const st = zip.create(L1);
  const lay = { x0: 100, y0: 50, cell: 20, n: 3, size: 60 };
  const c = (cell) => ({ x: 100 + (cell % 3) * 20 + 10, y: 50 + Math.floor(cell / 3) * 20 + 10 });
  zip.pointer(st, lay, { type: 'down', ...c(0), t: 0 });
  zip.pointer(st, lay, { type: 'move', ...c(1), t: 1 });
  zip.pointer(st, lay, { type: 'move', ...c(4), t: 2 });
  assert.deepEqual(st.path, [0, 1, 4]);
});
