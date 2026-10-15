// Главная (docs/DESIGN.md §5.2, эталон WORDS «Home»): приветствие с именем, серия и профиль в шапке;
// карточка «Ежедневная» с мини-сеткой 5×5; тёмная карточка «Продолжить путь» (прерванная партия или
// следующий уровень); две плитки «Слова» и «Испытания»; карточка установки PWA во вкладке Safari;
// нижняя навигация. Одна чёрная зона на экран — карточка «Продолжить путь».
import { h, icon } from './dom.js';
import { screen, arrowCircle, art, progress, pill, formatDate, greeting } from './kit.js';
import { t, tr, daysWord } from '../core/i18n.js';
import { doneCount, nextLevelIndex } from '../core/progress.js';
import { pickDaily, isDailyDone, displayStreak } from '../core/daily.js';
import { findLevel } from '../core/levels.js';
import { hash32, mulberry32 } from '../core/rng.js';

const COPY = {
  profile: 'Профиль',
  daily: 'Ежедневная',
  dailySolved: (n) => (n > 0 ? `Решена · серия ${n} ${daysWord(n)}` : 'Решена'),
  journey: ['Продолжить', 'путь'],
  journeyStart: ['Начать', 'путь'],
  journeyDone: ['Все уровни', 'пройдены'],
  journeyDoneSub: 'Загляни в «Режимы» или «Испытания»',
  dailyKind: 'Ежедневная',
  endlessKind: (n) => `Бесконечность · серия ${n}`,
  level: (n) => `Уровень ${n}`,
  passed: (done, total) => `Пройдено ${done} из ${total}`,
  words: 'Слова',
  wordsSub: 'Английские цитаты по темам',
  challenges: 'Испытания',
  challengesSub: 'Бесконечность и рекорды',
  streak: (n) => `Серия: ${n} ${daysWord(n)}`,
  open: 'Открыть',
};

/**
 * pickJourney({ current, today, modes, levelsOf, find, progress, skipped }) → цель карточки
 * «Продолжить путь» (docs/DESIGN.md §5.2). Чистая функция:
 *  1. прерванная партия current, если её уровень есть в сборке и это не ежедневная прошлого дня
 *     (её победа засчиталась бы задним числом, §3.2) → { type: 'resume', modeId, levelId, index, kind };
 *  2. иначе режим с наибольшим числом пройденных уровней (при равенстве — по порядку реестра),
 *     где ещё есть непройденный → { type: 'next', modeId, levelId, index };
 *  3. иначе первый по порядку режим с непройденным уровнем (новичок — «Маршрут · Уровень 1»)
 *     → { type: 'start', … };
 *  4. всё пройдено или уровней нет → null.
 * levelsOf(modeId) → кампания режима; find(modeId, levelId) → { level, kind, index } | null.
 */
export function pickJourney({ current = null, today = '', modes = [], levelsOf, find, progress = {}, skipped = {}, lastMode = '' }) {
  if (current && typeof find === 'function') {
    const found = find(current.mode, current.levelId);
    const staleDaily = current.kind === 'daily' && current.date !== today;
    if (found && !staleDaily) {
      return { type: 'resume', modeId: current.mode, levelId: current.levelId, index: found.index, kind: current.kind || 'campaign' };
    }
  }
  const rows = modes
    .map((mode, order) => {
      const campaign = levelsOf(mode.id) || [];
      const prog = progress[mode.id] || {};
      const next = campaign.length ? nextLevelIndex(campaign, prog, skipped[mode.id] || [], { byChapter: !!mode.openByChapter }) : -1;
      return { mode, order, campaign, done: doneCount(campaign, prog), next };
    })
    .filter((r) => r.campaign.length > 0 && r.next >= 0);
  // Последний сыгранный режим (settings.lastMode) — первым; затем режим с наибольшим прогрессом.
  const last = rows.find((r) => r.mode.id === lastMode);
  if (last) return { type: last.done > 0 ? 'next' : 'start', modeId: last.mode.id, levelId: last.campaign[last.next].id, index: last.next };
  const played = rows.filter((r) => r.done > 0).sort((a, b) => b.done - a.done || a.order - b.order);
  if (played.length) {
    const r = played[0];
    return { type: 'next', modeId: r.mode.id, levelId: r.campaign[r.next].id, index: r.next };
  }
  if (rows.length) {
    const r = rows[0];
    return { type: 'start', modeId: r.mode.id, levelId: r.campaign[r.next].id, index: r.next };
  }
  return null;
}

/** Силуэты мини-превью ежедневной (5×5, построчно; 1 — клетка есть): «крест» как в эталоне WORDS. */
const DAILY_SHAPES = [
  '00110' + '01111' + '11111' + '11111' + '00110',
  '01100' + '11110' + '11111' + '01111' + '00110',
  '00100' + '01111' + '11111' + '11110' + '01100',
  '00110' + '11110' + '11111' + '01111' + '01100',
];

/**
 * dailyPattern(dateStr) → 25 клеток мини-превью ежедневной (5×5, построчно): 0 — пусто, 1 — белая,
 * 2 — чёрная. Узор зависит только от даты: силуэт из DAILY_SHAPES и четыре чёрные клетки; первая
 * клетка силуэта всегда белая (на ней мелкий номер «1», как в эталоне).
 */
export function dailyPattern(dateStr) {
  const rng = mulberry32(hash32('daily-grid', String(dateStr)));
  const shape = DAILY_SHAPES[rng.int(DAILY_SHAPES.length)];
  const cells = Array.from(shape, (ch) => (ch === '1' ? 1 : 0));
  const first = cells.indexOf(1);
  const free = cells.map((v, i) => (v === 1 && i !== first ? i : -1)).filter((i) => i >= 0);
  rng.shuffle(free);
  for (const i of free.slice(0, 4)) cells[i] = 2;
  return cells;
}

export function mountHome(app) {
  const { state } = app;
  const today = app.today();
  const settings = state.settings;
  const streak = displayStreak(state.daily, today);
  const tap = () => app.audio?.tap?.();

  // --- Шапка: приветствие, серия, профиль. ---
  const name = (settings.name || '').trim();
  const hello = greeting();
  const greet = name
    ? h('h1', { class: 'hm-greet' }, h('span', { class: 'hm-hello', text: `${hello},` }), h('span', { class: 'hm-name', text: name }))
    : h('h1', { class: 'hm-greet solo' }, h('span', { class: 'hm-name', text: hello }));
  const avatar = h(
    'button',
    {
      class: 'hm-avatar',
      type: 'button',
      'aria-label': name ? `${COPY.profile}: ${name}` : COPY.profile,
      onClick: () => {
        tap();
        app.go('profile');
      },
    },
    name ? h('span', { 'aria-hidden': 'true', text: Array.from(name)[0].toUpperCase() }) : icon('user'),
  );
  const head = h(
    'header',
    { class: 'hm-head' },
    greet,
    h('div', { class: 'hm-head-right' }, streak > 0 ? pill('flame', streak, 'flame', COPY.streak(streak)) : null, avatar),
  );

  // --- Ежедневная: дата, мини-сетка, стрелка (решена — галочка). ---
  const dailyPick = app.rotationModes.length ? pickDaily(today, app.rotationModes.map((m) => m.id), app.dailyPoolSize()) : null;
  const dailyMode = dailyPick ? app.modeById[dailyPick.mode] : null;
  const dailyDone = isDailyDone(state.daily, today);
  const dateText = formatDate(today);
  const mini = h(
    'span',
    { class: 'hm-mini', 'aria-hidden': 'true' },
    dailyPattern(today).map((v, i, all) => h('i', { class: v === 2 ? 'ink' : v === 1 ? 'paper' : '', text: i === all.indexOf(1) ? '1' : null })),
  );
  const dailyCard = h(
    'button',
    {
      class: `w-card hm-daily${dailyDone ? ' done' : ''}`,
      type: 'button',
      'aria-label': [COPY.daily, dateText, dailyMode ? tr(dailyMode.name) : '', dailyDone ? COPY.dailySolved(streak) : COPY.open].filter(Boolean).join('. '),
      onClick: () => {
        tap();
        app.go('daily');
      },
    },
    h(
      'span',
      { class: 'hm-daily-text' },
      h('span', { class: 'hm-card-title', text: COPY.daily }),
      h('span', { class: 'hm-card-sub', text: dateText }),
      dailyDone ? h('span', { class: 'hm-daily-done', text: COPY.dailySolved(streak) }) : null,
    ),
    mini,
    dailyDone ? h('span', { class: 'w-arrow hm-check', 'aria-hidden': 'true' }, icon('check')) : arrowCircle(),
  );

  // --- Продолжить путь: прерванная партия или следующий уровень. ---
  const journey = pickJourney({
    current: state.current,
    today,
    modes: app.modes,
    levelsOf: (id) => app.modeSets(id).campaign,
    find: (modeId, levelId) => (app.modeById[modeId] ? findLevel(app.levels, modeId, levelId) : null),
    progress: state.progress,
    skipped: state.skipped,
    lastMode: state.settings.lastMode,
  });
  const journeyCard = buildJourneyCard(app, journey, tap);

  // --- Плитки «Слова» и «Испытания». ---
  const tile = (cls, title, sub, artName, target) =>
    h(
      'button',
      {
        class: `w-card ${cls} hm-tile`,
        type: 'button',
        'aria-label': `${title}. ${sub}`,
        onClick: () => {
          tap();
          app.go(target);
        },
      },
      h('span', { class: 'hm-tile-title', text: title }),
      h('span', { class: 'hm-tile-sub', text: sub }),
      // Сцена под текстом: 3D-объект масштабируется по её высоте и не наезжает на подписи.
      h('span', { class: 'hm-tile-stage', 'aria-hidden': 'true' }, art(artName, `hm-tile-art ${artName}`)),
    );
  const tiles = h(
    'div',
    { class: 'hm-tiles' },
    tile('sage', COPY.words, COPY.wordsSub, 'sage-loop', 'wordPacks'),
    tile('lav', COPY.challenges, COPY.challengesSub, 'lavender-orb', 'challenges'),
  );

  // --- Установка PWA: только вкладка Safari (не standalone, не App Store), закрывается крестиком. ---
  let install = null;
  if (!app.isStandalone && !settings.installCardClosed) {
    install = h(
      'div',
      { class: 'w-card hm-install', role: 'note' },
      h('span', { class: 'hm-install-icon', 'aria-hidden': 'true' }, icon('share')),
      h('span', { class: 'hm-install-text' }, h('b', { text: t('installTitle') }), h('span', { text: t('installText') })),
      h(
        'button',
        {
          class: 'w-icon-btn hm-install-close',
          type: 'button',
          'aria-label': t('close'),
          onClick: () => {
            settings.installCardClosed = true;
            app.save();
            install.remove();
          },
        },
        icon('close'),
      ),
    );
  }

  const { el } = screen({ className: 'hm', tabbar: true, app, active: 'home' }, head, dailyCard, journeyCard, tiles, install);
  return { el, destroy() {} };
}

/** Тёмная карточка «Продолжить путь» (glass-steps справа, светлая полоса прогресса режима). */
function buildJourneyCard(app, journey, tap) {
  const { state } = app;
  if (!journey) {
    return h(
      'button',
      {
        class: 'w-card dark hm-journey',
        type: 'button',
        onClick: () => {
          tap();
          app.go('packs');
        },
      },
      art('glass-steps', 'hm-journey-art'),
      h('span', { class: 'hm-journey-title' }, h('span', { text: COPY.journeyDone[0] }), h('span', { text: COPY.journeyDone[1] })),
      h('span', { class: 'hm-journey-meta' }, h('span', { text: COPY.journeyDoneSub })),
    );
  }

  const mode = app.modeById[journey.modeId];
  const campaign = app.modeSets(mode.id).campaign;
  const done = doneCount(campaign, state.progress[mode.id] || {});
  const total = campaign.length;
  const cur = state.current;
  let where;
  if (journey.type === 'resume' && journey.kind === 'daily') where = COPY.dailyKind;
  else if (journey.type === 'resume' && journey.kind === 'endless') where = COPY.endlessKind(cur?.endless?.streak || 0);
  else {
    const found = findLevel(app.levels, mode.id, journey.levelId);
    where =
      found && found.kind === 'campaign' && typeof mode.titleFor === 'function'
        ? tr(mode.titleFor(found.level, found.index, campaign))
        : COPY.level((found ? found.index : journey.index) + 1);
  }
  const title = journey.type === 'start' && done === 0 ? COPY.journeyStart : COPY.journey;

  const go = () => {
    tap();
    if (journey.type === 'resume') {
      app.go('game', { kind: cur.kind, modeId: cur.mode, levelId: cur.levelId, endless: cur.endless, date: cur.date });
    } else {
      app.go('game', { kind: 'campaign', modeId: mode.id, levelId: journey.levelId });
    }
  };

  return h(
    'button',
    {
      class: 'w-card dark hm-journey',
      type: 'button',
      'aria-label': `${title.join(' ')}. ${tr(mode.name)}, ${where}. ${total ? COPY.passed(done, total) : ''}`.trim(),
      onClick: go,
    },
    art('glass-steps', 'hm-journey-art'),
    h('span', { class: 'hm-journey-title' }, h('span', { text: title[0] }), h('span', { text: title[1] })),
    h('span', { class: 'hm-journey-meta' }, h('span', { text: tr(mode.name) }), h('span', { text: where })),
    total ? progress(done / total, COPY.passed(done, total)) : null,
  );
}
