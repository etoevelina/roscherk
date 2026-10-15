// Выбор уровня (§3.1 п.2): плитки по главам, галочка/звезда/лучшее время, окно из 3 открытых,
// остальные — замок. Список — отдельный контейнер со скроллом.
import { h, icon } from './dom.js';
import { t, tr, formatTime } from '../core/i18n.js';
import { levelStatuses } from '../core/progress.js';

export function mountLevels(app, { modeId }) {
  const mode = app.modeById[modeId];
  const campaign = app.modeSets(modeId).campaign;
  const progress = app.state.progress[modeId] || {};
  const skipped = app.state.skipped[modeId] || [];
  const statuses = levelStatuses(campaign, progress, skipped);
  const color = app.theme.accentOf(mode);

  const content = h('div', { class: 'content', style: { '--mode-color': color } });
  if (campaign.length === 0) content.appendChild(h('div', { class: 'empty-state', text: t('noLevels') }));

  // Группировка по главам в порядке следования.
  const chapters = [];
  for (const level of campaign) {
    let ch = chapters[chapters.length - 1];
    if (!ch || ch.chapter !== level.chapter) {
      ch = { chapter: level.chapter, items: [] };
      chapters.push(ch);
    }
    ch.items.push(level);
  }

  for (const ch of chapters) {
    const tiles = h('div', { class: 'tiles' });
    for (const level of ch.items) {
      const s = statuses[campaign.indexOf(level)];
      const tile = h('button', {
        class: `tile ${s.status} ${s.skipped ? 'skipped' : ''}`,
        'aria-label': `${t('level', { n: s.index + 1 })}${s.status === 'locked' ? `, ${t('locked')}` : ''}`,
        disabled: s.status === 'locked',
        onClick: () => {
          app.audio.tap();
          app.go('game', { kind: 'campaign', modeId, levelId: level.id });
        },
      });
      if (s.status === 'locked') tile.appendChild(icon('lock'));
      else {
        tile.appendChild(h('span', { text: String(s.index + 1) }));
        if (s.status === 'done') {
          tile.appendChild(h('span', { class: 'mark' }, icon(s.star ? 'star' : 'check')));
          if (s.bestMs) tile.appendChild(h('span', { class: 'time', text: formatTime(s.bestMs) }));
        }
      }
      tiles.appendChild(tile);
    }
    content.appendChild(h('div', { class: 'chapter' }, h('h4', { text: t('chapter', { n: ch.chapter }) }), tiles));
  }

  const el = h(
    'div',
    { class: 'screen levels-screen' },
    h(
      'div',
      { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': t('back'), onClick: () => app.go('home') }, icon('back')),
      h('span', { class: 'title', text: t('levelsTitle', { mode: tr(mode.name) }) }),
      h('span', { class: 'spacer' }),
    ),
    content,
  );
  return { el, destroy() {} };
}
