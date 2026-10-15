// Ежедневная (§3.2): один уровень в день, режим чередуется, индекс = FNV1a(date) % размер пула.
// Серия растёт, если решён уровень за день, следующий после lastDate. Всё чистое, без DOM.
import { hash32 } from './rng.js';

export const EPOCH = '2026-01-01';
export const DAILY_POOL = 40;
export const HISTORY_LIMIT = 60;

const DAY_MS = 86400000;

/** localDateString(date) → 'YYYY-MM-DD' по локальному времени. */
export function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${y}-${m < 10 ? '0' : ''}${m}-${d < 10 ? '0' : ''}${d}`;
}

/** Разбор 'YYYY-MM-DD' в UTC-полночь (чтобы разность дат не зависела от перехода на летнее время). */
function utcDays(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** dayNumber(dateStr) → число дней от 2026-01-01 (0 для самой даты, может быть отрицательным). */
export function dayNumber(dateStr) {
  return utcDays(dateStr) - utcDays(EPOCH);
}

/** addDays('YYYY-MM-DD', k) → строка даты через k дней. */
export function addDays(dateStr, k) {
  const days = utcDays(dateStr) + k;
  const d = new Date(days * DAY_MS);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const dd = d.getUTCDate();
  return `${y}-${m < 10 ? '0' : ''}${m}-${dd < 10 ? '0' : ''}${dd}`;
}

/**
 * pickDaily(dateStr, modeIds, poolSize) → { mode, index }.
 * mode = modeIds[dayNumber % modeIds.length] (для трёх режимов — dayNumber % 3),
 * index = hash32(dateStr) % poolSize.
 */
export function pickDaily(dateStr, modeIds, poolSize = DAILY_POOL) {
  const n = dayNumber(dateStr);
  const count = modeIds.length;
  const modeIdx = ((n % count) + count) % count;
  return {
    mode: modeIds[modeIdx],
    index: poolSize > 0 ? hash32(dateStr) % poolSize : 0,
  };
}

/** Решён ли уровень дня dateStr. */
export function isDailyDone(daily, dateStr) {
  return daily.history.includes(dateStr);
}

/**
 * recordDailyWin(daily, dateStr) → новый объект daily.
 * Повторная победа в тот же день не меняет серию. Серия растёт, если lastDate — предыдущий день;
 * иначе начинается заново с 1. history — последние 60 дат.
 */
export function recordDailyWin(daily, dateStr) {
  if (daily.history.includes(dateStr)) return daily;
  let streak;
  if (daily.lastDate && addDays(daily.lastDate, 1) === dateStr) streak = daily.streak + 1;
  else if (daily.lastDate === dateStr) streak = daily.streak;
  else streak = 1;
  const history = [...daily.history, dateStr].slice(-HISTORY_LIMIT);
  return {
    streak,
    bestStreak: Math.max(daily.bestStreak, streak),
    lastDate: dateStr,
    history,
  };
}

/** Серия для показа: обрывается, если lastDate старше вчерашнего дня. */
export function displayStreak(daily, todayStr) {
  if (!daily.lastDate) return 0;
  if (daily.lastDate === todayStr || addDays(daily.lastDate, 1) === todayStr) return daily.streak;
  return 0;
}

/** calendar(daily, todayStr, days=28) → [{date, done, today}] от старых к новым. */
export function calendar(daily, todayStr, days = 28) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(todayStr, -i);
    out.push({ date, done: daily.history.includes(date), today: i === 0 });
  }
  return out;
}
