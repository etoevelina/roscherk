// Прогресс кампании (§2.1, §3.1): попытка, звезда, окно из 3 уровней, пропуск. Чистые функции.

export const WINDOW = 3;
export const SKIP_RESETS = 3;
export const SKIP_IDLE_MS = 90000;
export const HINT_PULSE_IDLE_MS = 60000;
export const UNDO_DEPTH = 50;

/** Пройден ли уровень (есть запись прогресса с лучшим временем). */
export function isDone(progress, levelId) {
  const rec = progress[levelId];
  return !!rec && rec.bestMs > 0;
}

/**
 * lastPassedIndex(levels, progress, skipped) → индекс последнего пройденного или пропущенного
 * уровня (−1, если таких нет). Окно открытых уровней считается от него.
 */
export function lastPassedIndex(levels, progress, skipped = []) {
  const skip = new Set(skipped);
  let last = -1;
  for (let i = 0; i < levels.length; i++) {
    if (isDone(progress, levels[i].id) || skip.has(levels[i].id)) last = i;
  }
  return last;
}

/**
 * levelStatuses(levels, progress, skipped, { byChapter }) → [{ index, id, status, star, bestMs, skipped }],
 * status ∈ 'done' | 'open' | 'locked'. Открыты все уровни до lastPassed + WINDOW включительно;
 * уровень, открытый однажды, обратно не закрывается. byChapter (§2.5, «Слова») — окно считается
 * отдельно в каждой главе (подряд идущие уровни с одинаковым chapter), index остаётся сквозным.
 */
export function levelStatuses(levels, progress, skipped = [], { byChapter = false } = {}) {
  if (byChapter) {
    const out = [];
    let start = 0;
    while (start < levels.length) {
      let end = start + 1;
      while (end < levels.length && levels[end].chapter === levels[start].chapter) end++;
      for (const s of levelStatuses(levels.slice(start, end), progress, skipped)) out.push({ ...s, index: s.index + start });
      start = end;
    }
    return out;
  }
  const skip = new Set(skipped);
  const last = lastPassedIndex(levels, progress, skipped);
  const openUntil = last + WINDOW;
  return levels.map((level, index) => {
    const rec = progress[level.id];
    const done = isDone(progress, level.id);
    return {
      index,
      id: level.id,
      status: done ? 'done' : index <= openUntil ? 'open' : 'locked',
      star: !!rec?.star,
      bestMs: rec?.bestMs || 0,
      skipped: skip.has(level.id),
    };
  });
}

export function isOpen(levels, progress, skipped, index) {
  const last = lastPassedIndex(levels, progress, skipped);
  return index <= last + WINDOW;
}

/**
 * nextLevelIndex(levels, progress, skipped) → индекс «следующего непройденного»:
 * первый открытый непройденный и непропущенный; если таких нет — первый непройденный
 * (пропущенный); если всё пройдено — −1.
 */
export function nextLevelIndex(levels, progress, skipped = [], opts = {}) {
  const statuses = levelStatuses(levels, progress, skipped, opts);
  const fresh = statuses.find((s) => s.status === 'open' && !s.skipped);
  if (fresh) return fresh.index;
  const anyOpen = statuses.find((s) => s.status === 'open');
  return anyOpen ? anyOpen.index : -1;
}

export function doneCount(levels, progress) {
  return levels.reduce((acc, l) => acc + (isDone(progress, l.id) ? 1 : 0), 0);
}

/** Новая попытка (§2.1): открытие уровня из списка, «Повторить», «Дальше». */
export function startAttempt(now) {
  return { hintUsed: false, resets: 0, startedAt: now, lastChangeAt: now };
}

/** Звезда — за попытку без подсказок и при perfect режима. */
export function starFor(attempt, perfect = true) {
  return !attempt.hintUsed && perfect === true;
}

/**
 * recordWin(progress, levelId, star, ms) → новый объект progress для режима.
 * Звезда, полученная однажды, сохраняется; лучшее время — минимум.
 */
export function recordWin(progress, levelId, star, ms) {
  const prev = progress[levelId];
  const bestMs = prev && prev.bestMs > 0 ? Math.min(prev.bestMs, ms) : ms;
  return { ...progress, [levelId]: { star: !!(prev?.star || star), bestMs: Math.max(1, Math.round(bestMs)) } };
}

/** Пропуск: уровень остаётся без галочки, следующий открывается. */
export function recordSkip(skipped, levelId) {
  return skipped.includes(levelId) ? skipped : [...skipped, levelId];
}

/** Доступен ли «Пропустить»: после 3 сбросов или 90 с без изменения состояния. */
export function skipAvailable(attempt, now) {
  return attempt.resets >= SKIP_RESETS || now - attempt.lastChangeAt >= SKIP_IDLE_MS;
}

/** Пульсирует ли кнопка подсказки: 60 с без изменения состояния. */
export function hintShouldPulse(attempt, now) {
  return now - attempt.lastChangeAt >= HINT_PULSE_IDLE_MS;
}

/** Таймер по активным интервалам (§3.3). */
export function createTimer(initialMs = 0) {
  let accumulated = initialMs;
  let openedAt = null;
  return {
    start(now) {
      if (openedAt === null) openedAt = now;
    },
    pause(now) {
      if (openedAt !== null) {
        accumulated += Math.max(0, now - openedAt);
        openedAt = null;
      }
    },
    elapsed(now) {
      return accumulated + (openedAt === null ? 0 : Math.max(0, now - openedAt));
    },
    get running() {
      return openedAt !== null;
    },
  };
}

/** Стек снимков undo глубиной ≤ 50. */
export function createUndoStack(depth = UNDO_DEPTH) {
  const stack = [];
  return {
    push(snapshot) {
      stack.push(snapshot);
      if (stack.length > depth) stack.splice(0, stack.length - depth);
    },
    pop() {
      return stack.pop();
    },
    get size() {
      return stack.length;
    },
    clear() {
      stack.length = 0;
    },
  };
}
