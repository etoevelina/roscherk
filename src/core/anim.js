// Анимации (§4.3): easing-функции и короткие таймлайны от performance.now().
// Всё чистое: вход — время, выход — число; состояние анимации хранит вызывающий.

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
export const easeInOutQuad = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
export const easeOutBack = (x) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/** progress(t0, dur, t) → доля [0,1] прошедшего времени анимации. */
export function progress(t0, dur, t) {
  if (dur <= 0) return 1;
  return clamp01((t - t0) / dur);
}

/** Пульс 0…1…0 с периодом period (мс), фаза от t0. */
export function pulse(t, period = 1200, t0 = 0) {
  const phase = ((t - t0) % period) / period;
  return 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
}

/**
 * createFlashes() — список коротких вспышек {key, t0, dur, kind}.
 * add(key, t, kind, dur); each(t, fn) вызывает fn(flash, alpha) и удаляет завершённые;
 * active(t) → есть ли живые.
 */
export function createFlashes() {
  const list = [];
  return {
    add(key, t, kind = 'step', dur = 320) {
      list.push({ key, t0: t, dur, kind });
      if (list.length > 64) list.splice(0, list.length - 64);
    },
    each(t, fn) {
      for (let i = list.length - 1; i >= 0; i--) {
        const f = list[i];
        const p = progress(f.t0, f.dur, t);
        if (p >= 1) {
          list.splice(i, 1);
          continue;
        }
        fn(f, 1 - easeOutCubic(p), p);
      }
    },
    active(t) {
      return list.some((f) => progress(f.t0, f.dur, t) < 1);
    },
    clear() {
      list.length = 0;
    },
  };
}

/**
 * createGhost(points, { period = 4000, travel = 1500 }) — «призрачная» анимация обучения:
 * точка едет вдоль points, повтор раз в period мс. at(t) → {x, y, alpha} | null (пауза между
 * повторами). nextStart(t, t0) → мс до начала следующего прохода (0, если проход идёт сейчас),
 * чтобы оболочка не держала rAF-цикл во время паузы (§4.3).
 */
export function createGhost(points, { period = 4000, travel = 1500 } = {}) {
  if (!points || points.length < 2) return null;
  const segs = points.length - 1;
  const phaseOf = (t, t0) => (((t - t0) % period) + period) % period;
  return {
    points,
    period,
    travel,
    nextStart(t, t0 = 0) {
      const phase = phaseOf(t, t0);
      return phase > travel ? period - phase : 0;
    },
    at(t, t0 = 0) {
      const phase = phaseOf(t, t0);
      if (phase > travel) return null;
      const p = easeInOutQuad(phase / travel) * segs;
      const i = Math.min(segs - 1, Math.floor(p));
      const k = p - i;
      const a = points[i];
      const b = points[i + 1];
      const fade = phase < 200 ? phase / 200 : phase > travel - 300 ? (travel - phase) / 300 : 1;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, alpha: clamp01(fade), progress: p / segs };
    },
  };
}
