// Render-smoke режима «Маршрут» (§7.6): фейковый ctx (Proxy, записывающий вызовы) — render не
// бросает, не трогает shadowBlur, кэширует статический слой через OffscreenCanvas/document,
// а без них рисует напрямую.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import zip from '../src/modes/zip.js';

const LEVEL = { n: 3, path: [0, 1, 4, 3, 6, 7, 8, 5, 2], marks: [[0, 1], [4, 2], [2, 3]], walls: [[1, 2]] };
const LAYOUT = { x0: 10, y0: 10, cell: 30, n: 3, size: 90 };
const THEME = {
  id: 'dark',
  bg: '#0f1117',
  surface: '#171a23',
  surface2: '#202532',
  text: '#f2f4f8',
  textMuted: '#9aa3b5',
  grid: '#2a3040',
  wall: '#dde3ee',
  line: '#4F8CFF',
  lineGlow: '#7FB0FF',
  accent: '#4F8CFF',
  hint: '#FFD166',
  danger: '#FF5D5D',
  ok: '#4CD98A',
  flow: new Array(12).fill('#fff'),
  flowText: new Array(12).fill('#000'),
};

/** Фейковый ctx: любое свойство — записывающая функция; shadowBlur — исключение. */
function fakeCtx(calls, scale = 1) {
  const props = {};
  return new Proxy(props, {
    get(target, prop) {
      if (prop === 'shadowBlur' || prop === 'shadowColor') throw new Error(`${String(prop)} запрещён`);
      if (prop === 'getTransform') return () => ({ a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 });
      if (prop === 'canvas') return { width: 300, height: 300 };
      if (prop in target) return target[prop];
      return (...args) => {
        calls.push([String(prop), args]);
        if (prop === 'measureText') return { width: 10 };
        return undefined;
      };
    },
    set(target, prop, value) {
      if (prop === 'shadowBlur' || prop === 'shadowColor') throw new Error(`${String(prop)} запрещён`);
      target[prop] = value;
      calls.push(['set:' + String(prop), [value]]);
      return true;
    },
  });
}

const called = (calls, name) => calls.filter((c) => c[0] === name).length;

const savedOffscreen = globalThis.OffscreenCanvas;
const savedDocument = globalThis.document;
afterEach(() => {
  if (savedOffscreen === undefined) delete globalThis.OffscreenCanvas;
  else globalThis.OffscreenCanvas = savedOffscreen;
  if (savedDocument === undefined) delete globalThis.document;
  else globalThis.document = savedDocument;
});

test('render без OffscreenCanvas и document: рисует статический слой напрямую, не бросает', () => {
  delete globalThis.OffscreenCanvas;
  delete globalThis.document;
  const st = zip.create(LEVEL);
  const calls = [];
  const ctx = fakeCtx(calls);
  const more = zip.render(ctx, st, LAYOUT, THEME, 1000, { reducedMotion: false, flowNumbers: false });
  assert.equal(typeof more, 'boolean');
  assert.equal(st._cache, null);
  assert.equal(called(calls, 'drawImage'), 0);
  assert.ok(called(calls, 'strokeRect') >= 1, 'рамка поля нарисована напрямую');
  assert.equal(called(calls, 'fillText'), 3, 'все числа нарисованы');
  assert.equal(called(calls, 'strokeText'), 3, 'числа с обводкой');
  assert.ok(calls.some((c) => c[0] === 'set:font' && /\b1[6-9]px|\b[2-9]\dpx/.test(c[1][0])), 'шрифт цифр ≥ 16px');
});

test('render кэширует статический слой в state._cache через OffscreenCanvas и перерисовывает при смене темы/размера', () => {
  const offscreenCalls = [];
  let created = 0;
  globalThis.OffscreenCanvas = class {
    constructor(w, h) {
      created++;
      this.width = w;
      this.height = h;
    }
    getContext() {
      return fakeCtx(offscreenCalls, 2);
    }
  };
  const st = zip.create(LEVEL);
  const calls = [];
  const ctx = fakeCtx(calls, 2);

  zip.render(ctx, st, LAYOUT, THEME, 0, {});
  assert.ok(st._cache, 'кэш создан');
  assert.equal(created, 1);
  assert.equal(st._cache.dpr, 2, 'масштаб взят из матрицы ctx');
  assert.equal(called(calls, 'drawImage'), 1, 'статический слой скопирован одним drawImage');
  assert.equal(called(calls, 'strokeRect'), 0, 'рамка — только в кэше');
  assert.ok(called(offscreenCalls, 'strokeRect') >= 1);

  zip.render(ctx, st, LAYOUT, THEME, 16, {});
  assert.equal(created, 1, 'тот же layout и тема — без перерисовки');

  zip.render(ctx, st, LAYOUT, { ...THEME, id: 'light' }, 32, {});
  assert.equal(created, 2, 'смена темы — перерисовка');

  zip.render(ctx, st, { ...LAYOUT, cell: 40, size: 120 }, { ...THEME, id: 'light' }, 48, {});
  assert.equal(created, 3, 'смена размера — перерисовка');
  assert.equal(JSON.stringify(zip.serialize(st)).includes('cache'), false, 'кэш не сериализуется');
});

test('render через document.createElement("canvas"), когда OffscreenCanvas нет', () => {
  delete globalThis.OffscreenCanvas;
  const offscreenCalls = [];
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return { width: 0, height: 0, getContext: () => fakeCtx(offscreenCalls, 1) };
    },
  };
  const st = zip.create(LEVEL);
  const calls = [];
  zip.render(fakeCtx(calls, 1), st, LAYOUT, THEME, 0, {});
  assert.ok(st._cache);
  assert.ok(st._cache.canvas.width > 0);
  assert.equal(called(calls, 'drawImage'), 1);
});

test('render с дорожкой, подсказкой, отказом и победой: анимации требуют кадров и гаснут', () => {
  delete globalThis.OffscreenCanvas;
  delete globalThis.document;
  const L = { x0: 0, y0: 0, cell: 10, n: 3, size: 30 };
  const c = (cell) => ({ x: (cell % 3) * 10 + 5, y: Math.floor(cell / 3) * 10 + 5 });
  const st = zip.create(LEVEL);
  zip.pointer(st, L, { type: 'down', ...c(0), t: 1000 });
  zip.pointer(st, L, { type: 'move', ...c(1), t: 1001 });
  zip.pointer(st, L, { type: 'move', ...c(2), t: 1002 }); // стена — отказ
  const calls = [];
  const ctx = fakeCtx(calls);
  let more = zip.render(ctx, st, L, THEME, 1010, {});
  assert.equal(more, true, 'идут анимации шага/отказа/пульса');
  assert.ok(called(calls, 'stroke') >= 2, 'свечение и основная линия');

  zip.hint(st, 2000);
  calls.length = 0;
  more = zip.render(ctx, st, L, THEME, 2100, {});
  assert.equal(more, true, 'подсказка видна');

  // Всё погасло: спустя много времени кадры не нужны.
  more = zip.render(ctx, st, L, THEME, 60000, {});
  assert.equal(more, false);
  more = zip.render(ctx, st, L, THEME, 60016, { reducedMotion: true });
  assert.equal(more, false);

  // Победа: пульс линии, затем покой; при reducedMotion — без пульса.
  const win = zip.create(LEVEL);
  zip.pointer(win, L, { type: 'down', ...c(0), t: 0 });
  for (let i = 1; i < LEVEL.path.length; i++) zip.pointer(win, L, { type: 'move', ...c(LEVEL.path[i]), t: i });
  assert.ok(zip.isSolved(win));
  assert.equal(zip.render(ctx, win, L, THEME, 500, {}), true);
  assert.equal(zip.render(ctx, win, L, THEME, 500, { reducedMotion: true }), false);
  assert.equal(zip.render(ctx, win, L, THEME, 5000, {}), false);

  // Одна клетка — точка вместо линии.
  const one = zip.create(LEVEL, { path: [0], backtracks: 0, hintUsed: false });
  calls.length = 0;
  zip.render(ctx, one, L, THEME, 0, {});
  assert.ok(called(calls, 'arc') >= 2);
  assert.equal(calls.some((x) => x[0].startsWith('set:shadow')), false);
});

test('render: getTransform читается только при промахе кэша статического слоя', () => {
  globalThis.OffscreenCanvas = class {
    constructor(w, h) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      return fakeCtx([], 2);
    }
  };
  let transforms = 0;
  const canvas = { width: 300, height: 300 };
  const ctx = new Proxy(
    {},
    {
      get(target, prop) {
        if (prop === 'getTransform') {
          return () => {
            transforms++;
            return { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
          };
        }
        if (prop === 'canvas') return canvas;
        if (prop in target) return target[prop];
        return () => undefined;
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    },
  );
  const st = zip.create(LEVEL);
  zip.render(ctx, st, LAYOUT, THEME, 0, {});
  assert.equal(transforms, 1);
  zip.render(ctx, st, LAYOUT, THEME, 16, {});
  zip.render(ctx, st, LAYOUT, THEME, 32, {});
  assert.equal(transforms, 1, 'тот же холст, клетка и тема — без getTransform');
  canvas.width = 600;
  canvas.height = 600;
  zip.render(ctx, st, LAYOUT, THEME, 48, {});
  assert.equal(transforms, 2, 'сменился размер холста — масштаб перечитан');
});

test('render: «1» пульсирует с открытия уровня и после сброса; всплытие — только при появлении уровня', () => {
  delete globalThis.OffscreenCanvas;
  delete globalThis.document;
  const st = zip.create(LEVEL);
  let calls = [];
  assert.equal(zip.render(fakeCtx(calls), st, LAYOUT, THEME, 1000, {}), true);
  assert.ok(called(calls, 'save') >= 1, 'всплытие при появлении уровня');
  assert.equal(zip.render(fakeCtx([]), st, LAYOUT, THEME, 1000 + 2000, {}), true, 'пульс ожидаемого числа идёт первые 4 с');
  assert.equal(zip.render(fakeCtx([]), st, LAYOUT, THEME, 1000 + 6000, {}), false);
  zip.reset(st);
  assert.equal(zip.render(fakeCtx([]), st, LAYOUT, THEME, 20000, {}), true, 'после сброса пульс — заново');
  assert.equal(zip.render(fakeCtx([]), st, LAYOUT, THEME, 20000 + 6000, {}), false);

  // Восстановление из снимка (undo, продолжение партии) — без всплытия.
  const restored = zip.create(LEVEL, { path: [0, 1], backtracks: 0, hintUsed: false });
  calls = [];
  zip.render(fakeCtx(calls), restored, LAYOUT, THEME, 50, {});
  assert.equal(called(calls, 'save'), 0);
  assert.equal(called(calls, 'restore'), 0);
  assert.equal(restored.appearAt, -Infinity);
});

test('render не трогает состояние партии (кроме служебных меток времени)', () => {
  delete globalThis.OffscreenCanvas;
  delete globalThis.document;
  const st = zip.create(LEVEL, { path: [0, 1, 4], backtracks: 2, hintUsed: true });
  const before = JSON.stringify(zip.serialize(st));
  zip.render(fakeCtx([]), st, LAYOUT, THEME, 123, {});
  assert.equal(JSON.stringify(zip.serialize(st)), before);
});
