// Чистые тесты управления «Потоков» без DOM (§2.3, §4.2, §7.4): последовательности down/move/up
// на фейковом layout покрывают все правила: старт от точки, рост, завершение и терминальность,
// укорочение, отказы, обрезка чужой дорожки, гистерезис, рассинхронизация, ходы, snapshot, hint, reset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import flow from '../src/modes/flow.js';

// 4×4: A — [0,1,2,3] (точки 0 и 3), B — [4,5,6,7,11,10,9,8] (точки 4 и 8), C — [12,13,14,15] (точки 12 и 15).
const LEVEL = { n: 4, flows: [[0, 1, 2, 3], [4, 5, 6, 7, 11, 10, 9, 8], [12, 13, 14, 15]], unique: true };
const L = { x0: 0, y0: 0, cell: 10, n: 4, size: 40 };
const C = (idx) => ({ x: (idx % 4) * 10 + 5, y: Math.floor(idx / 4) * 10 + 5 });

let clock = 0;
function ev(type, idx, dx = 0, dy = 0) {
  const p = C(idx);
  return { type, x: p.x + dx, y: p.y + dy, t: (clock += 16) };
}
const kinds = (events) => events.map((e) => e.kind);
const down = (state, idx) => flow.pointer(state, L, ev('down', idx));
const move = (state, idx, dx, dy) => flow.pointer(state, L, ev('move', idx, dx, dy));
const up = (state) => flow.pointer(state, L, ev('up', 0));

/** Полный росчерк по списку клеток. */
function stroke(state, cells) {
  const all = [];
  all.push(...down(state, cells[0]));
  for (let i = 1; i < cells.length; i++) all.push(...move(state, cells[i]));
  all.push(...up(state));
  return all;
}

test('create: чистое состояние — у каждого потока дорожка из первой точки, 0 ходов', () => {
  const s = flow.create(LEVEL);
  assert.deepEqual(s.paths, [[0], [4], [12]]);
  assert.equal(s.moves, 0);
  assert.equal(s.hintUsed, false);
  assert.ok(!flow.isSolved(s));
  assert.deepEqual(flow.footer(s), { ru: 'ходов 0 · 0 %', en: 'moves 0 · 0 %' });
});

test('down на точке + move на соседей: step, завершение — complete; ход засчитан по итогу росчерка на up', () => {
  const s = flow.create(LEVEL);
  let evs = down(s, 0);
  assert.deepEqual(evs, [], 'down на точке пустого потока ничего не меняет');
  evs = move(s, 1);
  assert.deepEqual(kinds(evs), ['step', 'changed']);
  assert.equal(evs[0].flow, 0);
  assert.equal(evs[0].cell, 1);
  evs = move(s, 2);
  assert.deepEqual(kinds(evs), ['step', 'changed']);
  evs = move(s, 3);
  assert.deepEqual(kinds(evs), ['step', 'complete', 'changed']);
  assert.deepEqual(s.paths[0], [0, 1, 2, 3]);
  assert.equal(s.moves, 0, 'ход = росчерк down…up, внутри росчерка ещё не засчитан');
  evs = up(s);
  assert.deepEqual(kinds(evs), [], 'up не даёт событий');
  assert.equal(s.moves, 1, 'ход засчитан на up: поле изменилось');
});

test('ход — только росчерк, изменивший поле: вытянуть и вернуть назад — не ход; перерисовать тот же путь — не ход', () => {
  const s = flow.create(LEVEL);
  stroke(s, [0, 1]);
  assert.equal(s.moves, 1);
  // Вытянули на клетку и вернули назад — поле как до росчерка.
  down(s, 1);
  let evs = move(s, 2);
  assert.deepEqual(kinds(evs), ['step', 'changed']);
  evs = move(s, 1);
  assert.deepEqual(kinds(evs), ['changed']);
  up(s);
  assert.deepEqual(s.paths[0], [0, 1]);
  assert.equal(s.moves, 1, 'росчерк без итогового изменения — не ход');
  // Стёрли путь касанием точки и нарисовали тот же самый.
  stroke(s, [0, 1, 2, 3]);
  assert.equal(s.moves, 2);
  evs = down(s, 0);
  assert.deepEqual(kinds(evs), ['changed'], 'стирание — изменение внутри росчерка');
  move(s, 1);
  move(s, 2);
  move(s, 3);
  up(s);
  assert.deepEqual(s.paths[0], [0, 1, 2, 3]);
  assert.equal(s.moves, 2, 'итог росчерка совпал с исходным полем — не ход');
  // А вот стирание без перерисовки — ход.
  down(s, 3);
  up(s);
  assert.deepEqual(s.paths[0], [3]);
  assert.equal(s.moves, 3);
});

test('быстрый свайп с краевой зоны: клетка, отброшенная гистерезисом, не замораживает дорожку (трасса от головы)', () => {
  // down в центре 0 → move в краевые 10 % клетки 1 (не достигнута) → move в центр клетки 2:
  // промежуточная клетка 1 должна пройтись трассой, путь [0,1,2] (§4.2, §8).
  const s = flow.create(LEVEL);
  down(s, 0);
  let evs = flow.pointer(s, L, { type: 'move', x: 11, y: 5, t: (clock += 16) });
  assert.deepEqual(evs, []);
  assert.deepEqual(s.paths[0], [0]);
  evs = flow.pointer(s, L, { type: 'move', x: 25, y: 5, t: (clock += 16) });
  assert.deepEqual(kinds(evs), ['step', 'step', 'changed']);
  assert.deepEqual(s.paths[0], [0, 1, 2]);
  up(s);

  // Та же картина на 5×5 с клеткой 68 px (типичный флик ≈ 1 клетка/кадр): сэмплы по краевым зонам.
  const five = { n: 5, flows: [[0, 1, 2, 3, 4, 9, 8, 7, 6, 5], [10, 11, 12, 13, 14, 19, 18, 17, 16, 15, 20, 21, 22, 23, 24]] };
  const s5 = flow.create(five);
  const L5 = { x0: 0, y0: 0, cell: 68, n: 5, size: 340 };
  const go = (x) => flow.pointer(s5, L5, { type: 'move', x, y: 34, t: (clock += 16) });
  flow.pointer(s5, L5, { type: 'down', x: 34, y: 34, t: (clock += 16) });
  go(130); // клетка 1, краевые 15 %
  go(170); // центр клетки 2
  go(238); // клетка 3, краевая зона
  go(306); // центр клетки 4
  assert.deepEqual(s5.paths[0], [0, 1, 2, 3, 4]);
  flow.pointer(s5, L5, { type: 'up', x: 306, y: 34, t: (clock += 16) });
});

test('угол: нелегальная естественная клетка (чужая точка) — трасса идёт через альтернативную, без reject', () => {
  // A — [0,1,5,9,10,14,15,11] (точки 0 и 11), B — [6,2,3,7] (точки 6 и 7), C — [4,8,12,13].
  const lvl = { n: 4, flows: [[0, 1, 5, 9, 10, 14, 15, 11], [6, 2, 3, 7], [4, 8, 12, 13]] };
  const s = flow.create(lvl);
  down(s, 0);
  move(s, 1);
  move(s, 5);
  // Диагональ 5 → 10: естественная промежуточная 6 — чужая точка, альтернативная 9 легальна.
  const evs = move(s, 10);
  assert.deepEqual(kinds(evs), ['step', 'step', 'changed']);
  assert.deepEqual(s.paths[0], [0, 1, 5, 9, 10]);
  up(s);
});

test('выход пальца за сетку через угол рядом с чужой точкой — не отказ (пробный canStep не считается)', () => {
  // A — [0,1,2,3,7,11,10,9,8,4,5,6] (точки 0 и 6), B — [12,13,14,15] (точки 12 и 15).
  const lvl = { n: 4, flows: [[0, 1, 2, 3, 7, 11, 10, 9, 8, 4, 5, 6], [12, 13, 14, 15]] };
  const s = flow.create(lvl);
  stroke(s, [0, 1, 2, 3, 7, 11]);
  assert.deepEqual(s.paths[0], [0, 1, 2, 3, 7, 11]);
  down(s, 11);
  // Точный угол (45,35): естественный шаг за сетку, альтернативный — в чужую точку 15.
  let evs = flow.pointer(s, L, { type: 'move', x: 45, y: 35, t: (clock += 16) });
  assert.deepEqual(evs, [], 'выход за край поля — не отказ');
  down(s, 11);
  // Не точный угол (47,33): ведущая ось x, естественный шаг за сетку, пробный — чужая точка 15.
  evs = flow.pointer(s, L, { type: 'move', x: 47, y: 33, t: (clock += 16) });
  assert.deepEqual(evs, []);
  assert.deepEqual(s.paths[0], [0, 1, 2, 3, 7, 11]);
  // Настоящий шаг в чужую точку по-прежнему отказ.
  evs = move(s, 15);
  assert.deepEqual(kinds(evs), ['reject']);
  assert.equal(evs[0].reason, 'foreign-dot');
  assert.equal(evs[0].cell, 15);
  up(s);
});

test('терминальность: завершённый путь дальше не растёт и не даёт reject', () => {
  const s = flow.create(LEVEL);
  stroke(s, [0, 1, 2, 3]);
  down(s, 3);
  // down на точке начал путь заново от 3 — вернём его к завершённому виду.
  up(s);
  assert.deepEqual(s.paths[0], [3]);
  stroke(s, [3, 2, 1, 0]);
  assert.deepEqual(s.paths[0], [3, 2, 1, 0]);
  // Продолжаем от конца (клетка 0 — вторая точка): касание точки начинает заново, поэтому
  // проверяем терминальность через касание внутренней клетки и движение за точку.
  down(s, 1);
  let evs = move(s, 0);
  assert.deepEqual(kinds(evs), ['step', 'complete', 'changed'], 'укорочение до 1 и шаг в точку 0 — завершение восстановлено');
  assert.deepEqual(s.paths[0], [3, 2, 1, 0]);
  evs = move(s, 4);
  assert.deepEqual(evs, [], 'из завершённого пути шаг невозможен и не считается отказом');
  assert.deepEqual(s.paths[0], [3, 2, 1, 0]);
  up(s);
});

test('down на пустой клетке — ничего: росчерк не начинается, move/up ничего не меняют', () => {
  const s = flow.create(LEVEL);
  stroke(s, [0, 1, 2]);
  const before = JSON.stringify(flow.serialize(s));
  assert.deepEqual(down(s, 6), []);
  assert.equal(s._drag.active, false);
  assert.deepEqual(move(s, 7), []);
  assert.deepEqual(move(s, 2), []);
  assert.deepEqual(up(s), []);
  assert.equal(JSON.stringify(flow.serialize(s)), before);
});

test('down на точке стирает старый путь (ход засчитывается), down на точке без пути — нет', () => {
  const s = flow.create(LEVEL);
  stroke(s, [0, 1, 2, 3]);
  assert.equal(s.moves, 1);
  let evs = down(s, 3);
  assert.deepEqual(kinds(evs), ['changed']);
  assert.deepEqual(s.paths[0], [3]);
  up(s);
  assert.equal(s.moves, 2, 'росчерк, стёрший путь, — ход');
  evs = down(s, 0);
  assert.deepEqual(evs, []);
  up(s);
  assert.equal(s.moves, 2, 'пустой росчерк — не ход');
  assert.deepEqual(s.paths[0], [0]);
});

test('укорочение: down на своей клетке действует, когда палец покинул клетку касания; возврат на свою клетку укорачивает', () => {
  const s = flow.create(LEVEL);
  stroke(s, [0, 1, 5, 6, 2, 3]);
  assert.deepEqual(s.paths[0], [0, 1, 5, 6, 2, 3]);
  // down на внутренней клетке 5 без move — путь не меняется.
  down(s, 5);
  assert.deepEqual(s.paths[0], [0, 1, 5, 6, 2, 3]);
  // Дрожание в 1–2 px внутри клетки касания — не укорочение (§2.3): случайный тап не рушит дорожку.
  let evs = move(s, 5, 1, 1);
  assert.deepEqual(evs, []);
  assert.deepEqual(s.paths[0], [0, 1, 5, 6, 2, 3]);
  evs = move(s, 5, -2, 1);
  assert.deepEqual(evs, []);
  assert.deepEqual(s.paths[0], [0, 1, 5, 6, 2, 3]);
  assert.deepEqual(up(s), [], 'тап без выхода из клетки — не ход');
  assert.equal(s.moves, 1);
  // Палец вышел из клетки касания в пустую клетку 9: укорочение до 5 и шаг в 9 за один move.
  down(s, 5);
  evs = move(s, 9);
  assert.deepEqual(kinds(evs), ['step', 'changed']);
  assert.deepEqual(s.paths[0], [0, 1, 5, 9]);
  // Возврат по своей дорожке укорачивает дальше, до первой точки включительно (это не «повторный вход»).
  evs = move(s, 5);
  assert.deepEqual(kinds(evs), ['changed']);
  assert.deepEqual(s.paths[0], [0, 1, 5]);
  evs = move(s, 1);
  assert.deepEqual(kinds(evs), ['changed']);
  assert.deepEqual(s.paths[0], [0, 1]);
  evs = move(s, 0);
  assert.deepEqual(kinds(evs), ['changed']);
  assert.deepEqual(s.paths[0], [0]);
  up(s);
  assert.equal(s.moves, 2);
  // Укорочение до головы — не изменение.
  stroke(s, [0, 1, 2]);
  down(s, 2);
  assert.deepEqual(move(s, 2, 2, 0), []);
  assert.deepEqual(up(s), []);
  assert.equal(s.moves, 3);
});

test('повторный вход в свою первую точку отклоняется (reject own-start, один раз на клетку)', () => {
  // Один поток с точками 0 и 3: петля 0 → 1 → 5 → 4 → 0 упирается в свою первую точку.
  const s2 = flow.create({ n: 4, flows: [[0, 4, 8, 12, 13, 9, 5, 1, 2, 6, 10, 14, 15, 11, 7, 3]] });
  down(s2, 0);
  move(s2, 1);
  move(s2, 5);
  move(s2, 4);
  assert.deepEqual(s2.paths[0], [0, 1, 5, 4]);
  let evs = move(s2, 0);
  assert.deepEqual(kinds(evs), ['reject']);
  assert.equal(evs[0].reason, 'own-start');
  assert.equal(evs[0].cell, 0);
  assert.deepEqual(s2.paths[0], [0, 1, 5, 4]);
  evs = move(s2, 0, 1, 1);
  assert.deepEqual(evs, [], 'повторный отказ на той же клетке не дублируется, путь не укорачивается до точки');
  assert.deepEqual(s2.paths[0], [0, 1, 5, 4]);
  // Возврат к соседу головы — рост продолжается.
  evs = move(s2, 8);
  assert.deepEqual(kinds(evs), ['step', 'changed']);
  up(s2);
});

test('чужая точка непроходима: reject foreign-dot', () => {
  const s = flow.create(LEVEL);
  down(s, 0);
  move(s, 1);
  move(s, 5);
  const evs = move(s, 4);
  assert.deepEqual(kinds(evs), ['reject']);
  assert.equal(evs[0].reason, 'foreign-dot');
  assert.equal(evs[0].cell, 4);
  assert.deepEqual(s.paths[0], [0, 1, 5]);
  up(s);
});

test('проведение по чужой дорожке обрезает её: событие cut, у чужого остаётся префикс без клетки касания', () => {
  const s = flow.create(LEVEL);
  stroke(s, [4, 5, 6, 7]);
  assert.deepEqual(s.paths[1], [4, 5, 6, 7]);
  down(s, 0);
  move(s, 1);
  let evs = move(s, 5);
  assert.deepEqual(kinds(evs), ['cut', 'step', 'changed']);
  assert.equal(evs[0].flow, 1);
  assert.equal(evs[0].cell, 5);
  assert.deepEqual(s.paths[1], [4]);
  assert.deepEqual(s.paths[0], [0, 1, 5]);
  up(s);
  // Обрезка завершённого потока снимает завершение.
  const s2 = flow.create(LEVEL);
  stroke(s2, [12, 13, 14, 15]);
  assert.ok(s2.paths[2].length === 4);
  stroke(s2, [8, 9, 13]);
  assert.deepEqual(s2.paths[2], [12]);
  assert.deepEqual(s2.paths[1], [8, 9, 13]);
});

test('быстрый свайп через несколько клеток за один move', () => {
  const s = flow.create(LEVEL);
  down(s, 0);
  const evs = move(s, 2);
  assert.deepEqual(kinds(evs), ['step', 'step', 'changed']);
  assert.deepEqual(s.paths[0], [0, 1, 2]);
  up(s);
});

test('гистерезис: клетка достигнута только в центральных 70 %', () => {
  const s = flow.create(LEVEL);
  down(s, 0);
  // x = 11 — 10 % клетки 1: не достигнута.
  let evs = flow.pointer(s, L, { type: 'move', x: 11, y: 5, t: (clock += 16) });
  assert.deepEqual(evs, []);
  assert.deepEqual(s.paths[0], [0]);
  // x = 15 — центр: достигнута.
  evs = flow.pointer(s, L, { type: 'move', x: 15, y: 5, t: (clock += 16) });
  assert.deepEqual(kinds(evs), ['step', 'changed']);
  // Дрожание у границы между 1 и 2 ничего не меняет.
  evs = flow.pointer(s, L, { type: 'move', x: 20.5, y: 5, t: (clock += 16) });
  assert.deepEqual(evs, []);
  evs = flow.pointer(s, L, { type: 'move', x: 19.5, y: 5, t: (clock += 16) });
  assert.deepEqual(evs, []);
  assert.deepEqual(s.paths[0], [0, 1]);
  up(s);
});

test('рассинхронизация после отказа: дорожка не растёт, пока палец не вернётся к соседу головы', () => {
  const s = flow.create(LEVEL);
  down(s, 0);
  move(s, 1);
  move(s, 5);
  move(s, 4); // отказ: чужая точка
  // Палец уехал дальше — рост невозможен (клетка 8 не сосед головы 5).
  let evs = move(s, 8);
  assert.deepEqual(evs, []);
  evs = move(s, 12);
  assert.deepEqual(evs, []);
  assert.deepEqual(s.paths[0], [0, 1, 5]);
  // Вернулись к соседу головы — шаг.
  evs = move(s, 9);
  assert.deepEqual(kinds(evs), ['step', 'changed']);
  assert.deepEqual(s.paths[0], [0, 1, 5, 9]);
  up(s);
});

test('палец за пределами сетки: дорожка растёт до границы, старт вне сетки — ничего', () => {
  const s = flow.create(LEVEL);
  assert.deepEqual(flow.pointer(s, L, { type: 'down', x: -5, y: 5, t: 1 }), []);
  assert.deepEqual(flow.pointer(s, L, { type: 'move', x: 5, y: 5, t: 2 }), []);
  down(s, 0);
  const evs = flow.pointer(s, L, { type: 'move', x: 5, y: -30, t: (clock += 16) });
  assert.deepEqual(evs, []);
  assert.deepEqual(s.paths[0], [0]);
  up(s);
});

test('cancel завершает росчерк как up: дорожка остаётся, ход уже засчитан', () => {
  const s = flow.create(LEVEL);
  down(s, 0);
  move(s, 1);
  const evs = flow.pointer(s, L, { type: 'cancel', x: 0, y: 0, t: 5 });
  assert.deepEqual(kinds(evs), []);
  assert.deepEqual(s.paths[0], [0, 1]);
  assert.equal(s.moves, 1);
  assert.equal(s._drag.active, false);
});

test('down во время активного росчерка завершает предыдущий', () => {
  const s = flow.create(LEVEL);
  down(s, 0);
  move(s, 1);
  const evs = down(s, 4);
  assert.deepEqual(kinds(evs), []);
  assert.equal(s.moves, 1);
  assert.equal(s._drag.flow, 1);
  up(s);
});

test('победа: solved ровно один раз, любое корректное заполнение принимается, perfect и stats', () => {
  const s = flow.create(LEVEL);
  let all = [];
  all.push(...stroke(s, [0, 1, 2, 3]));
  all.push(...stroke(s, [4, 5, 6, 7, 11, 10, 9, 8]));
  assert.ok(!flow.isSolved(s));
  all.push(...stroke(s, [12, 13, 14, 15]));
  assert.ok(flow.isSolved(s));
  assert.equal(all.filter((e) => e.kind === 'solved').length, 1);
  assert.equal(s.moves, 3);
  assert.ok(flow.perfect(s));
  assert.deepEqual(flow.stats(s), { lines: [{ ru: 'Ходов 3 / 3', en: 'Moves 3 / 3' }] });
  assert.deepEqual(flow.footer(s), { ru: 'ходов 3 · 100 %', en: 'moves 3 · 100 %' });
  assert.equal(flow.nextLabel(s), null);

  // Другое корректное заполнение (не эталон) — тоже победа; лишний ход — не «Идеально».
  const two = { n: 3, flows: [[0, 1, 2, 5, 8], [3, 4, 7, 6]] };
  const s2 = flow.create(two);
  const L3 = { x0: 0, y0: 0, cell: 10, n: 3, size: 30 };
  const go = (type, idx) => flow.pointer(s2, L3, { type, x: (idx % 3) * 10 + 5, y: Math.floor(idx / 3) * 10 + 5, t: (clock += 16) });
  const strokes = [[0, 1], [0, 1, 2, 5, 4, 7, 8], [3, 6]];
  const evs = [];
  for (const cells of strokes) {
    evs.push(...go('down', cells[0]));
    for (let i = 1; i < cells.length; i++) evs.push(...go('move', cells[i]));
    evs.push(...go('up', cells[cells.length - 1]));
  }
  assert.ok(flow.isSolved(s2));
  assert.equal(evs.filter((e) => e.kind === 'solved').length, 1);
  assert.equal(s2.moves, 3);
  assert.ok(!flow.perfect(s2));
  assert.deepEqual(flow.stats(s2).lines[0].ru, 'Ходов 3 / 2');
});

test('solved повторно после снятия победы снова даёт событие один раз', () => {
  const s = flow.create({ n: 2, flows: [[0, 1], [2, 3]] });
  let evs = stroke(s, [0, 1]);
  assert.equal(evs.filter((e) => e.kind === 'solved').length, 0);
  evs = stroke(s, [2, 3]);
  assert.equal(evs.filter((e) => e.kind === 'solved').length, 1);
  evs = down(s, 3); // стёрли второй поток
  assert.ok(!flow.isSolved(s));
  evs = [...move(s, 2), ...up(s)];
  assert.equal(evs.filter((e) => e.kind === 'solved').length, 1);
});

test('serialize/create: снимок восстанавливает дорожки, ходы и hintUsed; битый снимок игнорируется', () => {
  const s = flow.create(LEVEL);
  stroke(s, [0, 1, 2, 3]);
  stroke(s, [4, 5, 6]);
  s.hintUsed = true;
  const snap = flow.serialize(s);
  assert.equal(JSON.stringify(snap), JSON.stringify(JSON.parse(JSON.stringify(snap))), 'JSON-сериализуем');
  assert.ok(!('_cache' in snap) && !('owner' in snap));
  const r = flow.create(LEVEL, snap);
  assert.deepEqual(r.paths, [[0, 1, 2, 3], [4, 5, 6], [12]]);
  assert.equal(r.moves, 2);
  assert.equal(r.hintUsed, true);
  assert.equal(r.owner[6], 1);
  assert.equal(r.owner[7], -1);
  // Продолжение после восстановления работает.
  stroke(r, [6, 7]);
  assert.deepEqual(r.paths[1], [4, 5, 6, 7]);
  // Пересекающиеся дорожки в снимке — чистое поле.
  const broken = flow.create(LEVEL, { paths: [[0, 1, 2], [4, 5, 1], [12]], moves: 5 });
  assert.deepEqual(broken.paths, [[0], [4], [12]]);
  assert.equal(broken.moves, 5);
  assert.deepEqual(flow.create(LEVEL, { paths: 'x' }).paths, [[0], [4], [12]]);
});

test('битый снимок: дорожка через чужую точку или свою точку внутри — чистое поле; lastTouched вне диапазона — сброшен', () => {
  // Дорожка A проходит через точку C (15).
  const viaForeign = flow.create(LEVEL, { paths: [[0, 1, 2, 6, 7, 11, 15], [4], [12]] });
  assert.deepEqual(viaForeign.paths, [[0], [4], [12]]);
  assert.equal(viaForeign.owner[15], -1, 'клетка чужой точки не принадлежит дорожке A');
  assert.equal(viaForeign.dotOf[15], 2);
  // Своя вторая точка (3) внутри дорожки, а не в конце.
  const viaOwn = flow.create(LEVEL, { paths: [[0, 1, 2, 3, 7], [4], [12]] });
  assert.deepEqual(viaOwn.paths, [[0], [4], [12]]);
  // Завершённый путь (своя точка последней) — валиден.
  assert.deepEqual(flow.create(LEVEL, { paths: [[0, 1, 2, 3], [4], [12]] }).paths[0], [0, 1, 2, 3]);
  // lastTouched вне диапазона: hint не падает.
  const badTouched = flow.create(LEVEL, { paths: [[0], [4], [12]], lastTouched: 7 });
  assert.equal(badTouched.lastTouched, -1);
  assert.equal(flow.create(LEVEL, { paths: [[0], [4], [12]], lastTouched: -5 }).lastTouched, -1);
  assert.equal(flow.hint(badTouched, 0).kind, 'flow');
});

test('reset: очищает поле, обнуляет ходы, не трогает hintUsed', () => {
  const s = flow.create(LEVEL);
  stroke(s, [0, 1, 2, 3]);
  s.hintUsed = true;
  flow.reset(s);
  assert.deepEqual(s.paths, [[0], [4], [12]]);
  assert.equal(s.moves, 0);
  assert.equal(s.hintUsed, true);
  assert.equal(s.owner[1], -1);
  assert.ok(!flow.isSolved(s));
});

test('hint: раскрывает последний тронутый незавершённый поток, обрезает мешающие, ставит hintUsed', () => {
  const s = flow.create(LEVEL);
  stroke(s, [4, 5, 1]); // B залез на эталон A
  stroke(s, [0]); // A — последний тронутый
  const h = flow.hint(s, 1000);
  assert.equal(h.kind, 'flow');
  assert.equal(h.flow, 0);
  assert.equal(h.until, 3500);
  assert.deepEqual(h.cells, [0, 1, 2, 3]);
  assert.deepEqual(s.paths[0], [0, 1, 2, 3]);
  assert.deepEqual(s.paths[1], [4, 5], 'чужая дорожка обрезана до клетки касания');
  assert.equal(s.hintUsed, true);
  assert.equal(s.hint, h);
  assert.equal(s.moves, 1, 'подсказка — не ход');
});

test('hint: без последнего тронутого — самый короткий по решению; ориентация от своей первой точки', () => {
  const s = flow.create(LEVEL);
  stroke(s, [8, 9]); // B начат со второй точки эталона
  s.lastTouched = -1;
  const h = flow.hint(s, 0);
  assert.equal(h.flow, 0, 'самые короткие — A и C (4), берётся меньший индекс');
  s.lastTouched = 1;
  const h2 = flow.hint(s, 0);
  assert.equal(h2.flow, 1);
  assert.deepEqual(s.paths[1], [8, 9, 10, 11, 7, 6, 5, 4], 'путь ориентирован от точки, с которой начал игрок');
  // Всё завершено → none.
  flow.hint(s, 0);
  assert.ok(flow.isSolved(s));
  assert.equal(flow.hint(s, 0).kind, 'none');
});

test('hint: все пары соединены, но остались пустые клетки — раскрывается поток, расходящийся с эталоном', () => {
  // 4×4 с одним решением: A — [0,1,5,4,8,9,13,12], B — [2,3,7,6,10,11,15,14]. Обе пары соединяются напрямую.
  const lvl = { n: 4, flows: [[0, 1, 5, 4, 8, 9, 13, 12], [2, 3, 7, 6, 10, 11, 15, 14]] };
  const s = flow.create(lvl);
  stroke(s, [0, 4, 8, 12]);
  stroke(s, [2, 6, 10, 14]);
  assert.equal(flow.footer(s).ru, 'ходов 2 · 50 %');
  assert.ok(!flow.isSolved(s));
  const h = flow.hint(s, 1000);
  assert.equal(h.kind, 'flow');
  assert.equal(h.flow, 1, 'последний тронутый поток расходится с эталоном — он и раскрывается');
  assert.deepEqual(s.paths[1], [2, 3, 7, 6, 10, 11, 15, 14]);
  assert.deepEqual(s.paths[0], [0, 4, 8, 12], 'чужая дорожка не задевает эталон B — не обрезана');
  assert.equal(s.hintUsed, true);
  assert.equal(flow.footer(s).ru, 'ходов 2 · 75 %');
  // Вторая подсказка раскрывает A (тоже «соединён», но расходится) — поле решено.
  const h2 = flow.hint(s, 2000);
  assert.equal(h2.kind, 'flow');
  assert.equal(h2.flow, 0);
  assert.ok(flow.isSolved(s));
  assert.equal(flow.hint(s, 3000).kind, 'none', 'none — только для решённого поля');

  // Без последнего тронутого — поток с наибольшим расхождением (при равенстве — меньший индекс).
  const s2 = flow.create(lvl);
  stroke(s2, [0, 4, 8, 12]);
  stroke(s2, [2, 6, 10, 14]);
  s2.lastTouched = -1;
  assert.equal(flow.hint(s2, 0).flow, 0);
  // Поток, совпадающий с эталоном, не выбирается: расходящийся раскрывается даже если тронут не он.
  const s3 = flow.create(lvl);
  stroke(s3, [2, 3, 7, 6, 10, 11, 15, 14]);
  stroke(s3, [0, 4, 8, 12]);
  s3.lastTouched = 1;
  const h3 = flow.hint(s3, 0);
  assert.equal(h3.flow, 0);
  assert.ok(flow.isSolved(s3));
});

test('ghost: первые 4 клетки решения первого потока в единицах сетки', () => {
  const g = flow.ghost(LEVEL);
  assert.equal(g.length, 4);
  assert.deepEqual(g[0], { x: 0.5, y: 0.5, cell: 0 });
  assert.deepEqual(g[3], { x: 3.5, y: 0.5, cell: 3 });
  assert.equal(flow.ghost({ n: 2, flows: [[0]] }), null);
});

test('layout: квадрат по меньшей стороне с небольшим отступом', () => {
  const s = flow.create(LEVEL);
  const l = flow.layout(s, { x: 0, y: 0, w: 104, h: 204 }, { id: 'dark' });
  assert.equal(l.n, 4);
  assert.equal(l.cell, 25);
  assert.equal(l.size, 100);
  assert.equal(l.x0, 2);
  assert.equal(l.y0, 52);
});

test('перерисовка завершённого потока с другой точки (развёрнутая дорожка) — не ход', () => {
  const s = flow.create(LEVEL);
  stroke(s, [0, 1, 2, 3]);
  assert.equal(s.moves, 1);
  // Тот же путь от другой точки: клетки те же, линия та же — поле не изменилось.
  stroke(s, [3, 2, 1, 0]);
  assert.deepEqual(s.paths[0], [3, 2, 1, 0]);
  assert.equal(s.moves, 1, 'развёрнутая дорожка равна исходной — не ход');
  // А вот неполная перерисовка — поле изменилось.
  stroke(s, [0, 1, 2]);
  assert.deepEqual(s.paths[0], [0, 1, 2]);
  assert.equal(s.moves, 2);
});

test('точная диагональ внутри поля в чужую точку — reject foreign-dot (геометрический фильтр только вне сетки)', () => {
  // A — [5,1,0,4,8,12,13,14,15,11,7,3,2] (точки 5 и 2), B — [6,10,9] (точки 6 и 9).
  const lvl = { n: 4, flows: [[5, 1, 0, 4, 8, 12, 13, 14, 15, 11, 7, 3, 2], [6, 10, 9]] };
  const s = flow.create(lvl);
  down(s, 5);
  // Диагональ 5 → 10 ровно по центрам: обе промежуточные клетки (6 и 9) — чужие точки.
  const evs = move(s, 10);
  assert.deepEqual(kinds(evs), ['reject']);
  assert.equal(evs[0].reason, 'foreign-dot');
  assert.ok(evs[0].cell === 6 || evs[0].cell === 9);
  assert.deepEqual(s.paths[0], [5]);
  up(s);
});

test('footer: одиночные точки заполнением не считаются; текст «ходов N · P %»', () => {
  const s = flow.create(LEVEL);
  assert.deepEqual(flow.footer(s), { ru: 'ходов 0 · 0 %', en: 'moves 0 · 0 %' });
  stroke(s, [0, 1]);
  assert.deepEqual(flow.footer(s), { ru: 'ходов 1 · 13 %', en: 'moves 1 · 13 %' }, '2 из 16 клеток');
  // Стирание пути касанием точки: снова только точка — 0 %.
  down(s, 0);
  up(s);
  assert.equal(flow.footer(s).ru, 'ходов 2 · 0 %');
  stroke(s, [0, 1, 2, 3]);
  stroke(s, [4, 5, 6, 7, 11, 10, 9, 8]);
  stroke(s, [12, 13, 14, 15]);
  assert.deepEqual(flow.footer(s), { ru: 'ходов 5 · 100 %', en: 'moves 5 · 100 %' });
});
