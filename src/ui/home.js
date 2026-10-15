// Главный экран (§3.1 п.1) по Lumin «Home»: знак и название, карточка «Продолжить» для прерванной
// партии, ежедневная задача, строка достижений, режимы, Бесконечность. Одна основная (чернильная)
// кнопка на экран: «Продолжить», а без прерванной партии — «Играть» в ежедневной.
import { h, icon, modeIcon } from './dom.js';
import { t, tr, daysWord } from '../core/i18n.js';
import { doneCount, nextLevelIndex } from '../core/progress.js';
import { pickDaily, isDailyDone, displayStreak, calendar } from '../core/daily.js';
import { MIX } from '../core/endless.js';
import { findLevel } from '../core/levels.js';

export function mountHome(app) {
  const { state } = app;
  const today = app.today();
  const content = h('div', { class: 'content home' });

  // Знак и название.
  content.appendChild(
    h(
      'div',
      { class: 'hero' },
      // Сборка без иконок (артефакт, --no-icons): битую картинку убираем, остаётся заголовок.
      h('img', { class: 'hero-icon', src: './icon-180.png', alt: '', width: '60', height: '60', 'aria-hidden': 'true', onError: (e) => e.currentTarget.remove() }),
      h('div', { class: 'hero-text' }, h('h1', { text: t('appTitle') }), h('p', { text: t('heroSub') })),
    ),
  );

  // Карточка установки (вкладка Safari, не приложение на экране «Домой» и не App Store).
  if (!app.isStandalone && !state.settings.installCardClosed) {
    const card = h(
      'div',
      { class: 'card install-card' },
      h('h3', { text: t('installTitle') }),
      h('div', { class: 'pict' }, icon('share'), h('span', { text: '→' }), icon('plus'), h('span', { text: t('installText') })),
      h(
        'button',
        {
          class: 'icon-btn close',
          'aria-label': t('close'),
          onClick: () => {
            state.settings.installCardClosed = true;
            app.save();
            card.remove();
          },
        },
        icon('close'),
      ),
    );
    content.appendChild(card);
  }

  // Прерванная партия — первой (Lumin: «interrupted puzzle», основное действие экрана).
  const cur = state.current;
  const curMode = cur ? app.modeById[cur.mode] : null;
  const curFound = curMode ? findLevel(app.levels, cur.mode, cur.levelId) : null;
  // Ежедневная прошлого дня не продолжается: её победа засчиталась бы задним числом (§3.2).
  const hasContinue = !!curFound && !(cur.kind === 'daily' && cur.date !== today);
  if (hasContinue) {
    const campaign = app.modeSets(curMode.id).campaign;
    const where =
      cur.kind === 'daily'
        ? t('daily')
        : cur.kind === 'endless'
          ? `${t('endless')} · ${t('streak', { n: cur.endless?.streak || 0 })}`
          : typeof curMode.titleFor === 'function'
            ? tr(curMode.titleFor(curFound.level, curFound.index, campaign))
            : t('level', { n: curFound.index + 1 });
    content.appendChild(
      h(
        'div',
        { class: 'card continue-card', style: { '--mode-color': app.theme.accentOf(curMode) } },
        h('div', { class: 'eyebrow', text: t('continue') }),
        h(
          'div',
          { class: 'row' },
          h('div', { class: 'mode-icon' }, modeIcon(curMode)),
          h('div', { class: 'grow' }, h('h3', { text: tr(curMode.name) }), h('div', { class: 'muted', text: where })),
        ),
        h('button', {
          class: 'btn primary big',
          text: t('continue'),
          onClick: () => {
            app.audio.tap();
            app.go('game', { kind: cur.kind, modeId: cur.mode, levelId: cur.levelId, endless: cur.endless, date: cur.date });
          },
        }),
      ),
    );
  }

  // Ежедневная (лавандовая подложка — Lumin «daily content»).
  const dailyPick = pickDaily(today, app.rotationModes.map((m) => m.id), app.dailyPoolSize());
  const dailyMode = app.modeById[dailyPick.mode];
  const dailyLevel = dailyMode ? app.modeSets(dailyMode.id).daily[dailyPick.index] : null;
  const streak = displayStreak(state.daily, today);
  const dailyDone = isDailyDone(state.daily, today);
  const cal = h('div', { class: 'calendar', 'aria-hidden': 'true' });
  for (const day of calendar(state.daily, today, 28)) {
    cal.appendChild(h('span', { class: `${day.done ? 'done' : ''} ${day.today ? 'today' : ''}`.trim(), title: day.date }));
  }
  content.appendChild(
    h(
      'div',
      { class: 'card daily-card', style: { '--mode-color': app.theme.accentOf(dailyMode) } },
      h('div', { class: 'eyebrow', text: t('daily') }),
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
          class: `btn ${hasContinue || dailyDone ? 'tonal' : 'primary'}`,
          text: t('play'),
          disabled: !dailyLevel,
          onClick: () => {
            app.audio.tap();
            app.go('game', { kind: 'daily', modeId: dailyMode.id, levelId: dailyLevel.id, date: today });
          },
        }),
      ),
      cal,
    ),
  );

  // Достижения: серия, пройдено, звёзды (Lumin: «compact personal momentum»).
  let solved = 0;
  let stars = 0;
  for (const m of app.modes) {
    const progress = state.progress[m.id] || {};
    const campaign = app.modeSets(m.id).campaign;
    solved += doneCount(campaign, progress);
    for (const l of campaign) if (progress[l.id]?.star) stars++; // только уровни этой сборки
  }
  const stat = (value, label) => h('div', { class: 'stat' }, h('strong', { text: String(value) }), h('small', { text: label }));
  content.appendChild(h('div', { class: 'stat-row' }, stat(streak, t('statStreak')), stat(solved, t('statSolved')), stat(stars, t('statStars'))));

  // Режимы.
  content.appendChild(h('div', { class: 'section-title', text: t('modesTitle') }));
  for (const mode of app.modes) {
    const sets = app.modeSets(mode.id);
    const campaign = sets.campaign;
    const progress = state.progress[mode.id] || {};
    const skipped = state.skipped[mode.id] || [];
    const done = doneCount(campaign, progress);
    const total = campaign.length;
    // «Продолжить» — только если уровень из current существует в этой сборке (§2.0: замена
    // уровня = новый id; код прогресса с чужого билда); иначе — следующий непройденный.
    const resume = !!cur && cur.kind === 'campaign' && cur.mode === mode.id && !!findLevel(app.levels, mode.id, cur.levelId);
    const next = nextLevelIndex(campaign, progress, skipped, { byChapter: !!mode.openByChapter });
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
        { class: 'card mode-card', style: { '--mode-color': color } },
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
          h('button', { class: 'btn tonal', text: resume ? t('continue') : t('play'), onClick: play, disabled: total === 0 }),
        ),
        h('div', { class: 'progress-bar' }, h('div', { style: { width: `${total ? (100 * done) / total : 0}%` } })),
      ),
    );
  }

  // Бесконечность.
  content.appendChild(h('div', { class: 'section-title', text: t('endless') }));
  const resumeEndless =
    state.current && state.current.kind === 'endless' && findLevel(app.levels, state.current.mode, state.current.levelId)
      ? state.current
      : null;
  const rot = app.rotationModes;
  let choice = resumeEndless?.endless?.modeChoice || (rot.length === 1 ? rot[0].id : MIX);
  const choices = rot.length > 1 ? [...rot.map((m) => m.id), MIX] : [rot[0].id];
  const bestLine = h('div', { class: 'muted' });
  const seg = h('div', { class: 'seg' });
  const renderSeg = () => {
    seg.replaceChildren(
      ...choices.map((id) =>
        h('button', {
          class: id === choice ? 'on' : '',
          'aria-pressed': String(id === choice),
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
      { class: 'card endless-card' },
      h(
        'div',
        { class: 'row' },
        h('div', { class: 'mode-icon' }, icon('infinity')),
        h('div', { class: 'grow' }, h('h3', { text: t('endless') }), bestLine, resumeEndless ? h('div', { class: 'muted', text: t('streak', { n: resumeEndless.endless?.streak || 0 }) }) : null),
        h('button', {
          class: 'btn tonal',
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
    { class: 'screen home-screen lumin' },
    h(
      'div',
      { class: 'topbar' },
      h('span', { class: 'spacer' }),
      h('span', { class: 'title' }),
      h('button', { class: 'icon-btn round', 'aria-label': t('settings'), onClick: () => app.go('settings') }, icon('gear')),
    ),
    content,
  );

  return { el, destroy() {} };
}
