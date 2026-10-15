// Статистика (docs/DESIGN.md, экран «Статистика»): активность по дням и итоги из прогресса.
// Чистые функции над объектом state — тестируются без DOM.
import { addDays, dayNumber, displayStreak } from './daily.js';
import { ACTIVITY_DAYS } from './storage.js';

/** recordActivity(activity, dateStr) → новый объект: +1 решённая головоломка за день, хвост ≤ ACTIVITY_DAYS. */
export function recordActivity(activity, dateStr) {
  const next = { ...(activity || {}), [dateStr]: ((activity && activity[dateStr]) || 0) + 1 };
  const days = Object.keys(next).sort();
  for (const d of days.slice(0, Math.max(0, days.length - ACTIVITY_DAYS))) delete next[d];
  return next;
}

const WEEKDAY_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTH_RU = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Понедельник недели, в которую попадает dateStr (ISO-неделя, локальная дата YYYY-MM-DD). */
export function weekStart(dateStr) {
  // dayNumber считает от эпохи; 2026-01-05 — понедельник.
  const k = (((dayNumber(dateStr) - dayNumber('2026-01-05')) % 7) + 7) % 7;
  return addDays(dateStr, -k);
}

/**
 * chart(activity, todayStr, range) → { bars:[{label, value, current}], max }.
 * week — 7 дней текущей недели (Пн–Вс); month — последние 30 дней по дням; all — 12 последних месяцев.
 */
export function chart(activity, todayStr, range = 'week') {
  const act = activity || {};
  let bars = [];
  if (range === 'week') {
    const mon = weekStart(todayStr);
    bars = WEEKDAY_RU.map((label, i) => {
      const d = addDays(mon, i);
      return { label, value: act[d] || 0, current: d === todayStr, future: d > todayStr, date: d };
    });
  } else if (range === 'month') {
    for (let i = 29; i >= 0; i--) {
      const d = addDays(todayStr, -i);
      bars.push({ label: i % 7 === 0 ? String(Number(d.slice(8))) : '', value: act[d] || 0, current: i === 0, date: d });
    }
  } else {
    const [y, m] = todayStr.split('-').map(Number);
    for (let i = 11; i >= 0; i--) {
      const mm = (((m - 1 - i) % 12) + 12) % 12;
      const yy = y + Math.floor((m - 1 - i) / 12);
      const prefix = `${yy}-${String(mm + 1).padStart(2, '0')}`;
      const value = Object.entries(act).reduce((a, [d, n]) => (d.startsWith(prefix) ? a + n : a), 0);
      bars.push({ label: MONTH_RU[mm], value, current: i === 0, date: prefix });
    }
  }
  return { bars, max: Math.max(1, ...bars.map((b) => b.value)) };
}

/** Сумма решённых за диапазон (для подписи над графиком). */
export function rangeTotal(activity, todayStr, range = 'week') {
  return chart(activity, todayStr, range).bars.reduce((a, b) => a + b.value, 0);
}

/**
 * totals(state, campaignIdsByMode, todayStr) → { completed, noHintRate, streak, bestStreak, total, stars, starsMax }.
 * completed — пройдено уровней кампании (только тех, что есть в сборке); noHintRate — доля пройденных
 * с 2+ звёздами (без подсказок), 0–100; total — все решённые головоломки (активность; не меньше completed).
 */
export function totals(state, campaignIdsByMode, todayStr) {
  let completed = 0;
  let noHint = 0;
  let stars = 0;
  let starsMax = 0;
  for (const [modeId, ids] of Object.entries(campaignIdsByMode)) {
    const prog = state.progress[modeId] || {};
    starsMax += ids.length * 3;
    for (const id of ids) {
      const rec = prog[id];
      if (!rec) continue;
      completed++;
      const s = rec.stars || (rec.star ? 3 : 1);
      stars += s;
      if (rec.nh || rec.star) noHint++;
    }
  }
  const activityTotal = Object.values(state.activity || {}).reduce((a, n) => a + n, 0);
  return {
    completed,
    noHintRate: completed ? Math.round((noHint / completed) * 100) : 0,
    streak: displayStreak(state.daily, todayStr),
    bestStreak: state.daily.bestStreak || 0,
    total: Math.max(activityTotal, completed),
    stars,
    starsMax,
  };
}
