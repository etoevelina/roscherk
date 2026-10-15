// Главный экран (§3.1 п.1): карточки режимов, Ежедневная, Бесконечность, карточка установки.
import { h, icon, modeIcon } from './dom.js';
import { t, tr, daysWord } from '../core/i18n.js';
import { doneCount, nextLevelIndex } from '../core/progress.js';
import { pickDaily, isDailyDone, displayStreak, calendar } from '../core/daily.js';
import { MIX } from '../core/endless.js';
import { findLevel } from '../core/levels.js';

export function mountHome(app) {
  const { state } = app;
  const today = app.today();

  const content = h('div', { class: 'content' });

  // Заголовок.
  content.appendChild(h('div', { class: 'hero' }, h('h1', { text: t('appTitle') }), h('p', { text: 'Головоломки одной линией' })));

  // Карточка установки (не standalone).
  if (!app.isStandalone && !state.settings.installCardClosed) {
    const card = h(
      'div',
      { class: 'card install-card' },
      h('h3', { text: t('installTitle') }),
      h('div', { class: 'pict' }, icon('share'), h('span', { text: '→' }), icon('plus'), h('span', { text: t('installText') })),
      h('button', {
        class: 'icon-btn close',
        'aria-label': t('close'),
        onClick: () => {
          state.settings.installCardClosed = true;
          app.save();
          card.remove();
        },
      }, icon('close')),
    );
    content.appendChild(card);
  }

  // Режимы.
  for (const mode of app.modes) {
    const sets = app.modeSets(mode.id);
    const campaign = sets.campaign;
    const progress = state.progress[mode.id] || {};
    const skipped = state.skipped[mode.id] || [];
    const done = doneCount(campaign, progress);
    const total = campaign.length;
    // «Продолжить» — только если уровень из current существует в этой сборке (§2.0: замена
    // уровня = новый id; код прогресса с чужого билда); иначе — следующий непройденный.
    const cur = state.current;
    const resume = !!cur && cur.kind === 'campaign' && cur.mode === mode.id && !!findLevel(app.levels, mode.id, cur.levelId);
    const next = nextLevelIndex(campaign, progress, skipped);
    const color = app.theme.accentOf(mode);

    const play = () => {
      app.audio.tap();
      if (resume) {
        app.go('game', { kind: 'campaign', modeId: mode.id, levelId: state.current.levelId });
      } else if (next >= 0) {
        app.go('game', { kind: 'campaign', modeId: mode.id, levelId: campaign[next].id });
      } else {
        app.go('levels', { modeId: mode.id });
      }
    };

    content.appendChild(
      h(
        'div',
        { class: 'card', style: { '--mode-color': color } },
        h(
          'div',
          { class: 'row' },
          h('div', { class: 'mode-icon' }, modeIcon(mode)),
          h(
            'div',
            { class: 'grow', onClick: () => app.go('levels', { modeId: mode.id }) },
            h('h3', { text: tr(mode.name) }),
            h('div', { class: 'muted', text: total ? t('passed', { done, total }) : t('noLevels') }),
          ),
          h('button', { class: 'btn primary', text: resume ? t('continue') : t('play'), onClick: play, disabled: total === 0 }),
        ),
        h('div', { class: 'progress-bar' }, h('div', { style: { width: `${total ? (100 * done) / total : 0}%` } })),
      ),
    );
  }

  // Ежедневная.
  content.appendChild(h('div', { class: 'section-title', text: t('daily') }));
  const dailyPick = pickDaily(today, app.modes.map((m) => m.id), app.dailyPoolSize());
  const dailyMode = app.modeById[dailyPick.mode];
  const dailyLevel = dailyMode ? app.modeSets(dailyMode.id).daily[dailyPick.index] : null;
  const streak = displayStreak(state.daily, today);
  const dailyDone = isDailyDone(state.daily, today);
  const cal = h('div', { class: 'calendar' });
  for (const day of calendar(state.daily, today, 28)) {
    cal.appendChild(h('span', { class: `${day.done ? 'done' : ''} ${day.today ? 'today' : ''}`.trim(), title: day.date }));
  }
  content.appendChild(
    h(
      'div',
      { class: 'card', style: { '--mode-color': app.theme.accentOf(dailyMode) } },
      h(
        'div',
        { class: 'row' },
        h('div', { class: 'mode-icon' }, icon('calendar')),
        h(
          'div',
          { class: 'grow' },
          h('h3', { text: t('dailyLevel', { mode: dailyMode ? tr(dailyMode.name) : '—' }) }),
          h('div', { class: 'muted', text: dailyDone ? t('dailyDone') : t('streakDays', { n: streak, days: daysWord(streak) }) }),
        ),
        h('button', {
          class: 'btn primary',
          text: t('play'),
          disabled: !dailyLevel,
          onClick: () => {
            app.audio.tap();
            app.go('game', { kind: 'daily', modeId: dailyMode.id, levelId: dailyLevel.id, date: today });
          },
        }),
      ),
      dailyDone ? h('div', { class: 'muted', style: { marginTop: '6px' }, text: t('streakDays', { n: streak, days: daysWord(streak) }) }) : null,
      cal,
    ),
  );

  // Бесконечность.
  content.appendChild(h('div', { class: 'section-title', text: t('endless') }));
  const resumeEndless =
    state.current && state.current.kind === 'endless' && findLevel(app.levels, state.current.mode, state.current.levelId)
      ? state.current
      : null;
  let choice = resumeEndless?.endless?.modeChoice || (app.modes.length === 1 ? app.modes[0].id : MIX);
  const choices = app.modes.length > 1 ? [...app.modes.map((m) => m.id), MIX] : [app.modes[0].id];
  const bestLine = h('div', { class: 'muted' });
  const seg = h('div', { class: 'seg' });
  const renderSeg = () => {
    seg.replaceChildren(
      ...choices.map((id) =>
        h('button', {
          class: id === choice ? 'on' : '',
          text: id === MIX ? t('mix') : tr(app.modeById[id].name),
          onClick: () => {
            choice = id;
            renderSeg();
          },
        }),
      ),
    );
    bestLine.textContent = t('bestStreak', { n: state.endless.best[choice] || 0 });
  };
  renderSeg();
  content.appendChild(
    h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'row' },
        h('div', { class: 'mode-icon' }, icon('infinity')),
        h('div', { class: 'grow' }, h('h3', { text: t('endless') }), bestLine, resumeEndless ? h('div', { class: 'muted', text: t('streak', { n: resumeEndless.endless?.streak || 0 }) }) : null),
        h('button', {
          class: 'btn primary',
          text: resumeEndless && resumeEndless.endless?.modeChoice === choice ? t('continue') : t('play'),
          onClick: () => {
            app.audio.tap();
            if (resumeEndless && resumeEndless.endless?.modeChoice === choice) {
              app.go('game', { kind: 'endless', modeId: resumeEndless.mode, levelId: resumeEndless.levelId, endless: resumeEndless.endless });
            } else {
              app.startEndless(choice, 0);
            }
          },
        }),
      ),
      h('div', { class: 'muted', style: { marginTop: '8px' }, text: t('endlessHint') }),
      seg,
    ),
  );

  const el = h(
    'div',
    { class: 'screen home-screen' },
    h(
      'div',
      { class: 'topbar' },
      h('span', { class: 'spacer' }),
      h('span', { class: 'title' }),
      h('button', { class: 'icon-btn', 'aria-label': t('settings'), onClick: () => app.go('settings') }, icon('gear')),
    ),
    content,
  );

  return { el, destroy() {} };
}
