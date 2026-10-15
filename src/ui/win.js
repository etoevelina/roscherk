// Оверлей победы (§3.1 п.4) и экран «Кампания пройдена».
import { h, icon } from './dom.js';
import { t, tr, formatTime } from '../core/i18n.js';

/**
 * buildWinOverlay(app, info) → элемент оверлея поверх поля (поле видно).
 * info = { mode, star, elapsedMs, prevBestMs, statsLines, chapterDone, flowPerfect,
 *          endlessStreak, endlessRecord, dailyWon, nextLabel, onNext, onRepeat }.
 */
export function buildWinOverlay(app, info) {
  if (info.skin === 'lumin') return buildLuminWin(app, info);
  const lines = [];
  lines.push(h('div', { class: 'line strong', text: t('time', { t: formatTime(info.elapsedMs) }) }));
  if (info.prevBestMs > 0) {
    const delta = info.elapsedMs - info.prevBestMs;
    const sign = delta < 0 ? '−' : '+';
    const d = `${sign}${Math.round(Math.abs(delta) / 1000)} с`;
    if (delta < 0) lines.push(h('div', { class: 'line', text: `${t('newBest')} · ${t('bestDelta', { t: formatTime(info.prevBestMs), d })}` }));
    else lines.push(h('div', { class: 'line', text: t('bestDelta', { t: formatTime(info.prevBestMs), d }) }));
  } else if (info.kind === 'campaign') {
    lines.push(h('div', { class: 'line', text: t('newBest') }));
  }
  for (const l of info.statsLines || []) lines.push(h('div', { class: l.strong ? 'line strong' : 'line', text: tr(l) }));
  if (info.perfect && info.mode.id === 'flow') lines.push(h('div', { class: 'line strong', text: t('perfect') }));
  if (info.endlessStreak != null) {
    lines.push(h('div', { class: 'line strong', text: t('endlessStreak', { n: info.endlessStreak }) }));
    if (info.endlessRecord) lines.push(h('div', { class: 'line', text: t('endlessRecord') }));
  }
  if (info.dailyWon) lines.push(h('div', { class: 'line', text: t('dailyWon') }));

  const badge = h('div', { class: `badge ${info.star ? 'star' : 'check'}` }, icon(info.star ? 'star' : 'check'));

  const card = h(
    'div',
    { class: 'win-card', style: { '--mode-color': app.theme.accentOf(info.mode) } },
    badge,
    h('h2', { text: t('done') }),
    ...lines,
    info.chapterDone ? h('div', { class: 'chapter-done', text: info.chapterLabel || t('chapterDone', { n: info.chapterDone }) }) : null,
    vocabList(info.vocab),
    h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn primary big', text: info.nextLabel || t('next'), onClick: info.onNext })),
    h(
      'div',
      { class: 'btn-row' },
      h('button', { class: 'btn', text: info.star || info.kind !== 'campaign' ? t('repeat') : t('repeatForStar'), onClick: info.onRepeat }),
    ),
  );

  if (info.vocab && info.vocab.length) card.classList.add('tall');
  return h('div', { class: 'win-overlay' }, card);
}

/**
 * Победа по Lumin «Level complete» (§2.5): полный экран, галочка в шалфейном круге с одним
 * восходящим движением, цитата по центру, автор и перевод, статистика, слова уровня, «Дальше».
 */
function buildLuminWin(app, info) {
  const q = info.quote || {};
  const stat = (value, label) => h('div', { class: 'lw-stat' }, h('strong', { text: value }), h('small', { text: label }));
  const delta = info.prevBestMs > 0 ? info.elapsedMs - info.prevBestMs : 0;
  const card = h(
    'div',
    { class: 'lw-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'lw-title' },
    h('div', { class: `lw-check${info.star ? ' star' : ''}`, 'aria-hidden': 'true' }, icon(info.star ? 'star' : 'check')),
    h('div', { class: 'lw-eyebrow', text: t('winEyebrow') }),
    h('h2', { class: 'lw-title', id: 'lw-title', tabindex: '-1', text: t('winTitle') }),
    q.text ? h('blockquote', { class: 'lw-quote', lang: 'en', text: `“${q.text}”` }) : null,
    q.author ? h('div', { class: 'lw-author', text: `— ${q.author}${q.src && q.src !== 'Proverb' && q.src !== q.author ? `, ${q.src}` : ''}` }) : null,
    q.ru ? h('p', { class: 'lw-ru', text: q.ru }) : null,
    h(
      'div',
      { class: 'lw-stats' },
      stat(formatTime(info.elapsedMs), delta < 0 ? `${t('statTime')} · ${t('newBest')}` : t('statTime')),
      stat(String(info.hints ?? 0), t('statHints')),
      stat(`${info.accuracy ?? 100}%`, t('statAccuracy')),
    ),
    info.chapterDone ? h('div', { class: 'lw-chapter', text: info.chapterLabel || t('chapterDone', { n: info.chapterDone }) }) : null,
    vocabList(info.vocab),
    // Кнопки прилипают к низу: «Дальше» видна, даже когда список слов длинный.
    h(
      'div',
      { class: 'lw-actions' },
      h('button', { class: 'btn primary big lw-next', type: 'button', text: info.nextLabel || t('next'), onClick: info.onNext }),
      h('button', { class: 'btn lw-repeat', type: 'button', text: info.star || info.kind !== 'campaign' ? t('repeat') : t('repeatForStar'), onClick: info.onRepeat }),
    ),
  );
  return h('div', { class: 'win-overlay lumin-win' }, card);
}

/** Слова уровня с переводами (§2.5): прокручиваемый список в карточке победы. */
function vocabList(vocab) {
  if (!Array.isArray(vocab) || vocab.length === 0) return null;
  return h(
    'div',
    { class: 'vocab' },
    h('div', { class: 'vocab-title', text: t('vocabTitle') }),
    vocab.map((v) =>
      h(
        'div',
        { class: 'vocab-row' },
        h('b', { lang: 'en', text: v.w.toLowerCase() }),
        h('span', { text: v.ru }),
        v.c ? h('small', { lang: 'en', text: v.c }) : null,
      ),
    ),
  );
}

/** Экран после 100-го уровня: «Кампания пройдена» с кнопками «Бесконечность» и «Ежедневная». */
export function mountCampaignDone(app, { modeId }) {
  const mode = app.modeById[modeId];
  // Режим только для кампании (§2.5): в Бесконечности и Ежедневной его нет — туда не зовём.
  const only = !!mode.campaignOnly;
  const el = h(
    'div',
    { class: 'screen lumin', style: { '--mode-color': app.theme.accentOf(mode) } },
    h(
      'div',
      { class: 'topbar' },
      h('button', { class: 'icon-btn round', 'aria-label': t('back'), onClick: () => app.go('home') }, icon('back')),
      h('span', { class: 'title', text: tr(mode.name) }),
      h('span', { class: 'spacer' }),
    ),
    h(
      'div',
      { class: 'campaign-done' },
      h('div', { class: 'cd-badge', 'aria-hidden': 'true' }, icon('star')),
      h('h2', { text: t('campaignDone') }),
      h('p', { class: 'muted', style: { color: 'var(--text-muted)' }, text: t(only ? 'campaignDoneOnly' : 'campaignDoneText', { mode: tr(mode.name) }) }),
      only
        ? h('div', { class: 'btn-row', style: { marginTop: '24px' } }, h('button', { class: 'btn primary', text: t('levelsList'), onClick: () => app.go('levels', { modeId }) }))
        : h(
            'div',
            { class: 'btn-row', style: { marginTop: '24px' } },
            h('button', { class: 'btn primary', text: t('endless'), onClick: () => app.startEndless(app.rotationModes.length > 1 ? 'mix' : app.rotationModes[0].id, 0) }),
            h('button', { class: 'btn primary', text: t('daily'), onClick: () => app.startDaily() }),
          ),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', text: t('home'), onClick: () => app.go('home') })),
    ),
  );
  return { el, destroy() {} };
}
