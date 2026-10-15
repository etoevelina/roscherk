// Бесконечность (§3.2): режим или «микс»; сложность растёт с серией по chapter уровня пула.
// Уровень выбирается случайно среди непройденных в этой сессии. Источник случайности — rng.js.
import { mulberry32, hash32 } from './rng.js';

export const MIX = 'mix';

/** chaptersForStreak(streak) → допустимые главы: 0–4 → [1,2], 5–9 → [3], 10–14 → [4], 15+ → [5]. */
export function chaptersForStreak(streak) {
  if (streak < 5) return [1, 2];
  if (streak < 10) return [3];
  if (streak < 15) return [4];
  return [5];
}

/**
 * pickEndlessLevel({ pools, modeIds, modeChoice, streak, usedIds, seed }) → { mode, level } | null.
 * pools — { [mode]: level[] } (pool каждого режима). Сначала ищутся непройденные уровни нужных
 * глав; если их нет — любые непройденные; если и их нет — любые (сессия исчерпала пул).
 */
export function pickEndlessLevel({ pools, modeIds, modeChoice = MIX, streak = 0, usedIds = new Set(), seed = 1 }) {
  const rng = mulberry32(hash32(seed, streak, usedIds.size));
  const modes = modeChoice === MIX ? modeIds : [modeChoice];
  const chapters = chaptersForStreak(streak);

  const candidates = (filter) => {
    const out = [];
    for (const mode of modes) {
      for (const level of pools[mode] || []) {
        if (filter(level)) out.push({ mode, level });
      }
    }
    return out;
  };

  let list = candidates((l) => chapters.includes(l.chapter) && !usedIds.has(l.id));
  if (list.length === 0) list = candidates((l) => !usedIds.has(l.id));
  if (list.length === 0) list = candidates(() => true);
  if (list.length === 0) return null;
  return list[rng.int(list.length)];
}

/** Обновить лучшие серии: возвращает новый объект best. */
export function updateBest(best, modeChoice, streak) {
  const key = modeChoice || MIX;
  if ((best[key] || 0) >= streak) return best;
  return { ...best, [key]: streak };
}

/**
 * createStreakTracker(initial) — серия Бесконечности внутри одной партии (§3.2).
 * streak — живое значение; before — серия, с которой открыли уровень (для «Повторить»).
 * break() обрывает серию (подсказка или пропуск): обнуляет и streak, и before, чтобы ни победа
 * в этой партии, ни «Повторить» не воскресили серию; возвращает прежнее значение (0 — обрывать
 * было нечего). win() считает от живого значения, а не от снятого при открытии уровня.
 */
export function createStreakTracker(initial = 0) {
  let streak = Math.max(0, initial | 0);
  let before = streak;
  let broken = false;
  return {
    get streak() {
      return streak;
    },
    get before() {
      return before;
    },
    get broken() {
      return broken;
    },
    break() {
      const was = streak;
      streak = 0;
      before = 0;
      broken = true;
      return was;
    },
    win() {
      streak += 1;
      return streak;
    },
  };
}
