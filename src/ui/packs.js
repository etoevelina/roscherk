// «Режимы» (вкладка) и «Темы „Слов“» — docs/DESIGN.md §5.3–5.4, эталон «Word Packs».
// Крупный заголовок, ряд чипов-фильтров, широкие материальные карточки: семейство цвета
// (шалфей, голубой, румяный, лаванда, туман), 3D-объект справа обрезан краем, название, тихая
// подпись «100 уровней · пройдено 12», тонкий прогресс; у первой (или текущей) — чёрная стрелка.
// Стили — src/styles/30-packs-map.css (префикс pk-).
import { h } from './dom.js';
import { screen, header, chips, progress, art, arrowCircle } from './kit.js';
import { tr } from '../core/i18n.js';
import { doneCount, isDone, nextLevelIndex } from '../core/progress.js';

const COPY = {
  modesTitle: 'Режимы',
  wordsTitle: 'Слова',
  filtersLabel: 'Фильтр режимов',
  groupsLabel: 'Группы тем',
  soon: 'Скоро',
  emptyFilter: 'Здесь пока пусто',
  allDone: 'всё пройдено',
};

/** Фильтры вкладки «Режимы»: Линии — Маршрут, Потоки, Один штрих; Слова; Физика — Карандаш. */
export const MODE_FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'lines', label: 'Линии' },
  { id: 'words', label: 'Слова' },
  { id: 'physics', label: 'Физика' },
];
const FILTER_OF_MODE = { zip: 'lines', flow: 'lines', stroke: 'lines', words: 'words', draw: 'physics' };

/** Фильтр режима; новый режим без записи — по признакам контракта (DOM — слова, мир — физика). */
export function modeFilter(mode) {
  if (!mode) return 'lines';
  return FILTER_OF_MODE[mode.id] || (mode.dom ? 'words' : mode.worldRect || mode.continuous ? 'physics' : 'lines');
}

/** Семейство карточки и 3D-объект режима (docs/DESIGN.md §3, §5.3). */
export const MODE_LOOK = {
  zip: { family: 'sage', art: 'sage-loop' },
  flow: { family: 'blue', art: 'pearl-ribbon' },
  stroke: { family: 'blush', art: 'rose-folds' },
  words: { family: 'lav', art: 'lavender-orb' },
  draw: { family: 'mist', art: 'glass-steps' },
};
export function modeLook(modeId) {
  return MODE_LOOK[modeId] || { family: 'mist', art: 'glass-steps' };
}

/** Темы «Слов»: семейства и 3D по кругу — шалфей, голубой, румяный, лаванда (§5.4). */
const THEME_LOOKS = [
  { family: 'sage', art: 'sage-loop' },
  { family: 'blue', art: 'pearl-ribbon' },
  { family: 'blush', art: 'rose-folds' },
  { family: 'lav', art: 'lavender-orb' },
];
export function themeLook(order) {
  const i = Number.isInteger(order) && order >= 0 ? order : 0;
  return THEME_LOOKS[i % THEME_LOOKS.length];
}

/**
 * Группы тем для чипов (§5.4: «Все» + 3–4 группы). В words.json групп нет — раскладка по slug темы
 * здесь; поле level.group (id или подпись группы), если появится в данных, важнее.
 */
export const WORD_GROUPS = [
  { id: 'world', label: 'Мир', slugs: ['home', 'food', 'travel', 'nature', 'weather'] },
  { id: 'people', label: 'Люди', slugs: ['emotions', 'character', 'love', 'work', 'money'] },
  { id: 'mind', label: 'Наука', slugs: ['science', 'tech', 'health', 'mind'] },
  { id: 'culture', label: 'Культура', slugs: ['art', 'books', 'law', 'society', 'history', 'language'] },
];

/** groupOfLevel(level) → id группы или null (тема видна только во «Все»). */
export function groupOfLevel(level) {
  if (!level) return null;
  if (typeof level.group === 'string' && level.group) {
    const g = WORD_GROUPS.find((x) => x.id === level.group || x.label === level.group);
    if (g) return g.id;
  }
  const g = WORD_GROUPS.find((x) => x.slugs.includes(level.slug));
  return g ? g.id : null;
}

/** packIdOf(level) → идентификатор темы для app.go('levels', { modeId:'words', pack }): slug или номер главы. */
export function packIdOf(level) {
  return level && typeof level.slug === 'string' && level.slug ? level.slug : String(level?.chapter ?? '');
}

/**
 * wordThemes(campaign, progress, chapterTitle) → темы по порядку следования:
 * [{ pack, chapter, order, theme: {ru,en}, group, total, done, first, last }] (first/last — сквозные индексы).
 */
export function wordThemes(campaign, progress = {}, chapterTitle = null) {
  const out = [];
  campaign.forEach((level, index) => {
    let th = out[out.length - 1];
    if (!th || th.chapter !== level.chapter) {
      const theme = typeof chapterTitle === 'function' ? chapterTitle(level.chapter, level) : level.theme || { ru: `Тема ${level.chapter}`, en: '' };
      th = { pack: packIdOf(level), chapter: level.chapter, order: out.length, theme, group: groupOfLevel(level), total: 0, done: 0, first: index, last: index };
      out.push(th);
    }
    th.total++;
    th.last = index;
    if (isDone(progress, level.id)) th.done++;
  });
  return out;
}

/** Чипы групп: «Все» + группы, в которых есть темы; меньше двух групп — только «Все». */
export function groupChips(themes) {
  const present = WORD_GROUPS.filter((g) => themes.some((t) => t.group === g.id));
  return [{ id: 'all', label: 'Все' }, ...(present.length >= 2 ? present.map((g) => ({ id: g.id, label: g.label })) : [])];
}

/** plural(5, ['уровень','уровня','уровней']) → 'уровней'. */
export function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
const LEVEL_FORMS = ['уровень', 'уровня', 'уровней'];
const QUOTE_FORMS = ['цитата', 'цитаты', 'цитат'];

/** countLine(total, done, forms) → «100 уровней · пройдено 12» / «… · всё пройдено». */
export function countLine(total, done, forms = LEVEL_FORMS) {
  if (!total) return COPY.soon;
  return `${total} ${plural(total, forms)} · ${done >= total ? COPY.allDone : `пройдено ${done}`}`;
}

/**
 * Широкая карточка: семейство, 3D справа, название, подпись, тонкий прогресс; arrow — чёрная стрелка.
 */
function packCard({ title, meta, done, total, look, arrow = false, label, onClick, lang = null }) {
  return h(
    'button',
    { class: `pk-card ${look.family}`, type: 'button', 'aria-label': label, onClick },
    art(look.art, `pk-art pk-art-${look.art}`),
    h(
      'span',
      { class: 'pk-body' },
      h('span', { class: 'pk-title', lang, text: title }),
      h('span', { class: 'pk-meta', text: meta }),
      total ? progress(done / total) : null,
    ),
    arrow ? arrowCircle({ dark: true }) : null,
  );
}

// Последний выбранный фильтр — на время сессии (возврат с карты уровней на ту же вкладку).
let lastModeFilter = 'all';
let lastGroup = 'all';

/** Вкладка «Режимы»: params.filter ∈ all | lines | words | physics. */
export function mountPacks(app, params = {}) {
  const valid = (id) => MODE_FILTERS.some((f) => f.id === id);
  let filter = valid(params.filter) ? params.filter : valid(lastModeFilter) ? lastModeFilter : 'all';
  lastModeFilter = filter;

  const cards = app.modes.map((mode) => {
    const campaign = app.modeSets(mode.id).campaign;
    const progressMap = app.state.progress[mode.id] || {};
    const total = campaign.length;
    const done = doneCount(campaign, progressMap);
    const meta = countLine(total, done, mode.id === 'words' ? QUOTE_FORMS : LEVEL_FORMS);
    const name = tr(mode.name);
    const tagline = mode.tagline ? tr(mode.tagline) : '';
    return {
      mode,
      filter: modeFilter(mode),
      make: (arrow) =>
        packCard({
          title: name,
          meta,
          done,
          total,
          look: modeLook(mode.id),
          arrow,
          label: `${name}${tagline ? `. ${tagline}` : ''}. ${meta}`,
          onClick: () => {
            app.audio?.tap?.();
            if (mode.id === 'words') app.go('wordPacks');
            else app.go('levels', { modeId: mode.id });
          },
        }),
    };
  });

  const list = h('div', { class: 'pk-list' });
  const render = () => {
    const shown = cards.filter((c) => filter === 'all' || c.filter === filter);
    list.replaceChildren(...(shown.length ? shown.map((c, i) => c.make(i === 0)) : [h('p', { class: 'pk-empty w-body', text: COPY.emptyFilter })]));
  };
  render();

  const filterRow = chips(MODE_FILTERS, filter, (id) => {
    filter = id;
    lastModeFilter = id;
    render();
  });
  filterRow.setAttribute('aria-label', COPY.filtersLabel);
  filterRow.classList.add('pk-chips');

  const { el } = screen(
    { className: 'pk-screen', tabbar: true, app, active: 'packs' },
    h('h1', { class: 'w-title pk-heading', text: COPY.modesTitle }),
    filterRow,
    list,
  );
  return { el, destroy() {} };
}

/** «Темы „Слов“»: шапка «‹ Слова», чипы групп, карточки тем → карта темы. */
export function mountWordPacks(app, params = {}) {
  const mode = app.modeById.words;
  const campaign = mode ? app.modeSets(mode.id).campaign : [];
  const progressMap = (mode && app.state.progress[mode.id]) || {};
  const skipped = (mode && app.state.skipped[mode.id]) || [];
  const themes = wordThemes(campaign, progressMap, mode?.chapterTitle?.bind(mode));
  const groups = groupChips(themes);
  const validGroup = (id) => groups.some((g) => g.id === id);
  let group = validGroup(params.group) ? params.group : validGroup(lastGroup) ? lastGroup : 'all';
  lastGroup = group;

  // Стрелка — у темы, где ждёт следующая цитата (окно открытых — по темам, §2.5).
  const next = mode ? nextLevelIndex(campaign, progressMap, skipped, { byChapter: !!mode.openByChapter }) : -1;
  const currentPack = next >= 0 ? packIdOf(campaign[next]) : null;

  const list = h('div', { class: 'pk-list' });
  const render = () => {
    const shown = themes.filter((th) => group === 'all' || th.group === group);
    list.replaceChildren(
      ...(shown.length
        ? shown.map((th) => {
            const title = tr(th.theme);
            const meta = countLine(th.total, th.done, QUOTE_FORMS);
            return packCard({
              title,
              meta,
              done: th.done,
              total: th.total,
              look: themeLook(th.order),
              arrow: th.pack === currentPack,
              label: `${title}${th.theme.en ? ` (${th.theme.en})` : ''}. ${meta}`,
              onClick: () => {
                app.audio?.tap?.();
                app.go('levels', { modeId: 'words', pack: th.pack });
              },
            });
          })
        : [h('p', { class: 'pk-empty w-body', text: themes.length ? COPY.emptyFilter : COPY.soon })]),
    );
  };
  render();

  const groupRow = chips(groups, group, (id) => {
    group = id;
    lastGroup = id;
    render();
  });
  groupRow.setAttribute('aria-label', COPY.groupsLabel);
  groupRow.classList.add('pk-chips');

  const { el } = screen(
    {
      className: 'pk-screen pk-words',
      header: header({ title: mode ? tr(mode.name) : COPY.wordsTitle, onBack: () => app.go('packs'), center: false }),
    },
    groupRow,
    list,
  );
  return { el, destroy() {} };
}
