// Тесты src/core/canvas.js и src/core/anim.js без DOM: рендер по запросу (§4.3) с фейковым
// requestAnimationFrame — один кадр при false, цикл при true, stop(); призрак обучения не держит
// цикл в паузе между повторами (nextStart).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRenderLoop, createOffscreen, pixelRatio, roundRect, boardRect, createFrameBudget } from '../src/core/canvas.js';
import { createGhost, progress, pulse, clamp01, createFlashes } from '../src/core/anim.js';

/** Фейковый rAF: кадры копятся в очереди и выполняются вручную через flush(). */
function fakeRaf() {
  const queue = [];
  const prev = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => {
    queue.push(cb);
    return queue.length;
  };
  let t = 0;
  return {
    get pending() {
      return queue.length;
    },
    flush() {
      const cbs = queue.splice(0);
      t += 16;
      for (const cb of cbs) cb(t);
      return cbs.length;
    },
    restore() {
      if (prev === undefined) delete globalThis.requestAnimationFrame;
      else globalThis.requestAnimationFrame = prev;
    },
  };
}

test('invalidate → ровно один rAF; повторные invalidate до кадра не дублируют', () => {
  const raf = fakeRaf();
  try {
    let frames = 0;
    const loop = createRenderLoop(() => {
      frames++;
      return false;
    });
    assert.equal(raf.pending, 0, 'без invalidate кадров нет');
    loop.invalidate();
    loop.invalidate();
    loop.invalidate();
    assert.equal(raf.pending, 1);
    raf.flush();
    assert.equal(frames, 1);
    assert.equal(raf.pending, 0, 'frame вернул false → цикл остановлен');
  } finally {
    raf.restore();
  }
});

test('пока frame возвращает true — цикл продолжается; после false — останавливается', () => {
  const raf = fakeRaf();
  try {
    let left = 3;
    let frames = 0;
    const loop = createRenderLoop(() => {
      frames++;
      return --left > 0;
    });
    loop.invalidate();
    let guard = 0;
    while (raf.pending && guard++ < 10) raf.flush();
    assert.equal(frames, 3);
    assert.equal(raf.pending, 0);
  } finally {
    raf.restore();
  }
});

test('stop(): запланированный кадр не рисуется, новые invalidate игнорируются; ошибка кадра не ломает цикл', () => {
  const raf = fakeRaf();
  try {
    let frames = 0;
    const loop = createRenderLoop(() => {
      frames++;
      return true;
    });
    loop.invalidate();
    loop.stop();
    raf.flush();
    assert.equal(frames, 0);
    loop.invalidate();
    assert.equal(raf.pending, 0);

    let calls = 0;
    const prevError = console.error;
    console.error = () => {};
    try {
      const bad = createRenderLoop(() => {
        calls++;
        throw new Error('boom');
      });
      bad.invalidate();
      raf.flush();
      assert.equal(calls, 1);
      assert.equal(raf.pending, 0, 'после ошибки цикл не продолжается');
      bad.invalidate();
      assert.equal(raf.pending, 1, 'но новый invalidate работает');
    } finally {
      console.error = prevError;
    }
  } finally {
    raf.restore();
  }
});

test('createGhost: проход за travel, пауза до period, nextStart даёт мс до следующего прохода', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];
  assert.equal(createGhost(null), null);
  assert.equal(createGhost([{ x: 0, y: 0 }]), null);
  const g = createGhost(pts, { period: 4000, travel: 1500 });
  assert.equal(g.period, 4000);
  assert.equal(g.travel, 1500);
  const t0 = 10000;
  const start = g.at(t0, t0);
  assert.ok(start && start.x === 0 && start.y === 0 && start.alpha === 0);
  const mid = g.at(t0 + 750, t0);
  assert.ok(mid && mid.alpha === 1 && mid.progress > 0 && mid.progress < 1);
  const end = g.at(t0 + 1500, t0);
  assert.ok(end && end.x === 100 && end.y === 100);
  assert.equal(g.at(t0 + 1501, t0), null, 'пауза');
  assert.equal(g.at(t0 + 3999, t0), null);
  assert.ok(g.at(t0 + 4000, t0), 'новый проход');
  assert.equal(g.nextStart(t0 + 750, t0), 0, 'во время прохода — 0');
  assert.equal(g.nextStart(t0 + 1501, t0), 2499);
  assert.equal(g.nextStart(t0 + 3999, t0), 1);
  assert.equal(g.nextStart(t0 - 1000, t0), 1000, 'отрицательная фаза нормализуется');
});

test('easing и вспышки', () => {
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(2), 1);
  assert.equal(progress(100, 200, 200), 0.5);
  assert.equal(progress(100, 0, 100), 1);
  assert.ok(Math.abs(pulse(0, 1000, 0)) < 1e-9);
  assert.ok(Math.abs(pulse(500, 1000, 0) - 1) < 1e-9);
  const flashes = createFlashes();
  flashes.add('a', 0, 'step', 100);
  assert.equal(flashes.active(50), true);
  let seen = 0;
  flashes.each(50, (f, alpha) => {
    seen++;
    assert.equal(f.key, 'a');
    assert.ok(alpha > 0 && alpha < 1);
  });
  assert.equal(seen, 1);
  flashes.each(200, () => assert.fail('завершённая вспышка не должна вызываться'));
  assert.equal(flashes.active(200), false);
});

test('pixelRatio: матрица ctx → devicePixelRatio → 1; битые значения отбрасываются', () => {
  assert.equal(pixelRatio({ getTransform: () => ({ a: 2, d: 2 }) }), 2);
  assert.equal(pixelRatio({ getTransform: () => ({ a: 0 }) }), 1, 'a ≤ 0 → запасной путь (в Node devicePixelRatio нет)');
  assert.equal(pixelRatio({ getTransform: () => undefined }), 1);
  assert.equal(pixelRatio({}), 1);
  const prev = globalThis.devicePixelRatio;
  try {
    globalThis.devicePixelRatio = 3;
    assert.equal(pixelRatio({}), 3);
    assert.equal(pixelRatio({ getTransform: () => ({ a: 1.5 }) }), 1.5, 'матрица ctx важнее devicePixelRatio');
    globalThis.devicePixelRatio = NaN;
    assert.equal(pixelRatio({}), 1);
  } finally {
    if (prev === undefined) delete globalThis.devicePixelRatio;
    else globalThis.devicePixelRatio = prev;
  }
});

test('createOffscreen: OffscreenCanvas, иначе document.createElement, иначе null', () => {
  assert.equal(createOffscreen(10, 10), null, 'в Node без OffscreenCanvas и document — null');
  const prevOff = globalThis.OffscreenCanvas;
  const prevDoc = globalThis.document;
  try {
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({}) }) };
    const fromDoc = createOffscreen(7, 9);
    assert.deepEqual([fromDoc.width, fromDoc.height], [7, 9]);
    globalThis.OffscreenCanvas = class {
      constructor(w, h) {
        this.width = w;
        this.height = h;
      }
    };
    const off = createOffscreen(3, 4);
    assert.ok(off instanceof globalThis.OffscreenCanvas);
    assert.deepEqual([off.width, off.height], [3, 4]);
  } finally {
    if (prevOff === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = prevOff;
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
  }
});

test('roundRect: контур из moveTo/lineTo/arcTo, закрытый, радиус не больше половины стороны', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_, k) => (...args) => calls.push([k, args]) });
  roundRect(ctx, 0, 0, 10, 20, 8);
  assert.equal(calls[0][0], 'beginPath');
  assert.equal(calls[calls.length - 1][0], 'closePath');
  assert.equal(calls.filter((c) => c[0] === 'arcTo').length, 4);
  // Радиус ужат до 5 (половина меньшей стороны): первая точка контура — (5, 0).
  assert.deepEqual(calls[1], ['moveTo', [5, 0]]);
  for (const c of calls.filter((c) => c[0] === 'arcTo')) assert.equal(c[1][4], 5);
});

test('boardRect: верх поля на 22 % свободной высоты, не меньше 12px и не выше центра; без запаса — без изменений', () => {
  // Портрет: 327×600 → сторона 327, free 273, top = 60.06 → центр нового rect = 60.06 + 163.5.
  const r = boardRect({ x: 0, y: 0, w: 327, h: 600 });
  assert.equal(r.x, 0);
  assert.equal(r.y, 0);
  assert.equal(r.w, 327);
  assert.ok(Math.abs(r.h - (327 + 2 * 60.06)) < 1e-9);
  const top = r.y + r.h / 2 - 327 / 2;
  assert.ok(Math.abs(top - 0.22 * 273) < 1e-9, 'верхний край поля = 22 % free');
  assert.ok(r.h <= 600 && r.h >= 327, 'rect не длиннее холста и не короче стороны квадрата');
  // Режим центрирует квадрат в rect: y0 = (h' − side) / 2 даёт тот же верхний край.
  assert.ok(Math.abs((r.h - 327) / 2 - top) < 1e-9);

  // Маленький запас: 22 % от 60 = 13.2 ≥ 12 → доля; при free 40 (8.8 < 12) → минимум 12px.
  const small = boardRect({ x: 0, y: 0, w: 300, h: 360 });
  assert.ok(Math.abs((small.h - 300) / 2 - 13.2) < 1e-9);
  const smaller = boardRect({ x: 0, y: 0, w: 300, h: 340 });
  assert.ok(Math.abs((smaller.h - 300) / 2 - 12) < 1e-9);
  // Совсем маленький запас: минимум 12px выше центра (free/2 = 5) → ограничиваем центром.
  const tiny = boardRect({ x: 0, y: 0, w: 300, h: 310 });
  assert.ok(Math.abs((tiny.h - 300) / 2 - 5) < 1e-9);
  assert.equal(tiny.h, 310, 'поле остаётся по центру');

  // Нет свободной высоты (ландшафт или квадрат) — rect прежний.
  assert.deepEqual(boardRect({ x: 0, y: 0, w: 600, h: 300 }), { x: 0, y: 0, w: 600, h: 300 });
  assert.deepEqual(boardRect({ x: 0, y: 0, w: 300, h: 300 }), { x: 0, y: 0, w: 300, h: 300 });
  // Смещение x/y исходного rect сохраняется, исходный объект не мутирует.
  const src = { x: 5, y: 7, w: 100, h: 200 };
  const shifted = boardRect(src);
  assert.deepEqual(src, { x: 5, y: 7, w: 100, h: 200 });
  assert.equal(shifted.x, 5);
  assert.equal(shifted.y, 7);
  assert.ok(Math.abs(shifted.h - (100 + 2 * 22)) < 1e-9, '22 % от 100 = 22');
  // Параметры: доля и минимум настраиваемы.
  const custom = boardRect({ x: 0, y: 0, w: 100, h: 300 }, { topShare: 0.5, minTop: 0 });
  assert.equal(custom.h, 300, 'доля 0.5 = центр');
});

test('createFrameBudget: первые 3 кадра после reset не предупреждают, дальше — только при превышении', () => {
  const budget = createFrameBudget(4, 3);
  assert.equal(budget.check(30), false, '1-й кадр: статический слой');
  assert.equal(budget.check(30), false, '2-й кадр');
  assert.equal(budget.check(30), false, '3-й кадр');
  assert.equal(budget.check(30), true, '4-й кадр: настоящая проблема');
  assert.equal(budget.check(4), false, 'ровно бюджет — не превышение');
  assert.equal(budget.check(4.1), true);
  // Смена уровня/темы/размера → снова 3 тихих кадра.
  budget.reset();
  assert.equal(budget.check(30), false);
  assert.equal(budget.check(30), false);
  assert.equal(budget.check(30), false);
  assert.equal(budget.check(30), true);
  // Короткие кадры тоже расходуют прогрев — тишина не «копится».
  budget.reset();
  budget.check(1);
  budget.check(1);
  budget.check(1);
  assert.equal(budget.check(5), true);
  // Умолчания: 4 мс и 3 кадра.
  const def = createFrameBudget();
  assert.deepEqual([def.check(10), def.check(10), def.check(10), def.check(10)], [false, false, false, true]);
});
