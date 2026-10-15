// Оверлей победы (§3.1 п.4) и экран «Кампания пройдена».
import { h, icon } from './dom.js';
import { t, tr, formatTime } from '../core/i18n.js';

/**
 * buildWinOverlay(app, info) → элемент оверлея поверх поля (поле видно).
 * info = { mode, star, elapsedMs, prevBestMs, statsLines, chapterDone, flowPerfect,
 *          endlessStreak, endlessRecord, dailyWon, nextLabel, onNext, onRepeat }.
 */
export function buildWinOverlay(app, info) {
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
  for (const l of info.statsLines || []) lines.push(h('div', { class: 'line', text: tr(l) }));
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
    h('h2', { text: t('done') }),
    badge,
    ...lines,
    info.chapterDone ? h('div', { class: 'chapter-done', text: t('chapterDone', { n: info.chapterDone }) }) : null,
    h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn primary big', text: info.nextLabel || t('next'), onClick: info.onNext })),
    h(
      'div',
      { class: 'btn-row' },
      h('button', { class: 'btn', text: info.star || info.kind !== 'campaign' ? t('repeat') : t('repeatForStar'), onClick: info.onRepeat }),
    ),
  );

  return h('div', { class: 'win-overlay' }, card);
}

/** Экран после 100-го уровня: «Кампания пройдена» с кнопками «Бесконечность» и «Ежедневная». */
export function mountCampaignDone(app, { modeId }) {
  const mode = app.modeById[modeId];
  const el = h(
    'div',
    { class: 'screen', style: { '--mode-color': app.theme.accentOf(mode) } },
    h(
      'div',
      { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': t('back'), onClick: () => app.go('home') }, icon('back')),
      h('span', { class: 'title', text: tr(mode.name) }),
      h('span', { class: 'spacer' }),
    ),
    h(
      'div',
      { class: 'campaign-done' },
      h('div', { class: 'badge star', style: { color: 'var(--hint)', fontSize: '48px' } }, icon('star')),
      h('h2', { text: t('campaignDone') }),
      h('p', { class: 'muted', style: { color: 'var(--text-muted)' }, text: t('campaignDoneText', { mode: tr(mode.name) }) }),
      h(
        'div',
        { class: 'btn-row', style: { marginTop: '24px' } },
        h('button', { class: 'btn primary', text: t('endless'), onClick: () => app.startEndless(app.modes.length > 1 ? 'mix' : modeId, 0) }),
        h('button', { class: 'btn primary', text: t('daily'), onClick: () => app.startDaily() }),
      ),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', text: t('home'), onClick: () => app.go('home') })),
    ),
  );
  return { el, destroy() {} };
}
