// Render-smoke режима «Один штрих»: фейковый Canvas 2D ctx (Proxy, записывающий вызовы),
// обращение к shadowBlur — падение. Проверяется и ветвь с кэшем статического слоя (OffscreenCanvas).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import stroke from '../src/modes/stroke.js';

const THEME_DARK = {
  id: 'dark',
  bg: '#0f1117',
  surface: '#171a23',
  surface2: '#20242f',
  text: '#f2f2f2',
  textMuted: '#8a90a0',
  grid: '#2a2f3b',
  wall: '#c5c9d4',
  line: '#F2A33C',
  lineGlow: 'rgba(242,163,60,0.5)',
  accent: '#F2A33C',
  hint: '#5ad1a0',
  danger: '#ff5c5c',
  ok: '#5ad17a',
  flow: [],
  flowText: [],
};
const THEME_LIGHT = { ...THEME_DARK, id: 'light' };

/** Фейковый ctx: любое свойство — функция, записывающая вызов; shadowBlur — исключение. */
function fakeCtx() {
  const calls = [];
  const props = {};
  const target = { canvas: { width: 600, height: 600 } };
  const ctx = new Proxy(target, {
    get(_, prop) {
      if (prop === 'shadowBlur') throw new Error('shadowBlur запрещён');
      if (prop === 'calls') return calls;
      if (prop === 'props') return props;
      if (prop in target) return target[prop];
      if (prop in props) return props[prop];
      return (...args) => {
        calls.push([prop, args]);
        if (prop === 'getContext') return ctx;
        return undefined;
      };
    },
    set(_, prop, value) {
      if (prop === 'shadowBlur') throw new Error('shadowBlur запрещён');
      props[prop] = value;
      calls.push(['set:' + prop, [value]]);
      return true;
    },
  });
  return ctx;
}

const LEVEL = {
  w: 2,
  h: 2,
  nodes: [[0, 0], [1.05, -0.08], [0.95, 1.1], [0, 1]],
  edges: [[0, 1, 1], [1, 2, 0], [2, 3, 0], [0, 3, 0], [0, 2, 0]],
  start: 0,
  closed: false,
  solution: [0, 1, 2, 3, 0, 2],
};
const RECT = { x: 24, y: 100, w: 342, h: 342 };

function play(state, layout, nodes, t = 0) {
  const ev = (type, v) => stroke.pointer(state, layout, { type, x: layout.px[v], y: layout.py[v], t });
  ev('down', nodes[0]);
  for (let i = 1; i < nodes.length; i++) ev('move', nodes[i]);
  ev('up', nodes[nodes.length - 1]);
}

const savedGlobals = {};
afterEach(() => {
  for (const k of Object.keys(savedGlobals)) {
    if (savedGlobals[k] === undefined) delete globalThis[k];
    else globalThis[k] = savedGlobals[k];
  }
  for (const k of Object.keys(savedGlobals)) delete savedGlobals[k];
});

test('render не бросает и не трогает shadowBlur: пустое поле, частичный путь, подсказка, отказ, победа', () => {
  const state = stroke.create(LEVEL);
  const layout = stroke.layout(state, RECT, THEME_DARK);
  const ctx = fakeCtx();
  const opts = { reducedMotion: false, flowNumbers: false };

  // Пустое поле, первый кадр (анимация появления → true).
  assert.equal(typeof stroke.render(ctx, state, layout, THEME_DARK, 1000, opts), 'boolean');
  assert.equal(stroke.render(ctx, state, layout, THEME_DARK, 1000, opts), true);
  // Спустя секунду без изменений — кадров больше не нужно.
  assert.equal(stroke.render(ctx, state, layout, THEME_DARK, 2000, opts), false);

  // Частичный путь + отказ + подсказка.
  play(state, layout, [0, 1, 2, 3], 2100);
  stroke.pointer(state, layout, { type: 'down', x: layout.px[3], y: layout.py[3], t: 2200 });
  const rej = stroke.pointer(state, layout, { type: 'move', x: layout.px[1], y: layout.py[1], t: 2200 });
  assert.equal(rej[0].kind, 'reject'); // 3 и 1 не смежны
  const h = stroke.hint(state, 2200);
  assert.equal(h.kind, 'edge');
  assert.equal(stroke.render(ctx, state, layout, THEME_DARK, 2250, opts), true); // вспышка + подсказка
  assert.equal(stroke.render(ctx, state, layout, THEME_DARK, 2600, opts), true); // подсказка ещё светится
  assert.equal(stroke.render(ctx, state, layout, THEME_DARK, 5000, opts), false); // всё погасло

  // Два тупика → пульс нечётных точек, затем статичные кольца.
  state.deadEnds = 2;
  state._fx.deadEndAt = 6000;
  assert.equal(stroke.render(ctx, state, layout, THEME_DARK, 6100, opts), true);
  assert.equal(stroke.render(ctx, state, layout, THEME_DARK, 20000, opts), false);

  // Победа: пульс линии 1.2 с.
  stroke.reset(state);
  play(state, layout, [0, 1, 2, 3, 0, 2], 30000);
  assert.ok(stroke.isSolved(state));
  assert.equal(stroke.render(ctx, state, layout, THEME_DARK, 30500, opts), true);
  assert.equal(stroke.render(ctx, state, layout, THEME_DARK, 32000, opts), false);

  // В ctx были реальные вызовы рисования, и ничего не упало.
  const names = new Set(ctx.calls.map((c) => c[0]));
  for (const n of ['beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill', 'save', 'restore']) assert.ok(names.has(n), n);
  assert.ok(!names.has('drawImage'), 'без OffscreenCanvas статический слой рисуется напрямую');
  assert.equal(state._cache.canvas, null);
});

test('reducedMotion: кадры без анимаций — render сразу возвращает false', () => {
  const state = stroke.create(LEVEL);
  const layout = stroke.layout(state, RECT, THEME_DARK);
  const ctx = fakeCtx();
  const opts = { reducedMotion: true };
  assert.equal(stroke.render(ctx, state, layout, THEME_DARK, 0, opts), false);
  play(state, layout, [0, 1], 10);
  assert.equal(stroke.render(ctx, state, layout, THEME_DARK, 20, opts), false);
  // Подсказка всё же держится до until (без мигания).
  stroke.hint(state, 20);
  assert.equal(stroke.render(ctx, state, layout, THEME_DARK, 30, opts), true);
  assert.equal(stroke.render(ctx, state, layout, THEME_DARK, 3000, opts), false);
});

test('статический слой кэшируется через OffscreenCanvas и перерисовывается при смене темы/размера', () => {
  let created = 0;
  const offCtx = fakeCtx();
  savedGlobals.OffscreenCanvas = globalThis.OffscreenCanvas;
  savedGlobals.devicePixelRatio = globalThis.devicePixelRatio;
  globalThis.devicePixelRatio = 3;
  globalThis.OffscreenCanvas = class {
    constructor(w, h) {
      created++;
      this.width = w;
      this.height = h;
    }
    getContext() {
      return offCtx;
    }
  };

  const state = stroke.create(LEVEL);
  const layout = stroke.layout(state, RECT, THEME_DARK);
  const ctx = fakeCtx();
  stroke.render(ctx, state, layout, THEME_DARK, 0, {});
  stroke.render(ctx, state, layout, THEME_DARK, 16, {});
  stroke.render(ctx, state, layout, THEME_DARK, 32, {});
  assert.equal(created, 1, 'один offscreen на неизменный layout/тему');
  assert.ok(state._cache.canvas instanceof globalThis.OffscreenCanvas);
  assert.equal(state._cache.canvas.width, Math.ceil(layout.bw * 3));
  // На кадре статика идёт через drawImage, а не через повторную отрисовку узлов.
  assert.ok(ctx.calls.some((c) => c[0] === 'drawImage'));
  assert.ok(offCtx.calls.some((c) => c[0] === 'arc'));
  // Смена темы → новый слой.
  stroke.render(ctx, state, layout, THEME_LIGHT, 48, {});
  assert.equal(created, 2);
  // Смена размеров → новый слой; тот же layout — нет.
  const layout2 = stroke.layout(state, { x: 0, y: 0, w: 200, h: 200 }, THEME_LIGHT);
  stroke.render(ctx, state, layout2, THEME_LIGHT, 64, {});
  stroke.render(ctx, state, layout2, THEME_LIGHT, 80, {});
  assert.equal(created, 3);
  // Статический слой не должен лезть в shadowBlur (Proxy бросил бы).
  assert.equal('shadowBlur' in offCtx.props, false);
});

test('fallback на document.createElement("canvas"), когда OffscreenCanvas нет', () => {
  savedGlobals.document = globalThis.document;
  savedGlobals.OffscreenCanvas = globalThis.OffscreenCanvas;
  delete globalThis.OffscreenCanvas;
  const offCtx = fakeCtx();
  let created = 0;
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      created++;
      return { width: 0, height: 0, getContext: () => offCtx };
    },
  };
  const state = stroke.create(LEVEL);
  const layout = stroke.layout(state, RECT, THEME_DARK);
  const ctx = fakeCtx();
  stroke.render(ctx, state, layout, THEME_DARK, 0, {});
  stroke.render(ctx, state, layout, THEME_DARK, 16, {});
  assert.equal(created, 1);
  assert.ok(state._cache.canvas.width > 0);
  assert.ok(ctx.calls.some((c) => c[0] === 'drawImage'));
});

test('serialize не содержит _cache и JSON-сериализуем после render', () => {
  const state = stroke.create(LEVEL);
  const layout = stroke.layout(state, RECT, THEME_DARK);
  stroke.render(fakeCtx(), state, layout, THEME_DARK, 0, {});
  const snap = stroke.serialize(state);
  const json = JSON.stringify(snap);
  assert.ok(!json.includes('_cache'));
  assert.deepEqual(JSON.parse(json), snap);
});

test('появление (всплытие 200 мс) не переигрывается для восстановленного состояния и при opts.appeared', () => {
  const alphas = (ctx) => ctx.calls.filter((c) => c[0] === 'set:globalAlpha').map((c) => c[1][0]);
  // Свежий уровень: первый кадр стартует всплытие — alpha < 1 и нужен ещё кадр.
  const fresh = stroke.create(LEVEL);
  const layoutF = stroke.layout(fresh, RECT, THEME_DARK);
  const ctxF = fakeCtx();
  assert.equal(stroke.render(ctxF, fresh, layoutF, THEME_DARK, 1000, {}), true);
  assert.ok(alphas(ctxF).some((a) => a < 1));
  // Undo/restore: create(level, snapshot) — без всплытия: alpha везде 1, кадр не требует продолжения.
  const restored = stroke.create(LEVEL, { path: [], hintUsed: false, deadEnds: 0 });
  const layoutR = stroke.layout(restored, RECT, THEME_DARK);
  const ctxR = fakeCtx();
  assert.equal(stroke.render(ctxR, restored, layoutR, THEME_DARK, 0, {}), false);
  assert.ok(alphas(ctxR).length > 0 && alphas(ctxR).every((a) => a === 1));
  // Оболочка пометила состояние как уже показанное (opts.appeared) — тоже без всплытия.
  const marked = stroke.create(LEVEL);
  const ctxM = fakeCtx();
  assert.equal(stroke.render(ctxM, marked, stroke.layout(marked, RECT, THEME_DARK), THEME_DARK, 0, { appeared: true }), false);
  assert.ok(alphas(ctxM).every((a) => a === 1));
});
