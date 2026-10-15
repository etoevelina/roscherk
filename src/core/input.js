// Один активный указатель (§4.1): первый pointerdown с isPrimary запоминается по pointerId,
// остальные игнорируются до up/cancel. pointercancel, lostpointercapture, blur и
// visibilitychange→hidden завершают росчерк как `up` (дорожка остаётся, отката нет).
//
// createPointerTracker() — чистая логика без DOM (покрыта тестами);
// attachPointer(el, tracker, onEvent) — привязка к DOM-элементу с setPointerCapture.

/**
 * tracker.handle(raw) → нормализованное событие {type:'down'|'move'|'up', x, y, t} или null.
 * raw = { type, pointerId, isPrimary?, x, y, t }, где type ∈
 *   'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture' | 'blur' | 'hidden'.
 */
export function createPointerTracker() {
  let activeId = null;
  let last = { x: 0, y: 0 };

  function end(raw) {
    activeId = null;
    const x = raw && Number.isFinite(raw.x) ? raw.x : last.x;
    const y = raw && Number.isFinite(raw.y) ? raw.y : last.y;
    return { type: 'up', x, y, t: raw?.t ?? 0 };
  }

  return {
    get active() {
      return activeId !== null;
    },
    get activeId() {
      return activeId;
    },
    handle(raw) {
      switch (raw.type) {
        case 'pointerdown':
          if (activeId !== null) return null; // второй палец игнорируется
          if (raw.isPrimary === false) return null;
          activeId = raw.pointerId ?? 0;
          last = { x: raw.x, y: raw.y };
          return { type: 'down', x: raw.x, y: raw.y, t: raw.t };
        case 'pointermove':
          if (activeId === null || (raw.pointerId ?? 0) !== activeId) return null;
          last = { x: raw.x, y: raw.y };
          return { type: 'move', x: raw.x, y: raw.y, t: raw.t };
        case 'pointerup':
          if (activeId === null || (raw.pointerId ?? 0) !== activeId) return null;
          return end(raw);
        case 'pointercancel':
        case 'lostpointercapture':
          if (activeId === null || (raw.pointerId ?? 0) !== activeId) return null;
          return end(raw);
        case 'blur':
        case 'hidden':
          if (activeId === null) return null;
          return end(null);
        default:
          return null;
      }
    },
    /** Принудительно завершить росчерк (например, при смене уровня). */
    abort() {
      if (activeId === null) return null;
      return end(null);
    },
  };
}

/**
 * attachPointer(el, tracker, onEvent, opts) → detach().
 * Координаты — CSS-px относительно el. onEvent получает нормализованные события трекера.
 * opts.onRawDown(e) вызывается на каждом pointerdown до фильтрации (для разблокировки звука).
 */
export function attachPointer(el, tracker, onEvent, opts = {}) {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const toRaw = (e, type) => {
    const r = el.getBoundingClientRect();
    return {
      type,
      pointerId: e.pointerId,
      isPrimary: e.isPrimary,
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      t: now(),
    };
  };

  const emit = (ev) => {
    if (ev) onEvent(ev);
  };

  const onDown = (e) => {
    opts.onRawDown?.(e);
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    const ev = tracker.handle(toRaw(e, 'pointerdown'));
    if (ev) {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* capture недоступен — работаем без него */
      }
      e.preventDefault();
    }
    emit(ev);
  };
  const onMove = (e) => emit(tracker.handle(toRaw(e, 'pointermove')));
  const onUp = (e) => emit(tracker.handle(toRaw(e, 'pointerup')));
  const onCancel = (e) => emit(tracker.handle(toRaw(e, 'pointercancel')));
  const onLost = (e) => emit(tracker.handle(toRaw(e, 'lostpointercapture')));
  const onBlur = () => emit(tracker.handle({ type: 'blur', t: now() }));
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') emit(tracker.handle({ type: 'hidden', t: now() }));
  };
  const prevent = (e) => e.preventDefault();

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  el.addEventListener('lostpointercapture', onLost);
  el.addEventListener('touchmove', prevent, { passive: false });
  el.addEventListener('gesturestart', prevent, { passive: false });
  el.addEventListener('gesturechange', prevent, { passive: false });
  el.addEventListener('contextmenu', prevent);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
    el.removeEventListener('lostpointercapture', onLost);
    el.removeEventListener('touchmove', prevent);
    el.removeEventListener('gesturestart', prevent);
    el.removeEventListener('gesturechange', prevent);
    el.removeEventListener('contextmenu', prevent);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
