// Звук (§4.5): AudioContext создаётся лениво в первом pointerdown, resume() при каждом
// pointerdown и visibilitychange→visible. Синтез без файлов. Вибрация под guard.

export function createAudio(isEnabled = () => true) {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) return ctx;
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
    }
    return ctx;
  }

  /** Вызывать внутри pointerdown: создаёт контекст и возобновляет его при необходимости. */
  function unlock() {
    const c = ensure();
    if (c && c.state !== 'running') c.resume().catch(() => {});
  }

  /** Вызывать на visibilitychange→visible. */
  function resume() {
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
  }

  function ready() {
    return isEnabled() && ctx && ctx.state === 'running' ? ctx : null;
  }

  /** Короткая нота: type — форма волны, freq — Гц, dur — с, gain — амплитуда. */
  function tone(freq, { type = 'sine', dur = 0.08, gain = 0.5, at = 0, slide = 0 } = {}) {
    const c = ready();
    if (!c) return;
    const t0 = c.currentTime + at;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  return {
    unlock,
    resume,
    /** «Тик» шага: тон слегка растёт с длиной дорожки. */
    step(index = 0) {
      const base = 520 + Math.min(index, 40) * 9;
      tone(base, { type: 'triangle', dur: 0.06, gain: 0.35 });
    },
    /** Отказ: низкий короткий «бзз». */
    reject() {
      tone(140, { type: 'square', dur: 0.12, gain: 0.25, slide: -60 });
    },
    /** Обрезка чужого потока (flow). */
    cut() {
      tone(330, { type: 'sawtooth', dur: 0.09, gain: 0.2, slide: -120 });
    },
    /** Поток завершён (flow). */
    complete() {
      tone(660, { type: 'sine', dur: 0.12, gain: 0.35 });
      tone(990, { type: 'sine', dur: 0.14, gain: 0.3, at: 0.07 });
    },
    /** Аккорд победы. */
    win() {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => tone(f, { type: 'sine', dur: 0.45, gain: 0.3, at: i * 0.07 }));
    },
    /** Мягкий щелчок кнопки. */
    tap() {
      tone(400, { type: 'sine', dur: 0.03, gain: 0.15 });
    },
  };
}

/**
 * Вибрация, если поддерживается (на iOS Safari — нет; вызов безвреден). Chrome до первого
 * жеста пользователя блокирует вызов с ошибкой в консоли — проверяем userActivation.
 */
export function vibrate(pattern) {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    if (navigator.userActivation && navigator.userActivation.hasBeenActive === false) return;
    navigator.vibrate(pattern);
  } catch {
    /* игнорируем */
  }
}
