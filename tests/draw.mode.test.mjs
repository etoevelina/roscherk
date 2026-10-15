// Режим «Карандаш» (§2.6): контракт — create/serialize/layout/pointer/actions/act/hint/stats,
// рендер на фейковом ctx продвигает симуляцию и не трогает shadowBlur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import draw from '../src/modes/draw.js';
import { STEPS_PER_SEC } from '../src/modes/draw.sim.js';

const LEVEL = {
  type: 'ball', seed: 101, ink: { total: 260, par: 160, static: true },
  items: [
    { kind: 'ground', poly: [[0, 230], [130, 290], [130, 520], [0, 520]] },
    { kind: 'ground', poly: [[230, 300], [360, 300], [360, 520], [230, 520]] },
    { kind: 'ball', x: 30, y: 230 },
    { kind: 'goal', x: 320, y: 282 },
  ],
  solution: [{ t: 0, pts: [[120, 292], [160, 296], [200, 300], [240, 304]] }],
};
const SWARM = {
  type: 'swarm', seed: 3, ink: { total: 400, par: 300 }, time: 5,
  items: [
    { kind: 'block', x: 0, y: 480, w: 360, h: 40 },
    { kind: 'jar', x: 180, y: 462 },
    { kind: 'nest', x: 40, y: 60, insect: 'wasp', count: 4, every: 300 },
  ],
  solution: [{ t: 0, pts: [[130, 480], [130, 400], [180, 380], [230, 400], [230, 480]] }],
};
const THEME = {
  id: 'light', bg: '#f3f4ef', surface: '#fbfcf9', surface2: '#eceee9', text: '#111311', textMuted: '#5f655f',
  grid: '#e2e5de', wall: '#111311', line: '#9B5A44', lineGlow: '#c9a090', accent: '#9B5A44', hint: '#a07a3c',
  danger: '#9a5e5e', ok: '#56705a', flow: new Array(12).fill('#000'), flowText: new Array(12).fill('#fff'),
};
const RECT = { x: 0, y: 0, w: 342, h: 600 };

function fakeCtx(calls) {
  const props = {};
  return new Proxy(props, {
    get(target, prop) {
      if (prop === 'shadowBlur' || prop === 'shadowColor') throw new Error(`${String(prop)} запрещён`);
      if (prop === 'canvas') return { width: 684, height: 1200 };
      if (prop in target) return target[prop];
      return (...args) => {
        calls.push([String(prop), args]);
        if (prop === 'measureText') return { width: 10 };
        if (prop === 'createRadialGradient') return { addColorStop() {} };
        return undefined;
      };
    },
    set(target, prop, value) {
      if (prop === 'shadowBlur' || prop === 'shadowColor') throw new Error(`${String(prop)} запрещён`);
      target[prop] = value;
      return true;
    },
  });
}

/** Нарисовать штрих указателем в мировых координатах. */
function drawStroke(st, lay, pts) {
  const toScreen = ([x, y]) => ({ x: lay.ox + x * lay.scale, y: lay.oy + y * lay.scale });
  const evs = [];
  pts.forEach((p, i) => {
    const s = toScreen(p);
    evs.push(...draw.pointer(st, lay, { type: i === 0 ? 'down' : 'move', x: s.x, y: s.y, t: i }));
  });
  const last = toScreen(pts[pts.length - 1]);
  evs.push(...draw.pointer(st, lay, { type: 'up', x: last.x, y: last.y, t: 99 }));
  return evs;
}

/** Прокрутить симуляцию через render на seconds секунд. */
function runFor(st, lay, seconds, from = 1000) {
  let t = from;
  const end = from + seconds * 1000;
  while (t < end) {
    draw.render(fakeCtx([]), st, lay, THEME, t, { reducedMotion: true });
    t += 1000 / 60;
  }
  return t;
}

test('layout: мир вписан под полосой чернил, масштаб по меньшей стороне', () => {
  const st = draw.create(LEVEL);
  const lay = draw.layout(st, RECT);
  assert.ok(lay.scale > 0 && Math.abs(lay.w - 360 * lay.scale) < 1e-6);
  assert.ok(lay.oy >= lay.bar.y + lay.bar.h);
  assert.ok(lay.ox + lay.w <= RECT.w + 1e-6 && lay.oy + lay.h <= RECT.h + 1e-6);
});

test('подготовка → штрих пальцем → Пуск → победа; render продвигает сим и не использует shadowBlur', () => {
  const st = draw.create(LEVEL);
  const lay = draw.layout(st, RECT);
  assert.deepEqual(draw.actions(st).map((a) => a.id), ['launch']);
  assert.equal(draw.actions(st)[0].label.ru, 'Пуск');
  const evs = drawStroke(st, lay, LEVEL.solution[0].pts);
  assert.ok(evs.some((e) => e.kind === 'changed') && evs.some((e) => e.kind === 'step'));
  assert.equal(st.strokes.length, 1);
  assert.match(draw.footer(st).ru, /чернила \d+ %/);
  const calls = [];
  draw.render(fakeCtx(calls), st, lay, THEME, 1000, { reducedMotion: false });
  assert.ok(calls.some((c) => c[0] === 'fill'), 'полоса чернил');
  const act = draw.act(st, 'launch', 1000);
  assert.ok(act.some((e) => e.kind === 'launch'));
  assert.deepEqual(draw.actions(st), []);
  runFor(st, lay, 8);
  assert.equal(draw.isSolved(st), true);
  const drained = draw.drainEvents(st);
  assert.ok(drained.some((e) => e.kind === 'solved'));
  assert.equal(draw.perfect(st), true, 'чернил ≤ par');
  assert.ok(draw.stats(st).lines.some((l) => /Потрачено чернил: \d+ %/.test(l.ru)));
});

test('проигрыш → событие lost и «Заново»: те же штрихи, снова подготовка', () => {
  const st = draw.create(LEVEL);
  const lay = draw.layout(st, RECT);
  drawStroke(st, lay, [[60, 150], [100, 150]]); // бесполезный штрих
  draw.act(st, 'launch', 1000);
  runFor(st, lay, 6);
  assert.equal(st.sim.phase, 'lost');
  const evs = draw.drainEvents(st);
  const lost = evs.find((e) => e.kind === 'lost');
  assert.ok(lost && lost.message.ru === 'Шарик упал');
  assert.deepEqual(draw.actions(st).map((a) => a.id), ['retry']);
  assert.deepEqual(draw.pointer(st, lay, { type: 'down', x: 50, y: 50, t: 0 }), [], 'после проигрыша не рисуем');
  draw.act(st, 'retry', 2000);
  assert.equal(st.sim.phase, 'prep');
  assert.equal(st.strokes.length, 1);
  assert.deepEqual(draw.actions(st).map((a) => a.id), ['launch']);
});

test('serialize → create повторяет партию: штрихи, шаги, запуск', () => {
  const st = draw.create(SWARM);
  const lay = draw.layout(st, RECT);
  drawStroke(st, lay, SWARM.solution[0].pts);
  runFor(st, lay, 1);
  draw.act(st, 'launch', 3000);
  runFor(st, lay, 2, 3000);
  const snap = JSON.parse(JSON.stringify(draw.serialize(st)));
  assert.equal(snap.strokes.length, 1);
  assert.ok(snap.steps > 0 && Number.isInteger(snap.launched));
  const back = draw.create(SWARM, snap);
  assert.equal(back.sim.phase, st.sim.phase);
  assert.equal(back.sim.steps, st.sim.steps);
  assert.deepEqual(back.sim.snapshotPositions(), st.sim.snapshotPositions());
  assert.match(draw.nextLabel(back), /держись \d+ с/);
  const junk = draw.create(SWARM, { strokes: 'x', steps: -5 });
  assert.equal(junk.sim.phase, 'prep');
});

test('рой: «Выпустить рой», выдержка времени — победа; подсказка — призрак штриха эталона', () => {
  const st = draw.create(SWARM);
  const lay = draw.layout(st, RECT);
  assert.equal(draw.actions(st)[0].label.ru, 'Выпустить рой');
  const h = draw.hint(st, 500);
  assert.equal(h.kind, 'ghost');
  assert.equal(st.hintUsed, true);
  drawStroke(st, lay, SWARM.solution[0].pts);
  assert.deepEqual(draw.hint(st, 600), { kind: 'none' }, 'штрихов эталона больше нет');
  draw.act(st, 'launch', 1000);
  runFor(st, lay, 7);
  assert.equal(draw.isSolved(st), true);
  assert.ok(draw.stats(st).lines.some((l) => /Выдержано: 5 с/.test(l.ru)));
});

test('чернила: обрезка по бюджету даёт notice; reset возвращает мир и чернила', () => {
  const st = draw.create({ ...LEVEL, ink: { total: 60, par: 60, static: true } });
  const lay = draw.layout(st, RECT);
  const evs = drawStroke(st, lay, [[0, 100], [300, 100]]);
  assert.ok(evs.some((e) => e.kind === 'notice'));
  assert.ok(st.sim.inkUsed <= 60 + 1e-6);
  draw.reset(st);
  assert.equal(st.strokes.length, 0);
  assert.equal(st.sim.inkUsed, 0);
  assert.equal(st.sim.phase, 'prep');
});

test('«Пуск» и «Заново» не попадают в историю отмены (undoable:false)', () => {
  const st = draw.create(LEVEL);
  assert.equal(draw.actions(st)[0].undoable, false);
  const lay = draw.layout(st, RECT);
  drawStroke(st, lay, [[60, 150], [100, 150]]);
  draw.act(st, 'launch', 1000);
  runFor(st, lay, 6);
  assert.equal(draw.actions(st)[0].id, 'retry');
  assert.equal(draw.actions(st)[0].undoable, false);
});

test('восстановление снимка точное: шаткий штрих, повтор совпадает с живой партией', () => {
  const lvl = { ...SWARM, ink: { total: 900, par: 900 } };
  const st = draw.create(lvl);
  const lay = draw.layout(st, RECT);
  // Неровный «палец»: дробные координаты с дрожанием.
  const jitter = Array.from({ length: 40 }, (_, i) => [120 + i * 3.37, 400 - Math.sin(i / 4) * 30 + ((i * 7) % 3) * 0.61]);
  drawStroke(st, lay, jitter);
  runFor(st, lay, 1.5);
  draw.act(st, 'launch', 3000);
  runFor(st, lay, 2, 3000);
  const back = draw.create(lvl, JSON.parse(JSON.stringify(draw.serialize(st))));
  assert.equal(back.sim.inkUsed, st.sim.inkUsed);
  assert.equal(back.sim.phase, st.sim.phase);
  assert.deepEqual(back.sim.snapshotPositions(), st.sim.snapshotPositions());
});
