// Итог уровня (docs/DESIGN.md §5.7, WORDS «Level Complete») и экран «Кампания пройдена».
// Спокойно и без конфетти: мягкое радиальное свечение, лента sage-loop, три звезды одним восходящим
// появлением (700 мс), цитата, три метрики, одна чёрная кнопка. Стили — src/styles/60-game.css.
import { h, icon } from './dom.js';
import { art, button, iconButton } from './kit.js';
import { t, tr, formatTime, daysWord } from '../core/i18n.js';
import { isDailyDone } from '../core/daily.js';

const STAR_WORDS = ['звёзд', 'звезда', 'звезды', 'звезды'];

/** Короткая спокойная фраза режима для итога (у «Слов» вместо неё — разгаданная цитата). */
const MODE_PHRASES = {
  zip: 'Каждый путь начинается с одной клетки.',
  flow: 'Всё связано — нужно лишь найти порядок.',
  stroke: 'Одно движение — и фигура цела.',
  draw: 'Точная линия стоит тысячи попыток.',
};
const DEFAULT_PHRASE = 'Маленькие головоломки. Большая перспектива.';

/** Что значит «идеально» в режиме — подпись к недобранной звезде. */
const PERFECT_HINTS = {
  flow: 'ходов не больше, чем потоков',
  draw: 'чернил не больше нормы',
};

/**
 * keyMetric(statsLine) → { value, label }: «Возвратов: 2» → 2 / «Возвратов»; «Ходов 5 / 5» →
 * «5 / 5» / «Ходов»; «Потрачено чернил: 42 %» → «42 %» / «Потрачено чернил».
 */
export function splitStatLine(text) {
  const s = String(text || '').trim();
  let m = /^(.+?):\s*(.+)$/.exec(s);
  if (m) return { label: m[1], value: m[2] };
  m = /^(\D+?)\s+(\d.*)$/.exec(s);
  if (m) return { label: m[1], value: m[2] };
  return { label: '', value: s };
}

/** Золотая звезда итога: градиент и мягкая тень — как стеклянные объекты системы. */
function starSvg(on, i) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `g-star${on ? ' on' : ''}`);
  svg.style.setProperty('--i', String(i));
  const path = 'M12 2.8l2.75 5.75 6.3.8-4.62 4.36 1.2 6.27L12 16.9l-5.63 3.08 1.2-6.27L2.95 9.35l6.3-.8z';
  svg.innerHTML = on
    ? `<path d="${path}" fill="url(#g-star-fill)" stroke="url(#g-star-fill)" stroke-width="2.2" stroke-linejoin="round"/>` +
      `<ellipse cx="10.2" cy="9.4" rx="2.6" ry="1.5" transform="rotate(-28 10.2 9.4)" fill="rgba(255,255,255,.45)"/>`
    : `<path d="${path}" stroke-width="2.2" stroke-linejoin="round"/>`;
  return svg;
}

/** Общие определения градиента звёзд (один раз на оверлей). */
function starDefs() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'g-star-defs');
  svg.innerHTML =
    '<defs><radialGradient id="g-star-fill" cx="0.38" cy="0.32" r="0.78">' +
    '<stop offset="0" stop-color="#ffe9a3"/><stop offset="0.5" stop-color="#f7c64c"/><stop offset="1" stop-color="#df9426"/>' +
    '</radialGradient></defs>';
  return svg;
}

function metric(iconName, value, label, tone = '') {
  return h(
    'div',
    { class: 'g-metric', role: 'group', 'aria-label': `${label}: ${value}` },
    h('span', { class: `g-metric-icon${tone ? ` ${tone}` : ''}`, 'aria-hidden': 'true' }, icon(iconName)),
    h('b', { 'aria-hidden': 'true', text: String(value) }),
    h('span', { 'aria-hidden': 'true', text: label }),
  );
}

/**
 * buildWinOverlay(app, info) → элемент итога поверх поля.
 * info = { kind, mode, stars, star, perfect, elapsedMs, prevBestMs, statsLines, keyStat, quote, vocab,
 *          chapterDone, chapterLabel, endlessStreak, endlessRecord, dailyStreak, streak, dailyWon,
 *          nextLabel, onNext, onMap, mapLabel, onBack, onRepeat, reducedMotion }.
 */
export function buildWinOverlay(app, info) {
  const kind = info.kind;
  const stars = Math.max(1, Math.min(3, info.stars || 1));
  const isDaily = kind === 'daily';
  const isEndless = kind === 'endless';

  // --- Заголовок и звёзды -----------------------------------------------------------------
  const title = isDaily ? 'Ежедневная решена!' : 'Уровень пройден!';
  const eyebrow = isEndless ? `Бесконечность · серия ${info.endlessStreak ?? 0}` : isDaily ? tr(info.mode.name) : null;
  const missing = [];
  if (stars < 3) {
    if (info.hintUsed) missing.push('без подсказок');
    if (info.perfect === false) missing.push(PERFECT_HINTS[info.mode.id] ? `идеально — ${PERFECT_HINTS[info.mode.id]}` : 'идеально');
  }
  const starsEl = h(
    'div',
    { class: 'g-stars', role: 'img', 'aria-label': `${stars} ${STAR_WORDS[stars]} из 3` },
    [0, 1, 2].map((i) => starSvg(i < stars, i)),
  );

  // --- Цитата: «Слова» — разгаданная; остальные — фраза режима ------------------------------
  const q = info.quote || null;
  const quoteEl = q && q.text
    ? h(
        'figure',
        { class: 'g-quote' },
        h('blockquote', { lang: 'en', text: `“${q.text}”` }),
        q.author ? h('figcaption', { text: `— ${q.author}${q.src && q.src !== 'Proverb' && q.src !== q.author ? `, ${q.src}` : ''}` }) : null,
        q.ru ? h('p', { class: 'g-quote-ru', text: q.ru }) : null,
      )
    : h('figure', { class: 'g-quote' }, h('blockquote', { text: `«${MODE_PHRASES[info.mode.id] || DEFAULT_PHRASE}»` }));

  // --- Метрики: ⏱ время · ◎ ключевая метрика режима · 🔥 серия --------------------------------
  const delta = info.prevBestMs > 0 ? info.elapsedMs - info.prevBestMs : 0;
  const timeLabel = delta < 0 ? 'Новый рекорд' : 'Время';
  const key = info.keyStat || { value: '—', label: '' };
  const streakValue = isEndless ? info.endlessStreak ?? 0 : info.streak ?? 0;
  const days = daysWord(streakValue);
  const streakLabel = isEndless ? (info.endlessRecord ? 'Рекорд серии' : 'Серия') : isDaily ? `${days.charAt(0).toUpperCase()}${days.slice(1)} подряд` : 'Серия';
  const metrics = h(
    'div',
    { class: 'g-metrics' },
    metric('timer', formatTime(info.elapsedMs), timeLabel),
    metric('target', key.value, key.label || 'Точность'),
    metric('flame', streakValue, streakLabel, 'flame'),
  );

  // Тихие строки под метриками: лучшее время, прочие строки режима.
  const notes = [];
  if (info.prevBestMs > 0 && delta >= 0) notes.push(`Лучшее ${formatTime(info.prevBestMs)}`);
  for (const l of info.statsLines?.slice(1) || []) notes.push(tr(l));
  if (missing.length) notes.push(`Ещё звезда: ${missing.join(', ')}`);

  const chapter = info.chapterDone
    ? h('div', { class: 'g-badge' }, icon('check'), h('span', { text: info.chapterLabel || t('chapterDone', { n: info.chapterDone }) }))
    : null;

  // --- Кнопки: чёрная «Следующий уровень →», обводка «К карте» -------------------------------
  const repeatLabel = stars < 3 && kind === 'campaign' ? t('repeatForStar') : t('repeat');
  const titleEl = h('h1', { class: 'g-res-title w-title', id: 'g-res-title', tabindex: '-1', text: title });
  const card = h(
    'div',
    { class: 'g-res-body' },
    h('div', { class: 'g-res-top' }, info.onBack ? iconButton('back', t('back'), info.onBack) : h('span', { class: 'w-header-spacer' }), info.onRepeat ? iconButton('reset', repeatLabel, info.onRepeat) : null),
    eyebrow ? h('p', { class: 'g-res-eyebrow w-eyebrow', text: eyebrow }) : null,
    titleEl,
    h('div', { class: 'g-res-hero' }, h('div', { class: 'g-res-glow', 'aria-hidden': 'true' }), art('sage-loop', 'g-res-art'), starsEl),
    quoteEl,
    chapter,
    metrics,
    notes.length ? h('p', { class: 'g-res-notes', text: notes.join(' · ') }) : null,
    vocabList(info.vocab),
  );
  const actions = h(
    'div',
    { class: 'g-res-actions' },
    button(info.nextLabel || 'Следующий уровень', { variant: 'primary', arrow: true, block: true, onClick: info.onNext }),
    info.onMap ? button(info.mapLabel || 'К карте', { variant: 'secondary', block: true, onClick: info.onMap }) : null,
  );
  const root = h(
    'div',
    {
      class: `win-overlay g-result${info.reducedMotion ? ' still' : ''}`,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'g-res-title',
    },
    starDefs(),
    h('div', { class: 'g-res-scroll' }, card, actions),
  );
  return root;
}

/** Слова уровня с переводами (§2.5): вторичный список под метриками. */
function vocabList(vocab) {
  if (!Array.isArray(vocab) || vocab.length === 0) return null;
  return h(
    'section',
    { class: 'g-vocab', 'aria-label': t('vocabTitle') },
    h('h2', { class: 'w-eyebrow', text: t('vocabTitle') }),
    vocab.map((v) =>
      h(
        'div',
        { class: 'g-vocab-row' },
        h('b', { lang: 'en', text: String(v.w).toLowerCase() }),
        h('span', { text: v.ru }),
        v.c ? h('small', { lang: 'en', text: v.c }) : null,
      ),
    ),
  );
}

/** Экран после последнего уровня: «Кампания пройдена» с кнопками «Бесконечность» и «Ежедневная». */
export function mountCampaignDone(app, { modeId }) {
  const mode = app.modeById[modeId];
  // Режим только для кампании (§2.5): в Бесконечности и Ежедневной его нет — туда не зовём.
  const only = !!mode.campaignOnly;
  const toMap = () => app.go(modeId === 'words' ? 'wordPacks' : 'levels', { modeId });
  const el = h(
    'section',
    { class: `screen w-screen g-done${app.reducedMotion() ? ' still' : ''}` },
    h(
      'header',
      { class: 'w-header center' },
      iconButton('back', t('back'), () => app.go('home')),
      h('h1', { class: 'w-title-sm', text: tr(mode.name) }),
      h('span', { class: 'w-header-spacer' }),
    ),
    h(
      'div',
      { class: 'w-scroll under-header g-done-body' },
      h('div', { class: 'g-done-hero', 'aria-hidden': 'true' }, h('div', { class: 'g-res-glow' }), art('sage-loop', 'g-done-art'), art('lavender-orb', 'g-done-orb')),
      h('p', { class: 'w-eyebrow', text: `${tr(mode.name)} · все уровни` }),
      h('h2', { class: 'w-title', text: t('campaignDone') }),
      h('p', { class: 'w-body', text: t(only ? 'campaignDoneOnly' : 'campaignDoneText', { mode: tr(mode.name) }) }),
      h(
        'div',
        { class: 'g-done-actions' },
        only
          ? button(modeId === 'words' ? 'К темам' : 'К карте', { variant: 'primary', arrow: true, block: true, onClick: toMap })
          : [
              button(t('endless'), { variant: 'primary', arrow: true, block: true, onClick: () => app.startEndless(app.rotationModes.length > 1 ? 'mix' : app.rotationModes[0].id, 0) }),
              // Решённая сегодня ежедневная не переигрывается — ведём на вкладку («Решена ✓», §5.8).
              button(t('daily'), { variant: 'secondary', block: true, onClick: () => (isDailyDone(app.state.daily, app.today()) ? app.go('daily') : app.startDaily()) }),
            ],
        button('На главную', { variant: 'ghost', block: true, onClick: () => app.go('home') }),
      ),
    ),
  );
  return { el, destroy() {} };
}
