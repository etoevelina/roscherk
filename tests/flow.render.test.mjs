// Render-smoke «Потоков» (§4.3, §7.6): render на фейковом ctx (Proxy, записывающий вызовы)
// не бросает, не трогает shadowBlur, возвращает boolean, кэширует статический слой.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import flow from '../src/modes/flow.js';

const THEME = {
  id: 'dark',
  bg: '#0f1117',
  surface: '#171a22',
  surface2: '#1f232e',
  text: '#f2f3f5',
  textMuted: '#9aa0ab',
  grid: '#2a2f3a',
  wall: '#f2f3f5',
  line: '#ffffff',
  lineGlow: '#ffffff',
  accent: '#F28C3B',
  hint: '#ffd166',
  danger: '#ff5d5d',
  ok: '#4cd964',
  flow: ['#f94144', '#f3722c', '#f8961e', '#f9c74f', '#90be6d', '#43aa8b', '#4d908e', '#577590', '#277da1', '#b56576', '#6d597a', '#e56b6f'],
  flowText: Array(12).fill('#000000'),
};

/** Фейковый Canvas 2D: любой метод записывается; доступ к shadowBlur — ошибка. */
function fakeCtx(calls) {
  const props = {};
  return new Proxy(
    {},
    {
      get(_, key) {
        if (key === 'shadowBlur') throw new Error('shadowBlur запрещён');
        if (key in props) return props[key];
        return (...args) => {
          calls.push({ method: key, args });
        };
      },
      set(_, key, value) {
        if (key === 'shadowBlur') throw new Error('shadowBlur запрещён');
        props[key] = value;
        calls.push({ method: `set ${key}`, args: [value] });
        return true;
      },
    },
  );
}

const LEVEL = { n: 4, flows: [[0, 1, 2, 3], [4, 5, 6, 7, 11, 10, 9, 8], [12, 13, 14, 15]], unique: true };
const RECT = { x: 0, y: 0, w: 320, h: 400 };

test('render: не бросает, рисует статику напрямую без OffscreenCanvas и возвращает boolean', () => {
  const state = flow.create(LEVEL);
  const layout = flow.layout(state, RECT, THEME);
  const calls = [];
  const ctx = fakeCtx(calls);
  const r1 = flow.render(ctx, state, layout, THEME, 1000, { reducedMotion: true, flowNumbers: false });
  assert.equal(typeof r1, 'boolean');
  assert.equal(r1, false, 'без анимаций второй кадр не нужен');
  assert.ok(calls.some((c) => c.method === 'arc'), 'точки нарисованы');
  assert.ok(calls.some((c) => c.method === 'fillRect'), 'подкраска клеток дорожек');
  assert.ok(!calls.some((c) => /shadow/i.test(String(c.method))));
  assert.ok(state._cache && state._cache.canvas === null, 'в Node кэш-холста нет — статика рисуется напрямую');
});

test('render: анимации (всплытие, вспышки, подсказка, победа) → true, после затухания → false', () => {
  const state = flow.create(LEVEL);
  const layout = flow.layout(state, RECT, THEME);
  const calls = [];
  const ctx = fakeCtx(calls);
  const L = { x0: layout.x0, y0: layout.y0, cell: layout.cell, n: 4 };
  const p = (idx) => ({ x: L.x0 + ((idx % 4) + 0.5) * L.cell, y: L.y0 + (Math.floor(idx / 4) + 0.5) * L.cell });
  // Рисуем A, обрезаем B, упираемся в чужую точку: step/cut/reject/complete вспышки.
  flow.pointer(state, layout, { type: 'down', ...p(4), t: 100 });
  flow.pointer(state, layout, { type: 'move', ...p(5), t: 110 });
  flow.pointer(state, layout, { type: 'move', ...p(1), t: 120 });
  flow.pointer(state, layout, { type: 'up', ...p(1), t: 130 });
  flow.pointer(state, layout, { type: 'down', ...p(0), t: 200 });
  flow.pointer(state, layout, { type: 'move', ...p(1), t: 210 });
  flow.pointer(state, layout, { type: 'move', ...p(2), t: 220 });
  flow.pointer(state, layout, { type: 'move', ...p(3), t: 230 });
  flow.pointer(state, layout, { type: 'up', ...p(3), t: 240 });
  flow.hint(state, 250);

  assert.equal(flow.render(ctx, state, layout, THEME, 260, { reducedMotion: false, flowNumbers: true }), true);
  assert.ok(calls.some((c) => c.method === 'fillText'), 'номера на точках');
  assert.ok(calls.some((c) => c.method === 'setLineDash'), 'пунктир подсказки');
  assert.ok(calls.some((c) => c.method === 'drawImage') === false);
  // Через 5 с всё погасло.
  calls.length = 0;
  assert.equal(flow.render(ctx, state, layout, THEME, 6000, { reducedMotion: false, flowNumbers: false }), false);
  assert.ok(!calls.some((c) => c.method === 'fillText'));
  // Победа — пульс линии.
  flow.hint(state, 7000);
  flow.hint(state, 7000);
  assert.ok(flow.isSolved(state));
  assert.equal(flow.render(ctx, state, layout, THEME, 7100 + 2600, { reducedMotion: false, flowNumbers: false }), false, 'подсказка погасла, пульс закончился');
  state._fx.solvedT = 20000;
  assert.equal(flow.render(ctx, state, layout, THEME, 20100, { reducedMotion: false }), true);
  assert.equal(flow.render(ctx, state, layout, THEME, 20100, { reducedMotion: true }), false, 'reducedMotion — без пульса');
});

test('render: статический слой кэшируется в OffscreenCanvas и перерисовывается при смене размера/темы', () => {
  const offCalls = [];
  let created = 0;
  class FakeOffscreen {
    constructor(w, h) {
      created++;
      this.width = w;
      this.height = h;
      this.ctx = fakeCtx(offCalls);
    }
    getContext() {
      return this.ctx;
    }
  }
  const prev = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = FakeOffscreen;
  try {
    const state = flow.create(LEVEL);
    const layout = flow.layout(state, RECT, THEME);
    const calls = [];
    const ctx = fakeCtx(calls);
    flow.render(ctx, state, layout, THEME, 1000, { reducedMotion: true });
    assert.equal(created, 1);
    assert.ok(offCalls.some((c) => c.method === 'arc'), 'точки — в статическом слое');
    assert.ok(calls.some((c) => c.method === 'drawImage'), 'статика берётся из кэша');
    assert.ok(!calls.some((c) => c.method === 'arc'), 'на кадре точки не перерисовываются');
    const staticCalls = offCalls.length;
    flow.render(ctx, state, layout, THEME, 1016, { reducedMotion: true });
    assert.equal(offCalls.length, staticCalls, 'повторный кадр не перерисовывает статику');
    // Смена темы — перерисовка.
    flow.render(ctx, state, layout, { ...THEME, id: 'light' }, 1032, { reducedMotion: true });
    assert.ok(offCalls.length > staticCalls);
    const afterTheme = offCalls.length;
    // Смена размера — перерисовка.
    const layout2 = flow.layout(state, { x: 0, y: 0, w: 200, h: 200 }, THEME);
    flow.render(ctx, state, layout2, THEME, 1048, { reducedMotion: true });
    assert.ok(offCalls.length > afterTheme);
    assert.equal(created, 1, 'холст переиспользуется');
    assert.ok(!('_cache' in flow.serialize(state)));
  } finally {
    if (prev === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = prev;
  }
});

test('render: всплытие уровня — только для чистого состояния; восстановление снимка (undo) не мигает', () => {
  const fresh = flow.create(LEVEL);
  const layout = flow.layout(fresh, RECT, THEME);
  let calls = [];
  assert.equal(flow.render(fakeCtx(calls), fresh, layout, THEME, 5000, { reducedMotion: false }), true, 'чистое состояние всплывает');
  assert.equal(calls.find((c) => c.method === 'set globalAlpha').args[0], 0, 'первый кадр всплытия прозрачен');
  calls = [];
  assert.equal(flow.render(fakeCtx(calls), fresh, layout, THEME, 5100, { reducedMotion: false }), true);
  assert.equal(calls.find((c) => c.method === 'set globalAlpha').args[0], 0.5);
  assert.equal(flow.render(fakeCtx([]), fresh, layout, THEME, 5300, { reducedMotion: false }), false, 'всплытие закончилось');
  // Восстановление снимка — без всплытия: первый кадр сразу непрозрачен и не требует анимации.
  flow.pointer(fresh, layout, { type: 'down', x: layout.x0 + layout.cell / 2, y: layout.y0 + layout.cell / 2, t: 6000 });
  flow.pointer(fresh, layout, { type: 'move', x: layout.x0 + layout.cell * 1.5, y: layout.y0 + layout.cell / 2, t: 6010 });
  flow.pointer(fresh, layout, { type: 'up', x: 0, y: 0, t: 6020 });
  const restored = flow.create(LEVEL, flow.serialize(fresh));
  calls = [];
  assert.equal(flow.render(fakeCtx(calls), restored, layout, THEME, 7000, { reducedMotion: false }), false);
  assert.equal(calls.find((c) => c.method === 'set globalAlpha').args[0], 1);
  assert.deepEqual(restored.paths[0], [0, 1]);
});

test('render: масштаб кэша статики берётся из матрицы ctx (как ставит оболочка), иначе devicePixelRatio', () => {
  class FakeOffscreen {
    constructor(w, h) {
      this.width = w;
      this.height = h;
      this.ctx = fakeCtx([]);
    }
    getContext() {
      return this.ctx;
    }
  }
  const prev = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = FakeOffscreen;
  try {
    const state = flow.create(LEVEL);
    const layout = flow.layout(state, RECT, THEME);
    const ctx = fakeCtx([]);
    ctx.getTransform = () => ({ a: 2, d: 2 });
    flow.render(ctx, state, layout, THEME, 1000, { reducedMotion: true });
    assert.equal(state._cache.dpr, 2);
    assert.equal(state._cache.canvas.width, Math.ceil(layout.size * 2));
    // Смена масштаба холста — перерисовка кэша в новом масштабе.
    ctx.getTransform = () => ({ a: 3, d: 3 });
    flow.render(ctx, state, layout, THEME, 1016, { reducedMotion: true });
    assert.equal(state._cache.dpr, 3);
    assert.equal(state._cache.canvas.width, Math.ceil(layout.size * 3));
    // Без getTransform — devicePixelRatio (в Node его нет → 1).
    const plain = flow.create(LEVEL);
    flow.render(fakeCtx([]), plain, layout, THEME, 1000, { reducedMotion: true });
    assert.equal(plain._cache.dpr, 1);
  } finally {
    if (prev === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = prev;
  }
});

test('render: ctx с shadowBlur-ловушкой — обращение бросает, render его не трогает', () => {
  const ctx = fakeCtx([]);
  assert.throws(() => ctx.shadowBlur);
  assert.throws(() => {
    ctx.shadowBlur = 4;
  });
  const state = flow.create(LEVEL);
  const layout = flow.layout(state, RECT, THEME);
  assert.doesNotThrow(() => flow.render(ctx, state, layout, THEME, 0, {}));
  assert.doesNotThrow(() => flow.render(ctx, state, layout, THEME, 50));
});
