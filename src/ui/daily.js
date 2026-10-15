// Вкладка «Ежедневная» (docs/DESIGN.md §5.8, эталон WORDS «Daily Challenge»).
// Заголовок и дата, справа — календарь; полоса недели Пн–Вс (сегодня — шалфейная плашка, решённые
// дни — точка); сцена на шёлке map-backdrop с мини-превью уровня дня (его режим, иконка, размеры);
// подпись, серия, одна чёрная кнопка «Начать головоломку →» / «Продолжить →» / «Решена ✓»;
// ниже — четыре недели точками (calendar()). Правила ежедневной (§3.2) — в src/core/daily.js.
import { h, icon, modeIcon } from './dom.js';
import { screen, iconButton, button, art, progress, formatDate } from './kit.js';
import { tr, daysWord } from '../core/i18n.js';
import { pickDaily, isDailyDone, displayStreak, calendar, addDays } from '../core/daily.js';
import { weekStart } from '../core/stats.js';
import { findLevel } from '../core/levels.js';
import { hash32 } from '../core/rng.js';
import { plural } from './stats.js';

const COPY = {
  title: 'Ежедневная',
  calendar: 'Календарь серии',
  week: 'Эта неделя',
  eyebrow: 'Головоломка дня',
  lead: 'Новая головоломка каждый день. Реши до полуночи, чтобы сохранить серию.',
  start: 'Начать головоломку',
  resume: 'Продолжить',
  resumeNote: 'Партия сохранена — продолжи с того же места',
  solved: 'Решена',
  tomorrow: 'Новая — завтра',
  none: 'Головоломки дня нет в этой сборке',
  month: 'Четыре недели',
  streak: (n) => `Серия · ${n} ${daysWord(n)}`,
  best: (n) => `Лучшая · ${n}`,
  begin: 'Реши сегодняшнюю — и серия начнётся',
  restart: 'Реши сегодняшнюю, чтобы начать новую серию',
  toBest: (n, best) => `Серия ${n} из рекорда ${best}`,
  monthCount: (k) => `${k} ${plural(k, ['день', 'дня', 'дней'])} из 28`,
  monthLabel: (k) => `За четыре недели решено ${k} ${plural(k, ['день', 'дня', 'дней'])} из 28`,
};

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WEEKDAYS_FULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const WEEKDAY_LETTERS = ['П', 'В', 'С', 'Ч', 'П', 'С', 'В'];

/** weekStrip(daily, today) → 7 дней текущей недели Пн–Вс: { date, label, day, today, future, done }. */
export function weekStrip(daily, todayStr) {
  const mon = weekStart(todayStr);
  return WEEKDAYS.map((label, i) => {
    const date = addDays(mon, i);
    return { date, label, day: Number(date.slice(8)), today: date === todayStr, future: date > todayStr, done: isDailyDone(daily, date) };
  });
}

/**
 * monthGrid(daily, today) → 28 дней четырьмя полными неделями Пн–Вс (последняя — текущая), чтобы
 * столбцы совпадали с днями недели: calendar() до воскресенья этой недели; дни после сегодня — future.
 */
export function monthGrid(daily, todayStr) {
  const sunday = addDays(weekStart(todayStr), 6);
  return calendar(daily, sunday, 28).map((d) => ({ ...d, today: d.date === todayStr, future: d.date > todayStr, done: d.done && d.date <= todayStr }));
}

/**
 * dailyAction(state, today, { hasLevel, currentFound }) → 'done' | 'resume' | 'start' | 'none'.
 * resume — прерванная ежедневная именно сегодняшнего дня (вчерашняя не продолжается, §3.2).
 */
export function dailyAction(state, todayStr, { hasLevel = true, currentFound = false } = {}) {
  if (isDailyDone(state.daily, todayStr)) return 'done';
  const cur = state.current;
  if (cur && cur.kind === 'daily' && cur.date === todayStr && currentFound) return 'resume';
  return hasLevel ? 'start' : 'none';
}

/** levelFacts(modeId, level) → «6×6 · 7 чисел» / «7×7 · 8 пар» / «12 точек · 17 линий» (или ''). */
export function levelFacts(modeId, level) {
  if (!level) return '';
  if (modeId === 'zip' && level.n) {
    const k = (level.marks || []).length;
    return `${level.n}×${level.n} · ${k} ${plural(k, ['число', 'числа', 'чисел'])}`;
  }
  if (modeId === 'flow' && level.n) {
    const k = (level.flows || []).length;
    return `${level.n}×${level.n} · ${k} ${plural(k, ['пара', 'пары', 'пар'])}`;
  }
  if (modeId === 'stroke' && level.nodes) {
    const a = level.nodes.length;
    const b = (level.edges || []).length;
    return `${a} ${plural(a, ['точка', 'точки', 'точек'])} · ${b} ${plural(b, ['линия', 'линии', 'линий'])}`;
  }
  return '';
}

export function mountDaily(app) {
  const { state } = app;
  const today = app.today();
  const rotationIds = app.rotationModes.map((m) => m.id);
  const pick = rotationIds.length ? pickDaily(today, rotationIds, app.dailyPoolSize()) : null;
  const mode = pick ? app.modeById[pick.mode] : null;
  const level = mode ? app.modeSets(mode.id).daily[pick.index] || null : null;
  const cur = state.current;
  const currentFound = !!cur && cur.kind === 'daily' && !!findLevel(app.levels, cur.mode, cur.levelId);
  const action = dailyAction(state, today, { hasLevel: !!level, currentFound });
  const streak = displayStreak(state.daily, today);
  const best = Math.max(state.daily.bestStreak || 0, streak);

  // --- Шапка: заголовок, дата; справа — календарь (прокрутка к четырём неделям) -------------
  const monthTitle = h('h2', { class: 'w-h3', id: 'dl-month-title', tabindex: '-1', text: COPY.month });
  let monthCard = null;
  const head = h(
    'div',
    { class: 'ds-head' },
    h('div', { class: 'ds-head-text' }, h('h1', { class: 'w-title', text: COPY.title }), h('p', { class: 'ds-date', text: formatDate(today) })),
    iconButton(
      'calendar',
      COPY.calendar,
      () => {
        app.audio?.tap?.();
        monthCard?.scrollIntoView({ behavior: app.reducedMotion() ? 'auto' : 'smooth', block: 'start' });
        monthTitle.focus({ preventScroll: true });
      },
      { filled: true },
    ),
  );

  // --- Полоса недели -------------------------------------------------------------------------
  const strip = h(
    'ol',
    { class: 'dl-week', 'aria-label': COPY.week },
    weekStrip(state.daily, today).map((d, i) => {
      const status = [d.today ? 'сегодня' : '', d.done ? 'решена' : ''].filter(Boolean).join(', ');
      return h(
        'li',
        {
          class: `dl-day${d.today ? ' today' : ''}${d.done ? ' done' : ''}${d.future ? ' future' : ''}`,
          'aria-label': `${WEEKDAYS_FULL[i]}, ${formatDate(d.date, { year: false })}${status ? `, ${status}` : ''}`,
          'aria-current': d.today ? 'date' : null,
        },
        h('span', { class: 'dl-day-name', 'aria-hidden': 'true', text: d.label }),
        h('span', { class: 'dl-day-num', 'aria-hidden': 'true', text: String(d.day) }),
        h('i', { class: 'dl-day-dot', 'aria-hidden': 'true' }),
      );
    }),
  );

  // --- Сцена: шёлк + мини-превью уровня дня --------------------------------------------------
  const facts = levelFacts(mode?.id, level);
  const modeName = mode ? tr(mode.name) : '—';
  const scene = h(
    'div',
    { class: `dl-scene${action === 'done' ? ' is-done' : ''}` },
    art('map-backdrop', 'dl-scene-bg'),
    h(
      'div',
      { class: 'dl-scene-text' },
      h('span', { class: 'dl-scene-icon', 'aria-hidden': 'true' }, modeIcon(mode)),
      h('p', { class: 'w-eyebrow', text: COPY.eyebrow }),
      h('p', { class: 'dl-scene-mode', text: modeName }),
      facts ? h('p', { class: 'dl-scene-facts', text: facts }) : null,
    ),
    h(
      'div',
      { class: 'dl-preview' },
      previewSvg(mode?.id, level, app.theme?.obj?.flow, today, `Головоломка дня: ${modeName}${facts ? `, ${facts}` : ''}`),
      action === 'done' ? h('span', { class: 'dl-preview-badge', 'aria-hidden': 'true' }, icon('check')) : null,
    ),
  );

  // --- Серия ---------------------------------------------------------------------------------
  const streakSub = best > 0 ? COPY.restart : COPY.begin;
  const streakCard = h(
    'div',
    { class: 'dl-streak' },
    h('span', { class: 'dl-streak-icon', 'aria-hidden': 'true' }, icon('flame')),
    h(
      'div',
      { class: 'dl-streak-main' },
      h('div', { class: 'dl-streak-line' }, h('b', { text: COPY.streak(streak) }), best > 0 ? h('span', { text: COPY.best(best) }) : null),
      // Серия идёт — тонкий прогресс до рекорда; нет серии — мягкая подсказка вместо пустой полосы.
      streak > 0 ? progress(streak / best, COPY.toBest(streak, best)) : h('p', { class: 'dl-streak-sub', text: streakSub }),
    ),
  );

  // --- Главное действие ----------------------------------------------------------------------
  let cta;
  let note = null;
  if (action === 'done') {
    cta = h('button', { class: 'w-btn tonal block dl-solved', type: 'button', disabled: true }, h('span', { text: COPY.solved }), icon('check'));
    note = COPY.tomorrow;
  } else if (action === 'resume') {
    cta = button(COPY.resume, {
      arrow: true,
      block: true,
      onClick: () => {
        app.audio?.tap?.();
        app.go('game', { kind: 'daily', modeId: cur.mode, levelId: cur.levelId, date: today });
      },
    });
    note = COPY.resumeNote;
  } else if (action === 'start') {
    cta = button(COPY.start, {
      arrow: true,
      block: true,
      onClick: () => {
        app.audio?.tap?.();
        app.startDaily();
      },
    });
  } else {
    cta = button(COPY.start, { arrow: true, block: true, disabled: true });
    note = COPY.none;
  }
  const actionBlock = h('div', { class: 'dl-action' }, cta, note ? h('p', { class: 'dl-note', text: note }) : null);

  // --- Четыре недели точками -----------------------------------------------------------------
  const grid = monthGrid(state.daily, today);
  const solvedCount = grid.filter((d) => d.done).length;
  monthCard = h(
    'section',
    { class: 'dl-month', 'aria-labelledby': 'dl-month-title' },
    h('div', { class: 'dl-month-head' }, monthTitle, h('span', { class: 'dl-month-count', text: COPY.monthCount(solvedCount) })),
    h('div', { class: 'dl-month-days', 'aria-hidden': 'true' }, WEEKDAY_LETTERS.map((l) => h('span', { text: l }))),
    h(
      'div',
      { class: 'dl-month-grid', role: 'img', 'aria-label': COPY.monthLabel(solvedCount) },
      grid.map((d) => h('i', { class: `${d.done ? 'done' : ''}${d.today ? ' today' : ''}${d.future ? ' future' : ''}`.trim() || null })),
    ),
  );

  const { el } = screen(
    { className: 'dl-screen', tabbar: true, app, active: 'daily' },
    head,
    strip,
    scene,
    h('p', { class: 'w-body dl-lead', text: COPY.lead }),
    streakCard,
    actionBlock,
    monthCard,
  );
  return { el, destroy() {} };
}

// --- Мини-превью уровня дня (SVG без решения: только условие) ---------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';
const FLOW_FALLBACK = ['#ce7a7f', '#e8a86b', '#ebd176', '#99ca8f', '#7fb8c9', '#9d97d6', '#d39ac2', '#b0a08a'];

function s(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  return el;
}

/** Сетка n×n клеток по 10 единиц: подложка и тонкие линии. */
function gridBase(svg, n) {
  const size = n * 10;
  svg.setAttribute('viewBox', `-2 -2 ${size + 4} ${size + 4}`);
  svg.append(s('rect', { class: 'bg', x: 0, y: 0, width: size, height: size, rx: 2.5 }));
  const lines = s('path', {
    class: 'gl',
    d: Array.from({ length: n - 1 }, (_, i) => `M${(i + 1) * 10} 0V${size}M0 ${(i + 1) * 10}H${size}`).join(''),
  });
  svg.append(lines);
  svg.append(s('rect', { class: 'frame', x: 0, y: 0, width: size, height: size, rx: 2.5 }));
}

const center = (idx, n) => [(idx % n) * 10 + 5, Math.floor(idx / n) * 10 + 5];

export function previewSvg(modeId, level, flowColors, dateStr, label) {
  const svg = s('svg', { class: 'dl-pv', role: 'img', 'aria-label': label, preserveAspectRatio: 'xMidYMid meet' });
  if (modeId === 'zip' && level?.n) {
    const n = level.n;
    gridBase(svg, n);
    const walls = (level.walls || [])
      .map(([a, b]) => {
        const [r, c] = [Math.floor(a / n), a % n];
        return b === a + 1 ? `M${(c + 1) * 10} ${r * 10}V${(r + 1) * 10}` : `M${c * 10} ${(r + 1) * 10}H${(c + 1) * 10}`;
      })
      .join('');
    if (walls) svg.append(s('path', { class: 'wl', d: walls }));
    for (const [idx, num] of level.marks || []) {
      const [x, y] = center(idx, n);
      svg.append(s('circle', { class: 'mk', cx: x, cy: y, r: 3.4 }));
      const t = s('text', { class: 'mt', x, y: y + 0.1 });
      t.textContent = String(num);
      svg.append(t);
    }
    return svg;
  }
  if (modeId === 'flow' && level?.n) {
    const n = level.n;
    gridBase(svg, n);
    const colors = flowColors && flowColors.length ? flowColors : FLOW_FALLBACK;
    (level.flows || []).forEach((path, i) => {
      if (!path.length) return;
      for (const idx of [path[0], path[path.length - 1]]) {
        const [x, y] = center(idx, n);
        svg.append(s('circle', { class: 'fd', cx: x, cy: y, r: 3.3, fill: colors[i % colors.length] }));
      }
    });
    return svg;
  }
  if (modeId === 'stroke' && level?.nodes?.length) {
    const xs = level.nodes.map((p) => p[0]);
    const ys = level.nodes.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const span = Math.max(x1 - x0, y1 - y0, 1);
    const pad = span * 0.16;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const half = span / 2 + pad;
    // Холст квадратный: фигура по центру, единицы — шаги решётки; толщины — от размера фигуры.
    svg.setAttribute('viewBox', `${cx - half} ${cy - half} ${half * 2} ${half * 2}`);
    svg.append(s('rect', { class: 'bg', x: cx - half, y: cy - half, width: half * 2, height: half * 2, rx: half * 0.12 }));
    const w = span * 0.042;
    const d = (level.edges || [])
      .map(([a, b]) => {
        const p = level.nodes[a];
        const q = level.nodes[b];
        return p && q ? `M${p[0]} ${p[1]}L${q[0]} ${q[1]}` : '';
      })
      .join('');
    svg.append(s('path', { class: 'ed', d, 'stroke-width': w }));
    level.nodes.forEach(([x, y], i) => {
      svg.append(s('circle', { class: i === level.start ? 'nd start' : 'nd', cx: x, cy: y, r: i === level.start ? span * 0.065 : span * 0.048, 'stroke-width': w }));
    });
    return svg;
  }
  // Режим без превью (или уровня нет) — узор 5×5 из даты, как мини-сетка эталона.
  const n = 5;
  gridBase(svg, n);
  const seed = hash32(dateStr || 'roscherk');
  for (let i = 0; i < n * n; i++) {
    if (((seed >>> i) & 1) === 1 && (seed >>> ((i + 7) % 32)) & 1) {
      const [x, y] = center(i, n);
      svg.append(s('rect', { class: 'sq', x: x - 5, y: y - 5, width: 10, height: 10 }));
    }
  }
  return svg;
}
