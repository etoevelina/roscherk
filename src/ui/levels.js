// Выбор уровня (§3.1 п.2): плитки по главам, галочка/звезда/лучшее время, окно из 3 открытых,
// остальные — замок. Список — отдельный контейнер со скроллом.
import { h, icon } from './dom.js';
import { t, tr, formatTime } from '../core/i18n.js';
import { levelStatuses } from '../core/progress.js';

export function mountLevels(app, { modeId }) {
  const mode = app.modeById[modeId];
  if (mode && mode.skin === 'lumin') return mountLuminLevels(app, mode);
  const campaign = app.modeSets(modeId).campaign;
  const progress = app.state.progress[modeId] || {};
  const skipped = app.state.skipped[modeId] || [];
  // «Слова» (§2.5): окно открытых уровней считается в каждой теме отдельно.
  const statuses = levelStatuses(campaign, progress, skipped, { byChapter: !!mode.openByChapter });
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
    const title = typeof mode.chapterTitle === 'function' ? `${ch.chapter}. ${tr(mode.chapterTitle(ch.chapter, ch.items[0]))}` : t('chapter', { n: ch.chapter });
    content.appendChild(h('div', { class: 'chapter' }, h('h4', { text: title }), tiles));
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

const ART = ['sage', 'lavender', 'mist', 'sage-lav', 'lav-mist'];

/**
 * Список тем по Lumin «Word packs» + «Level map» (§2.5): карточка темы — абстрактная форма,
 * название, «5 уровней · пройдено 2» и дорожка узлов: пройден — чернильный с галочкой, текущий —
 * лавандовое кольцо, закрыт — приглушён. Окно открытых уровней — по темам (openByChapter).
 */
function mountLuminLevels(app, mode) {
  const campaign = app.modeSets(mode.id).campaign;
  const progress = app.state.progress[mode.id] || {};
  const skipped = app.state.skipped[mode.id] || [];
  const statuses = levelStatuses(campaign, progress, skipped, { byChapter: !!mode.openByChapter });
  const content = h('div', { class: 'content lumin-packs' });
  if (campaign.length === 0) content.appendChild(h('div', { class: 'empty-state', text: t('noLevels') }));
  const chapters = [];
  campaign.forEach((level, index) => {
    let ch = chapters[chapters.length - 1];
    if (!ch || ch.chapter !== level.chapter) {
      ch = { chapter: level.chapter, items: [] };
      chapters.push(ch);
    }
    ch.items.push({ level, s: statuses[index] });
  });
  for (const ch of chapters) {
    const theme = mode.chapterTitle(ch.chapter, ch.items[0].level);
    const done = ch.items.filter((x) => x.s.status === 'done').length;
    const current = ch.items.find((x) => x.s.status === 'open' && !x.s.skipped) || ch.items.find((x) => x.s.status === 'open');
    const nodes = ch.items.map((x) => {
      const cls = `lp-node ${x.s.status}${x === current ? ' current' : ''}${x.s.star ? ' star' : ''}`;
      const n = ch.items.indexOf(x) + 1;
      const label = `${tr(theme)}, ${t('level', { n })}${x.s.status === 'locked' ? `, ${t('locked')}` : x.s.status === 'done' ? `, ${t('check')}` : ''}`;
      const btn = h(
        'button',
        {
          class: cls,
          type: 'button',
          'aria-label': label,
          disabled: x.s.status === 'locked',
          onClick: () => {
            app.audio.tap();
            app.go('game', { kind: 'campaign', modeId: mode.id, levelId: x.level.id });
          },
        },
        x.s.status === 'done' ? icon(x.s.star ? 'star' : 'check') : x.s.status === 'locked' ? icon('lock') : h('span', { text: String(n) }),
      );
      return btn;
    });
    content.appendChild(
      h(
        'article',
        { class: 'lp-card' },
        h('div', { class: `lp-art ${ART[(ch.chapter - 1) % ART.length]}`, 'aria-hidden': 'true' }, h('span')),
        h(
          'div',
          { class: 'lp-body' },
          h('div', { class: 'lp-eyebrow', lang: 'en', text: theme.en || '' }),
          h('h3', { class: 'lp-title', text: tr(theme) }),
          h('div', { class: 'lp-meta', text: t('levelsCount', { n: ch.items.length, done }) }),
          h('div', { class: 'lp-path' }, nodes),
        ),
      ),
    );
  }
  const el = h(
    'div',
    { class: 'screen levels-screen lumin' },
    h(
      'div',
      { class: 'topbar' },
      h('button', { class: 'icon-btn round', 'aria-label': t('back'), onClick: () => app.go('home') }, icon('back')),
      h('span', { class: 'title', text: tr(mode.name) }),
      h('span', { class: 'spacer' }),
    ),
    content,
  );
  return { el, destroy() {} };
}
