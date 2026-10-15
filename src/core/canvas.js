// Холст (§4.3): devicePixelRatio, ResizeObserver на контейнере, matchMedia('(resolution: …)')
// для смены DPR. Рендер по запросу: dirty-флаг → rAF; цикл живёт, пока кадр возвращает true.

/**
 * createCanvas(container, onResize) → { canvas, ctx, rect(), dpr(), destroy() }.
 * canvas растягивается на весь контейнер; размер буфера = CSS-размер × DPR.
 * onResize(rect) вызывается после каждого пересчёта размера (rect = {x:0,y:0,w,h} в CSS-px).
 */
export function createCanvas(container, onResize) {
  const canvas = document.createElement('canvas');
  canvas.className = 'game-canvas';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let rect = { x: 0, y: 0, w: 0, h: 0 };
  let dpr = window.devicePixelRatio || 1;
  let dprQuery = null;

  function measure() {
    const r = container.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    rect = { x: 0, y: 0, w, h };
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    onResize?.(rect, dpr);
  }

  // Подписка на смену DPR (зум страницы / перенос окна между экранами).
  function watchDpr() {
    if (typeof matchMedia !== 'function') return;
    if (dprQuery) dprQuery.removeEventListener?.('change', onDprChange);
    dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprQuery.addEventListener?.('change', onDprChange);
  }
  function onDprChange() {
    measure();
    watchDpr();
  }

  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => measure());
    ro.observe(container);
  } else {
    window.addEventListener('resize', measure);
  }
  watchDpr();
  measure();

  return {
    canvas,
    ctx,
    rect: () => rect,
    dpr: () => dpr,
    /** Сбросить трансформацию под DPR и очистить холст перед кадром. */
    begin() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.w, rect.h);
    },
    measure,
    destroy() {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      dprQuery?.removeEventListener?.('change', onDprChange);
      canvas.remove();
    },
  };
}

/**
 * createRenderLoop(frame) → { invalidate(), stop() }.
 * frame(t) → boolean; true = нужен ещё кадр. Постоянного цикла нет: rAF ставится по invalidate()
 * и продолжается, пока frame возвращает true.
 */
export function createRenderLoop(frame) {
  let scheduled = false;
  let stopped = false;

  function tick(t) {
    scheduled = false;
    if (stopped) return;
    let more = false;
    try {
      more = frame(t) === true;
    } catch (err) {
      console.error('render failed', err);
    }
    if (more) invalidate();
  }

  function invalidate() {
    if (scheduled || stopped) return;
    scheduled = true;
    requestAnimationFrame(tick);
  }

  return {
    invalidate,
    stop() {
      stopped = true;
    },
  };
}

// --- Хелперы статического слоя режимов (§4.3) ---------------------------------------------
// Режимы кэшируют сетку/узлы во внеэкранном холсте (state._cache); масштаб кэша обязан совпадать
// с масштабом холста оболочки, поэтому и создание холста, и чтение DPR живут здесь, а не в каждом
// режиме: любое ограничение DPR в createCanvas автоматически распространится на все кэши.

/** createOffscreen(w, h) → OffscreenCanvas, иначе document.createElement('canvas'), иначе null (Node). */
export function createOffscreen(w, h) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return null;
}

/**
 * pixelRatio(ctx) → масштаб устройства: из текущей матрицы ctx (оболочка ставит setTransform(dpr, …)
 * перед кадром, см. createCanvas().begin), иначе devicePixelRatio, иначе 1.
 */
export function pixelRatio(ctx) {
  if (ctx && typeof ctx.getTransform === 'function') {
    const m = ctx.getTransform();
    if (m && typeof m.a === 'number' && m.a > 0 && Number.isFinite(m.a)) return m.a;
  }
  const dpr = typeof globalThis.devicePixelRatio === 'number' ? globalThis.devicePixelRatio : 1;
  return dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
}

/** roundRect(ctx, x, y, w, h, r): контур прямоугольника со скруглёнными углами (без заливки/обводки). */
export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

// --- Хелперы оболочки: положение поля и бюджет кадра ----------------------------------------

/**
 * boardRect(rect, opts) → rect для mode.layout: поле (квадрат по меньшей стороне) поднято так,
 * чтобы его верхний край стоял на topShare свободной высоты (free = h − сторона квадрата), но не
 * выше minTop px и не ниже центра. Режимы центрируют поле в rect, поэтому сдвиг задаётся через
 * уменьшенную высоту: центр нового rect = нужный центр поля. Для stroke (bbox фигуры) работает
 * так же — фигура центрируется в том же укороченном rect. Чистая функция, rect не мутирует.
 */
export function boardRect(rect, { topShare = 0.22, minTop = 12 } = {}) {
  const { x = 0, y = 0, w = 0, h = 0 } = rect || {};
  const side = Math.min(w, h);
  const free = h - side;
  if (!(free > 0)) return { x, y, w, h };
  const top = Math.min(Math.max(free * topShare, minTop), free / 2);
  return { x, y, w, h: side + 2 * top };
}

/**
 * createFrameBudget(budgetMs, warmupFrames) → { check(dt), reset() }.
 * check(dt) → true, если кадр длиннее бюджета и его надо залогировать. Первые warmupFrames кадров
 * после reset() (смена уровня, темы, размера: перестройка статического слоя, появление) не
 * считаются — иначе в консоли dev-режима шум вместо настоящих проблем (§4.3).
 */
export function createFrameBudget(budgetMs = 4, warmupFrames = 3) {
  let quiet = warmupFrames;
  return {
    check(dt) {
      if (quiet > 0) {
        quiet--;
        return false;
      }
      return dt > budgetMs;
    },
    reset() {
      quiet = warmupFrames;
    },
  };
}
