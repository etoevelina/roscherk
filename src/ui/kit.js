// WORDS — общий набор компонентов экранов (docs/DESIGN.md, стили src/styles/05-kit.css).
// Все экраны оболочки строятся из этих кусков, чтобы шапки, кнопки, карточки и навигация
// выглядели одинаково. Только DOM, без состояния; обработчики передаются снаружи.
import { h, icon } from './dom.js';

/** Вкладки нижней навигации (docs/DESIGN.md «Навигация»): экран роутера → подпись и иконка. */
export const TABS = [
  { id: 'home', label: 'Главная', icon: 'home' },
  { id: 'packs', label: 'Режимы', icon: 'packs' },
  { id: 'daily', label: 'Ежедневная', icon: 'calendar' },
  { id: 'stats', label: 'Статистика', icon: 'bars' },
];

/**
 * screen({ className, tabbar, app, active, header }, ...content) → { el, scroll }.
 * Корень экрана .w-screen; контент — в прокручиваемом .w-scroll; tabbar — нижняя навигация.
 */
export function screen({ className = '', tabbar = false, app = null, active = null, header = null } = {}, ...content) {
  const scroll = h('div', { class: `w-scroll${header ? ' under-header' : ''}` }, ...content);
  const el = h(
    'section',
    { class: `screen w-screen enter${tabbar ? ' has-tabbar' : ''}${className ? ` ${className}` : ''}` },
    header,
    scroll,
    tabbar && app ? tabBar(app, active) : null,
  );
  return { el, scroll };
}

/** Нижняя навигация: 4 вкладки, активная — aria-current="page". */
export function tabBar(app, active) {
  return h(
    'nav',
    { class: 'w-tabbar', 'aria-label': 'Разделы' },
    TABS.map((tab) =>
      h(
        'button',
        {
          class: 'w-tab',
          type: 'button',
          'aria-current': tab.id === active ? 'page' : null,
          onClick: () => {
            if (tab.id === active) return;
            app.audio?.tap?.();
            app.go(tab.id);
          },
        },
        icon(tab.icon),
        h('span', { text: tab.label }),
      ),
    ),
  );
}

/**
 * header({ title, onBack, right, center }) → шапка с круглой «назад» 44×44 (aria-label «Назад»).
 * right — узел или массив узлов справа; без onBack слева пусто.
 */
export function header({ title = '', onBack = null, right = null, center = true, backLabel = 'Назад' } = {}) {
  const rightNodes = right == null ? [] : Array.isArray(right) ? right.filter(Boolean) : [right];
  return h(
    'header',
    { class: `w-header${center ? ' center' : ''}` },
    onBack ? iconButton('back', backLabel, onBack) : h('span', { class: 'w-header-spacer' }),
    h('h1', { class: 'w-title-sm', text: title }),
    rightNodes.length ? h('div', { class: 'w-header-right' }, rightNodes) : h('span', { class: 'w-header-spacer' }),
  );
}

/** Круглая кнопка-иконка 44×44; filled — белая с обводкой. */
export function iconButton(name, label, onClick, { filled = false } = {}) {
  return h('button', { class: `w-icon-btn${filled ? ' filled' : ''}`, type: 'button', 'aria-label': label, onClick }, icon(name));
}

/**
 * button(label, { variant, arrow, icon, onClick, block }) → кнопка ≥ 48px.
 * variant: 'primary' (чёрная пилюля), 'secondary' (обводка), 'tonal' (шалфей), 'ghost', 'danger'.
 * arrow — стрелка справа (главное действие «Начать →»).
 */
export function button(label, { variant = 'primary', arrow = false, iconName = null, onClick = null, block = false, disabled = false } = {}) {
  return h(
    'button',
    { class: `w-btn ${variant}${arrow ? ' split' : ''}${block ? ' block' : ''}`, type: 'button', onClick, disabled },
    iconName ? icon(iconName) : null,
    h('span', { text: label }),
    arrow ? icon('arrow') : null,
  );
}

/** Круглая стрелка карточки; dark — чёрный круг. */
export function arrowCircle({ dark = false } = {}) {
  return h('span', { class: `w-arrow${dark ? ' dark' : ''}`, 'aria-hidden': 'true' }, icon('arrow'));
}

/**
 * art(name, className) → <img> 3D-графики из dist/art/<name>.webp (декоративная, alt="").
 * name: 'pearl-ribbon' | 'sage-loop' | 'lavender-orb' | 'glass-steps' | 'rose-folds' | 'map-backdrop'.
 * Нет файла (офлайн без кэша, тесты) — картинка убирает себя, вёрстка не ломается.
 */
export function art(name, className = '') {
  const img = h('img', {
    class: `w-art${className ? ` ${className}` : ''}`,
    src: `art/${name}.webp`,
    alt: '',
    'aria-hidden': 'true',
    decoding: 'async',
    draggable: 'false',
  });
  img.addEventListener('error', () => img.remove(), { once: true });
  return img;
}

/** Полоса прогресса 0..1 (role=progressbar). */
export function progress(frac, label = '') {
  const pct = Math.round(Math.max(0, Math.min(1, Number(frac) || 0)) * 100);
  return h(
    'div',
    { class: 'w-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': label || null },
    h('i', { style: { width: `${pct}%` } }),
  );
}

/**
 * chips(items, active, onChange) → ряд фильтров. items: [{ id, label }]; активный — aria-pressed.
 * Возвращает элемент с методом set(id) для смены активного без перерисовки.
 */
export function chips(items, active, onChange) {
  const buttons = items.map((it) =>
    h('button', {
      class: 'w-chip',
      type: 'button',
      'aria-pressed': it.id === active ? 'true' : 'false',
      text: it.label,
      onClick: () => {
        set(it.id);
        onChange(it.id);
      },
    }),
  );
  const el = h('div', { class: 'w-chips', role: 'group' }, buttons);
  function set(id) {
    items.forEach((it, i) => buttons[i].setAttribute('aria-pressed', it.id === id ? 'true' : 'false'));
  }
  el.set = set;
  return el;
}

/** seg(items, active, onChange, label) → сегментный переключатель (как chips, но на всю ширину). */
export function seg(items, active, onChange, label = '') {
  const buttons = items.map((it) =>
    h('button', {
      type: 'button',
      'aria-pressed': it.id === active ? 'true' : 'false',
      text: it.label,
      onClick: () => {
        buttons.forEach((b, i) => b.setAttribute('aria-pressed', items[i].id === it.id ? 'true' : 'false'));
        onChange(it.id);
      },
    }),
  );
  return h('div', { class: 'w-seg', role: 'group', 'aria-label': label || null }, buttons);
}

/** statCard(value, label, iconName) → карточка-метрика. */
export function statCard(value, label, iconName = null) {
  return h(
    'div',
    { class: 'w-stat' },
    iconName ? h('span', { class: 'w-stat-icon' }, icon(iconName)) : null,
    h('b', { text: String(value) }),
    h('span', { text: label }),
  );
}

/** starsRow(n, max) → звёзды 1–3 (aria-label «2 звезды из 3»). */
export function starsRow(n, max = 3) {
  const words = ['звёзд', 'звезда', 'звезды', 'звезды'];
  return h(
    'span',
    { class: 'w-stars', role: 'img', 'aria-label': `${n} ${words[n] || 'звёзд'} из ${max}` },
    Array.from({ length: max }, (_, i) => h('span', { class: i < n ? 'on' : 'off' }, icon('star'))),
  );
}

/**
 * row({ iconName, label, sub, value, chevron, onClick, control, danger }) → строка списка настроек.
 * control — правый элемент (переключатель); без onClick строка — div.
 */
export function row({ iconName = null, label, sub = '', value = '', chevron = false, onClick = null, control = null, danger = false } = {}) {
  return h(
    onClick && !control ? 'button' : 'div',
    { class: `w-row${danger ? ' danger' : ''}`, type: onClick && !control ? 'button' : null, onClick: control ? null : onClick },
    iconName ? h('span', { class: 'w-row-icon' }, icon(iconName)) : null,
    h('span', { class: 'w-row-label' }, label, sub ? h('small', { text: sub }) : null),
    value ? h('span', { class: 'w-row-value', text: value }) : null,
    control,
    chevron ? h('span', { class: 'w-row-chev' }, icon('chevron')) : null,
  );
}

/** switchControl(on, onChange, label) → переключатель role=switch. */
export function switchControl(on, onChange, label) {
  const el = h('button', { class: 'w-switch', type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label });
  el.addEventListener('click', () => {
    const next = el.getAttribute('aria-checked') !== 'true';
    el.setAttribute('aria-checked', next ? 'true' : 'false');
    onChange(next);
  });
  return el;
}

/** pill(iconName, text, tone) → пилюля-счётчик в шапке (серия 🔥, звёзды ★). */
export function pill(iconName, text, tone = '', label = '') {
  return h('span', { class: 'w-pill', role: label ? 'img' : null, 'aria-label': label || null }, h('span', { class: tone }, icon(iconName)), h('span', { text: String(text) }));
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** formatDate('2026-10-15') → «15 октября 2026». */
export function formatDate(dateStr, { year = true } = {}) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return String(dateStr);
  return `${d} ${MONTHS_GEN[m - 1]}${year ? ` ${y}` : ''}`;
}

/** greeting(hour) → «Доброе утро» / «Добрый день» / «Добрый вечер» / «Доброй ночи». */
export function greeting(hour = new Date().getHours()) {
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 18) return 'Добрый день';
  if (hour >= 18 && hour < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}
