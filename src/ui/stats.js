// Вкладка «Статистика» (docs/DESIGN.md §5.9, эталон WORDS «Statistics»).
// Заголовок, сегменты Неделя · Месяц · Всё время, столбчатый график (шалфей, текущий — чернилами,
// подписи снизу) с суммой над ним, четыре карточки 2×2 и прогресс по режимам. Данные —
// state.activity (пишется при каждой победе) и progress; расчёты — src/core/stats.js.
import { h, icon, modeIcon } from './dom.js';
import { screen, seg, statCard, progress, button, formatDate } from './kit.js';
import { tr } from '../core/i18n.js';
import { chart, totals, rangeTotal, weekStart } from '../core/stats.js';
import { addDays } from '../core/daily.js';
import { doneCount, levelStars } from '../core/progress.js';

const COPY = {
  title: 'Статистика',
  rangeLabel: 'Период',
  ranges: [
    { id: 'week', label: 'Неделя' },
    { id: 'month', label: 'Месяц' },
    { id: 'all', label: 'Всё время' },
  ],
  over: { week: 'за неделю', month: 'за месяц', all: 'за всё время' },
  last12: 'Последние 12 месяцев',
  emptyTitle: 'Здесь появится твой ритм',
  emptyText: 'Реши головоломку — и график оживёт.',
  emptyCta: 'К ежедневной',
  completed: 'Уровней пройдено',
  noHint: 'Без подсказок',
  streak: 'Серия дней',
  total: 'Всего головоломок',
  noData: 'нет данных',
  modes: 'По режимам',
  chartLabel: 'График решённых головоломок',
};

const PUZZLES = ['головоломка', 'головоломки', 'головоломок'];
const STARS = ['звезда', 'звезды', 'звёзд'];
const MONTHS_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
/** Семейство карточки режима (docs/DESIGN.md §5.3): подложка иконки в списке. */
const FAMILY = { zip: 'sage', flow: 'blue', stroke: 'blush', words: 'lav', draw: 'mist' };

/** plural(n, [одна, две, пять]) → форма слова по числу (1 головоломка, 2 головоломки, 5 головоломок). */
export function plural(n, forms) {
  const a = Math.abs(Math.trunc(Number(n) || 0));
  const m10 = a % 10;
  const m100 = a % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

/** puzzlesLine(n, range) → «12 головоломок за неделю». */
export function puzzlesLine(n, range) {
  return `${n} ${plural(n, PUZZLES)} ${COPY.over[range] || COPY.over.week}`;
}

/** rangeCaption(range, today) → «12–18 октября» / «16 сентября — 15 октября» / «Последние 12 месяцев». */
export function rangeCaption(range, todayStr) {
  if (range === 'all') return COPY.last12;
  const from = range === 'week' ? weekStart(todayStr) : addDays(todayStr, -29);
  const to = range === 'week' ? addDays(from, 6) : todayStr;
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8))}–${formatDate(to, { year: false })}`;
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${formatDate(from, { year: !sameYear })} — ${formatDate(to, { year: !sameYear })}`;
}

/** barLevels(bars, max) → бары с долей высоты frac 0..1 (для пустых — 0). */
export function barLevels(bars, max) {
  const top = Math.max(1, max || 0);
  return bars.map((b) => ({ ...b, frac: Math.max(0, Math.min(1, b.value / top)) }));
}

/** campaignIdsByMode(app) → { [modeId]: [levelId…] } кампании каждого режима этой сборки. */
export function campaignIdsByMode(app) {
  return Object.fromEntries(app.modes.map((m) => [m.id, app.modeSets(m.id).campaign.map((l) => l.id)]));
}

/** modeSummary(modes, campaignOf, progressByMode) → [{ id, done, total, stars, starsMax }] по режимам. */
export function modeSummary(modes, campaignOf, progressByMode) {
  return modes.map((m) => {
    const campaign = campaignOf(m.id) || [];
    const prog = progressByMode[m.id] || {};
    const stars = campaign.reduce((a, l) => a + levelStars(prog[l.id]), 0);
    return { id: m.id, done: doneCount(campaign, prog), total: campaign.length, stars, starsMax: campaign.length * 3 };
  });
}

/** Подпись бара для VoiceOver: «Пн 15 октября — 3» / «окт — 24». */
function barSpeech(bar, range) {
  if (range === 'all') {
    const m = Number(bar.date.slice(5, 7));
    return `${MONTHS_FULL[m - 1] || bar.date} — ${bar.value}`;
  }
  return `${formatDate(bar.date, { year: false })} — ${bar.value}`;
}

let lastRange = 'week'; // выбранный период живёт до перезапуска (возврат на вкладку его помнит)

export function mountStats(app) {
  const { state } = app;
  const today = app.today();
  const ids = campaignIdsByMode(app);
  const sum = totals(state, ids, today);
  const animate = !app.reducedMotion();

  // --- График --------------------------------------------------------------------------------
  const sumTitle = h('h2', { class: 'st-sum', 'aria-live': 'polite' });
  const sumCaption = h('p', { class: 'st-range' });
  const plot = h('div', { class: 'st-plot', role: 'img' });
  const labels = h('div', { class: 'st-labels', 'aria-hidden': 'true' });
  const empty = h(
    'div',
    { class: 'st-empty', hidden: true },
    h('p', { class: 'w-h3', text: COPY.emptyTitle }),
    h('p', { class: 'w-caption', text: COPY.emptyText }),
    button(COPY.emptyCta, {
      variant: 'secondary',
      onClick: () => {
        app.audio?.tap?.();
        app.go('daily');
      },
    }),
  );
  const chartBox = h('div', { class: 'st-chart' }, h('div', { class: 'st-chart-head' }, sumTitle, sumCaption), h('div', { class: 'st-plot-wrap' }, plot, empty), labels);

  function renderChart(range) {
    lastRange = range;
    const { bars, max } = chart(state.activity, today, range);
    const n = range === 'all' ? sum.total : rangeTotal(state.activity, today, range);
    sumTitle.replaceChildren(h('b', { text: String(n) }), ` ${plural(n, PUZZLES)} ${COPY.over[range]}`);
    sumTitle.setAttribute('aria-label', puzzlesLine(n, range));
    sumCaption.textContent = rangeCaption(range, today);
    const level = barLevels(bars, max);
    const isEmpty = bars.every((b) => b.value === 0);
    plot.dataset.range = range;
    plot.classList.toggle('is-empty', isEmpty);
    plot.classList.toggle('anim', animate && !isEmpty);
    plot.setAttribute('aria-label', isEmpty ? `${COPY.chartLabel}: ${COPY.emptyTitle.toLowerCase()}` : `${COPY.chartLabel}: ${level.map((b) => barSpeech(b, range)).join(', ')}`);
    plot.replaceChildren(
      h('div', { class: 'st-gridlines', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
      h(
        'div',
        { class: 'st-bars', 'aria-hidden': 'true', style: { '--n': String(bars.length) } },
        level.map((b, i) =>
          h(
            'div',
            { class: `st-col${b.current ? ' current' : ''}${b.future ? ' future' : ''}${b.value === 0 ? ' zero' : ''}` },
            h('i', { class: 'st-bar', style: { '--v': b.frac.toFixed(3), '--i': String(i) } }),
          ),
        ),
      ),
    );
    labels.dataset.range = range;
    labels.style.setProperty('--n', String(bars.length));
    labels.replaceChildren(...bars.map((b) => h('span', { class: b.current ? 'current' : null, text: b.label })));
    empty.hidden = !(isEmpty && n === 0);
  }
  // Разработка (localhost, как ?screen= в main.js): ?range=month|all — период для скриншотов tools/shot.mjs.
  const devRange = app.dev ? new URLSearchParams(location.search).get('range') : null;
  if (devRange) lastRange = devRange;
  if (!COPY.ranges.some((r) => r.id === lastRange)) lastRange = 'week';
  renderChart(lastRange);
  const rangeSeg = seg(COPY.ranges, lastRange, (id) => renderChart(id), COPY.rangeLabel);
  rangeSeg.classList.add('st-seg');

  // --- Четыре карточки 2×2 -------------------------------------------------------------------
  const noHintCard = statCard(sum.completed ? `${sum.noHintRate}%` : '—', COPY.noHint);
  if (!sum.completed) noHintCard.querySelector('b')?.setAttribute('aria-label', COPY.noData);
  const cards = h(
    'div',
    { class: 'st-cards' },
    statCard(sum.completed, COPY.completed),
    noHintCard,
    statCard(sum.streak, COPY.streak),
    statCard(sum.total, COPY.total),
  );

  // --- Прогресс по режимам -------------------------------------------------------------------
  const rows = modeSummary(app.modes, (id) => app.modeSets(id).campaign, state.progress).map((r) => {
    const mode = app.modeById[r.id];
    const name = tr(mode.name);
    return h(
      'button',
      {
        class: 'st-mode',
        type: 'button',
        'aria-label': `${name}: пройдено ${r.done} из ${r.total}, ${r.stars} ${plural(r.stars, STARS)} из ${r.starsMax}`,
        onClick: () => {
          app.audio?.tap?.();
          if (r.id === 'words') app.go('wordPacks');
          else app.go('levels', { modeId: r.id });
        },
      },
      h('span', { class: `st-mode-icon ${FAMILY[r.id] || 'mist'}`, 'aria-hidden': 'true' }, modeIcon(mode)),
      h(
        'span',
        { class: 'st-mode-main', 'aria-hidden': 'true' },
        h(
          'span',
          { class: 'st-mode-top' },
          h('span', { class: 'st-mode-name', text: name }),
          h('span', { class: 'st-mode-stars' }, icon('star'), h('span', { text: String(r.stars) })),
        ),
        h('span', { class: 'st-mode-bottom' }, progress(r.total ? r.done / r.total : 0), h('span', { class: 'st-mode-count', text: `${r.done} из ${r.total}` })),
      ),
      h('span', { class: 'st-mode-chev', 'aria-hidden': 'true' }, icon('chevron')),
    );
  });
  const modes = h('section', { class: 'st-modes', 'aria-labelledby': 'st-modes-title' }, h('h2', { class: 'w-h3', id: 'st-modes-title', text: COPY.modes }), h('div', { class: 'st-mode-list' }, rows));

  const { el } = screen(
    { className: 'st-screen', tabbar: true, app, active: 'stats' },
    h('div', { class: 'ds-head' }, h('div', { class: 'ds-head-text' }, h('h1', { class: 'w-title', text: COPY.title }))),
    rangeSeg,
    chartBox,
    cards,
    modes,
  );
  return { el, destroy() {} };
}
