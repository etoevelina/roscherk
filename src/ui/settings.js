// Профиль (docs/DESIGN.md §5.10, роутер: 'profile' и 'settings'): аватар с инициалом, имя, серия
// и звёзды, настройки списком. Всё, что умел прежний экран настроек (SPEC §3.1 п.5), сохранено:
// тема (системная/светлая/тёмная), звук с пометкой про беззвучный режим, номера в «Потоках», код
// прогресса (скопировать/вставить с подтверждением), сброс прогресса с подтверждением, версия
// сборки. Новое: имя (диалог, ≤ 24 символа), «Специальные возможности», политика конфиденциальности.
// Шторки и диалог имени — свои (класс pf-*, src/styles/50-profile.css), живут внутри экрана и
// исчезают вместе с ним; подтверждения и ввод кода — общие app.overlays, как раньше.
import { h, icon } from './dom.js';
import { screen, header, iconButton, row, switchControl, button } from './kit.js';
import { t } from '../core/i18n.js';
import { exportCode, importCode, defaultState, NAME_MAX } from '../core/storage.js';
import { levelStars } from '../core/progress.js';
import { displayStreak } from '../core/daily.js';

export const PRIVACY_URL = 'https://etoevelina.github.io/roscherk/privacy.html';

/** Тексты экрана (русский интерфейс; i18n.js не трогаем — общие строки берём из t()). */
export const COPY = {
  title: 'Профиль',
  tagline: 'Любознательный ум. Исследователь линий.',
  noName: 'Добавить имя',
  editName: 'Изменить имя',
  nameTitle: 'Как тебя зовут?',
  nameNote: 'Имя видно только тебе — в приветствии и профиле.',
  namePlaceholder: 'Имя',
  save: 'Сохранить',
  cancel: 'Отмена',
  close: 'Закрыть',
  theme: 'Тема',
  sound: 'Звук',
  soundNote: 'Молчит в беззвучном режиме',
  flowNumbers: 'Номера в «Потоках»',
  flowNumbersNote: 'Номер на обеих точках пары',
  a11y: 'Специальные возможности',
  transfer: 'Перенос прогресса',
  transferNote: 'Код хранит весь прогресс, серии и настройки. Скопируй его здесь и вставь на другом устройстве.',
  copyCode: 'Скопировать код',
  copyDetail: 'Сохранить прогресс как текст',
  pasteCode: 'Вставить код',
  pasteDetail: 'Восстановить прогресс с другого устройства',
  about: 'О приложении',
  aboutText: 'Маленькие головоломки одной линией, английские слова и физика. Работает офлайн, без рекламы и покупок.',
  version: 'Версия сборки',
  privacy: 'Политика конфиденциальности',
  reset: 'Сбросить прогресс',
  build: 'сборка',
};

export const THEMES = [
  { id: 'system', label: 'Системная', detail: 'Как в настройках iPhone' },
  { id: 'light', label: 'Светлая', detail: '' },
  { id: 'dark', label: 'Тёмная', detail: '' },
];

// Иконки, которых нет в dom.js: тема (авто/солнце/луна), внешняя ссылка, галочка выбора.
const SVG = {
  auto: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  paste: '<path d="M9 4h6v3H9z"/><path d="M15 5.5h2a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2h2"/><path d="M12 10.5v6M9.5 14l2.5 2.5 2.5-2.5"/>',
};

/** svgIcon(markup) → <svg> 24×24 со штрихом currentColor (как icon() из dom.js). */
export function svgIcon(markup) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = markup;
  return svg;
}

// --- Чистые помощники (tests/ui.profile.test.mjs) -----------------------------------------

/** plural(n, ['день', 'дня', 'дней']) → форма по правилам русского языка. */
export function plural(n, [one, few, many]) {
  const a = Math.abs(Math.trunc(Number(n) || 0));
  const d = a % 10;
  const dd = a % 100;
  if (d === 1 && dd !== 11) return one;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
  return many;
}

export const streakLabel = (n) => `${plural(n, ['день', 'дня', 'дней'])} серии`;
export const starsLabel = (n) => plural(n, ['звезда', 'звезды', 'звёзд']);

/** Число с неразрывным пробелом между разрядами: 1240 → «1 240». */
export function formatNumber(n) {
  return String(Math.max(0, Math.trunc(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// Графемы (то, что человек видит одним символом): флаг 🇷🇺 и семья 👨‍👩‍👧‍👦 — по одной.
// Без Intl.Segmenter (старый WebKit) — запасной вариант по кодовым точкам.
const SEGMENTER = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const graphemes = (s) => (SEGMENTER ? Array.from(SEGMENTER.segment(s), (g) => g.segment) : Array.from(s));

/** Сколько символов видит человек: эмодзи и флаг считаются за один. */
export const nameLength = (s) => graphemes(String(s ?? '')).length;

/**
 * fitName(s) → начало строки целыми графемами, не длиннее NAME_MAX кодовых единиц UTF-16:
 * storage.normalize режет имя как slice(0, NAME_MAX), поэтому так оно переживает перезагрузку
 * без изменений, а эмодзи никогда не обрывается посередине (ни суррогат, ни ZWJ-цепочка).
 */
export function fitName(s) {
  let out = '';
  for (const g of graphemes(String(s ?? ''))) {
    if (out.length + g.length > NAME_MAX) break;
    out += g;
  }
  return out;
}

/** initialOf('евелина') → 'Е'; пустое имя → '' (тогда в аватаре иконка user). Первая графема целиком. */
export function initialOf(name) {
  const first = graphemes(String(name || '').trim())[0] || '';
  return first.toUpperCase();
}

/** cleanName(raw) → имя как его хранит storage.normalize: пробелы схлопнуты, ≤ 24 единиц, эмодзи целые. */
export function cleanName(raw) {
  let s = fitName(String(raw ?? '').replace(/\s+/g, ' ').trim());
  s = s.replace(/[\uD800-\uDBFF]$/, '').replace(/\u200D+$/, ''); // остатки уже обрезанных имён
  return s.trim();
}

/** Сумма звёзд (1–3 за уровень) по всем режимам — только уровни кампаний этой сборки. */
export function totalStars(app) {
  let sum = 0;
  for (const m of app.modes) {
    const rec = app.state.progress?.[m.id] || {};
    for (const lv of app.modeSets(m.id).campaign) sum += levelStars(rec[lv.id]);
  }
  return sum;
}

export const themeLabel = (id) => (THEMES.find((x) => x.id === id) || THEMES[0]).label;

/**
 * backTo(app, params, fallback) — «назад» экрана поверх: params.back — функция или
 * { name, params } экрана, откуда пришли (например, игра открывает «Специальные возможности»);
 * без него — fallback.
 */
export function backTo(app, params, fallback) {
  const b = params && params.back;
  if (typeof b === 'function') return b();
  if (b && typeof b.name === 'string') return app.go(b.name, b.params || {});
  return app.go(fallback);
}

// --- Слой поверх экрана: шторка и диалог ----------------------------------------------------

let layerSeq = 0;

/**
 * openLayer(host, { kind, title, body, app, onClose }) → { close }. kind 'sheet' — нижняя
 * шторка «Заголовок ×» (как «Подсказка» эталона), 'dialog' — карточка в верхней трети (над
 * клавиатурой iOS). Остальной экран на время слоя — inert; Escape и тап по фону закрывают.
 */
export function openLayer(host, { kind = 'sheet', title = '', body = [], app = null, onClose = null, closeButton = true } = {}) {
  const id = `pf-layer-title-${++layerSeq}`;
  const prevFocus = document.activeElement;
  const siblings = [...host.children];
  const reduced = !!app?.reducedMotion?.();
  let closed = false;

  const backdrop = h('div', { class: 'pf-layer-backdrop', 'aria-hidden': 'true' });
  const panel = h(
    'div',
    { class: kind === 'dialog' ? 'pf-dialog' : 'pf-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id },
    h(
      'div',
      { class: 'pf-layer-head' },
      h('h2', { class: 'pf-layer-title', id, tabindex: '-1', text: title }),
      closeButton ? iconButton('close', COPY.close, () => close()) : null,
    ),
    body,
  );
  const layer = h(
    'div',
    {
      class: `pf-layer ${kind}${reduced ? ' rm' : ''}`,
      onKeydown: (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      },
    },
    backdrop,
    panel,
  );
  backdrop.addEventListener('click', () => close());
  for (const el of siblings) el.setAttribute('inert', '');
  host.appendChild(layer);
  // Двойной кадр: сначала стартовое положение, затем .open — переход шторки (360 мс, без отскока).
  requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('open')));
  // Фокус — сразу, в том же касании (иначе iOS не покажет клавиатуру для поля имени); в шторке —
  // на заголовок: VoiceOver начинает с него, а кольцо фокуса не ложится на первый вариант.
  const target = panel.querySelector('[data-autofocus]') || panel.querySelector('.pf-layer-title');
  target?.focus?.({ preventScroll: true });

  function close() {
    if (closed) return;
    closed = true;
    layer.classList.remove('open');
    for (const el of siblings) el.removeAttribute('inert');
    setTimeout(() => layer.remove(), reduced ? 0 : 320);
    if (prevFocus && prevFocus.isConnected) prevFocus.focus?.({ preventScroll: true });
    onClose?.();
  }
  return { close, el: layer };
}

/** Строка выбора в шторке: иконка · подпись (+ пояснение) · галочка/шеврон. */
function option({ svg = null, iconName = null, label, detail = '', role = null, checked = false, trailing = 'none', onClick, href = null }) {
  const tag = href ? 'a' : 'button';
  return h(
    tag,
    {
      class: 'pf-option',
      type: href ? null : 'button',
      href,
      target: href ? '_blank' : null,
      rel: href ? 'noopener' : null,
      role,
      'aria-checked': role === 'radio' ? String(checked) : null,
      onClick,
    },
    svg || iconName ? h('span', { class: 'pf-opt-icon' }, svg ? svgIcon(svg) : icon(iconName)) : null,
    h('span', { class: 'pf-opt-text' }, h('span', { text: label }), detail ? h('small', { text: detail }) : null),
    trailing === 'check'
      ? h('span', { class: 'pf-opt-check' }, icon('check'))
      : trailing === 'chevron'
        ? h('span', { class: 'pf-opt-chev' }, icon('chevron'))
        : trailing === 'external'
          ? h('span', { class: 'pf-opt-chev' }, svgIcon(SVG.external))
          : null,
  );
}

// --- Иконки карточек: огонь и звезда с мягким градиентом (как 🔥 и монета эталона) ---------

function statGlyph(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    kind === 'flame'
      ? '<defs><linearGradient id="pf-g-fl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6a35c"/><stop offset="1" stop-color="#d9572c"/></linearGradient>' +
        '<linearGradient id="pf-g-fl2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset="1" stop-color="#f6a740"/></linearGradient></defs>' +
        '<path fill="url(#pf-g-fl)" d="M12 22c-4.3 0-7.6-3-7.6-7.1 0-3.6 2.5-5.6 3.9-8.3.4 2 1.5 3.2 2.8 3.9C11.5 6.9 12.4 4.3 14.4 2.6c.5 3.5 5.2 5.9 5.2 12.3 0 4.1-3.3 7.1-7.6 7.1z"/>' +
        '<path fill="url(#pf-g-fl2)" d="M12 22c-2.2 0-3.8-1.5-3.8-3.5 0-2.2 1.8-3.2 2.7-5 .8 1.2 1.7 1.7 2.5 1.8.3-1 .7-1.7 1.2-2.3.7 1.6 1.2 2.8 1.2 5.5 0 2-1.6 3.5-3.8 3.5z"/>'
      : '<defs><radialGradient id="pf-g-st" cx="0.38" cy="0.3" r="0.8"><stop offset="0" stop-color="#ffe7a1"/><stop offset="0.55" stop-color="#f0c35a"/><stop offset="1" stop-color="#cf9330"/></radialGradient></defs>' +
        '<path fill="url(#pf-g-st)" stroke="#b9822a" stroke-width="0.6" stroke-linejoin="round" d="M12 2.2l2.95 6.2 6.75.85-4.98 4.66 1.3 6.72L12 17.3l-6.02 3.33 1.3-6.72L2.3 9.25l6.75-.85z"/>';
  return svg;
}

function statCardEl(kind, value, label) {
  return h(
    'div',
    { class: 'pf-stat' },
    h('span', { class: 'pf-stat-icon' }, statGlyph(kind)),
    h('span', { class: 'pf-stat-text' }, h('b', { text: formatNumber(value) }), h('span', { text: label })),
  );
}

// --- Экран ---------------------------------------------------------------------------------

export function mountSettings(app, params = {}) {
  const settings = () => app.state.settings;
  const goBack = () => backTo(app, params, 'home');

  const hdr = header({ title: COPY.title, onBack: goBack });
  hdr.classList.add('pf-header');

  // Аватар и имя: нажатие — диалог «Как тебя зовут?».
  const avatar = h('div', { class: 'pf-avatar', 'aria-hidden': 'true', onClick: () => editName() });
  const nameText = h('span', { class: 'pf-name-text' });
  const nameBtn = h('button', { class: 'pf-name', type: 'button', onClick: () => editName() }, nameText, h('span', { class: 'pf-name-edit' }, icon('edit')));
  const renderName = () => {
    const name = settings().name;
    const ch = initialOf(name);
    avatar.replaceChildren(ch ? h('span', { text: ch }) : icon('user'));
    avatar.classList.toggle('empty', !ch);
    nameText.textContent = name || COPY.noName;
    nameBtn.classList.toggle('empty', !name);
    nameBtn.setAttribute('aria-label', name ? `${name}. ${COPY.editName}` : COPY.noName);
  };
  renderName();

  const streak = displayStreak(app.state.daily, app.today());
  const stars = totalStars(app);

  const hero = h(
    'div',
    { class: 'pf-hero' },
    avatar,
    h('h2', { class: 'pf-name-h' }, nameBtn),
    h('p', { class: 'pf-tagline', text: COPY.tagline }),
  );
  const stats = h('div', { class: 'pf-stats' }, statCardEl('flame', streak, streakLabel(streak)), statCardEl('star', stars, starsLabel(stars)));

  // Переключатель в строке: тап по всей строке тоже переключает (цель касания — вся строка).
  const switchRow = (opts, sw) => {
    const r = row({ ...opts, control: sw });
    r.classList.add('pf-tap');
    r.addEventListener('click', (e) => {
      if (!sw.contains(e.target)) sw.click();
    });
    return r;
  };

  const themeRow = row({ iconName: 'palette', label: COPY.theme, value: themeLabel(settings().theme), chevron: true, onClick: () => openTheme() });
  const soundRow = switchRow(
    { iconName: 'sound', label: COPY.sound, sub: COPY.soundNote },
    switchControl(settings().sound, (on) => {
      settings().sound = on;
      app.save();
      app.audio.tap();
    }, COPY.sound),
  );
  const flowRow = switchRow(
    { iconName: 'flow', label: COPY.flowNumbers, sub: COPY.flowNumbersNote },
    switchControl(settings().flowNumbers, (on) => {
      settings().flowNumbers = on;
      app.save();
      app.audio.tap();
    }, COPY.flowNumbers),
  );
  const a11yRow = row({ iconName: 'access', label: COPY.a11y, chevron: true, onClick: () => app.go('a11y', { back: { name: 'profile', params } }) });
  const transferRow = row({ iconName: 'transfer', label: COPY.transfer, chevron: true, onClick: () => openTransfer() });
  const aboutRow = row({ iconName: 'info', label: COPY.about, chevron: true, onClick: () => openAbout() });
  const resetRow = row({ iconName: 'trash', label: COPY.reset, danger: true, onClick: () => resetProgress() });

  const foot = h('p', { class: 'pf-foot', text: `Росчерк · ${COPY.build} ${app.buildHash}` });

  const { el, scroll } = screen(
    { className: 'pf-screen', header: hdr },
    hero,
    stats,
    h('div', { class: 'pf-group' }, themeRow, soundRow, flowRow),
    h('div', { class: 'pf-group' }, a11yRow, transferRow, aboutRow),
    h('div', { class: 'pf-group' }, resetRow),
    foot,
  );

  // Крупный блок уехал под шапку — в шапке проявляется «Профиль» (как large title в iOS).
  const onScroll = () => hdr.classList.toggle('pf-scrolled', scroll.scrollTop > 132);
  scroll.addEventListener('scroll', onScroll, { passive: true });

  let layer = null;
  const open = (opts) => {
    layer?.close();
    const l = openLayer(el, {
      app,
      ...opts,
      onClose: () => {
        if (layer === l) layer = null;
      },
    });
    layer = l;
    return l;
  };

  function openTheme() {
    const current = settings().theme;
    const svgOf = { system: SVG.auto, light: SVG.sun, dark: SVG.moon };
    const opts = THEMES.map((th) =>
      option({
        svg: svgOf[th.id],
        label: th.label,
        detail: th.detail,
        role: 'radio',
        checked: th.id === current,
        trailing: 'check',
        onClick: () => pick(th.id),
      }),
    );
    function pick(id) {
      THEMES.forEach((th, i) => opts[i].setAttribute('aria-checked', String(th.id === id)));
      if (settings().theme !== id) {
        settings().theme = id;
        app.save();
        app.applyTheme();
        themeRow.querySelector('.w-row-value').textContent = themeLabel(id);
      }
      app.audio.tap();
      const l = layer;
      setTimeout(() => l?.close(), app.reducedMotion() ? 0 : 180);
    }
    open({ title: COPY.theme, body: h('div', { class: 'pf-options', role: 'radiogroup', 'aria-label': COPY.theme }, opts) });
  }

  function openTransfer() {
    const run = (fn) => () => {
      layer?.close();
      fn();
    };
    open({
      title: COPY.transfer,
      body: [
        h(
          'div',
          { class: 'pf-options' },
          option({ svg: SVG.copy, label: COPY.copyCode, detail: COPY.copyDetail, trailing: 'chevron', onClick: run(copyCode) }),
          option({ svg: SVG.paste, label: COPY.pasteCode, detail: COPY.pasteDetail, trailing: 'chevron', onClick: run(pasteCode) }),
        ),
        h('p', { class: 'pf-sheet-note', text: COPY.transferNote }),
      ],
    });
  }

  function openAbout() {
    open({
      title: COPY.about,
      body: [
        h('div', { class: 'pf-about' }, h('p', { class: 'w-wordmark', text: 'Росчерк' }), h('p', { class: 'pf-about-text', text: COPY.aboutText })),
        h(
          'div',
          { class: 'pf-options' },
          h(
            'div',
            { class: 'pf-option static' },
            h('span', { class: 'pf-opt-icon' }, icon('info')),
            h('span', { class: 'pf-opt-text' }, h('span', { text: COPY.version })),
            h('span', { class: 'pf-opt-value', text: app.buildHash }),
          ),
          option({ iconName: 'lock', label: COPY.privacy, trailing: 'external', href: PRIVACY_URL }),
        ),
      ],
    });
  }

  function editName() {
    const input = h('input', {
      class: 'pf-input',
      type: 'text',
      maxlength: String(NAME_MAX * 4), // грубый предел для вставки; точный — fitName в onInput
      autocomplete: 'given-name',
      autocapitalize: 'words',
      enterkeyhint: 'done',
      spellcheck: 'false',
      placeholder: COPY.namePlaceholder,
      'aria-label': COPY.namePlaceholder,
      'data-autofocus': '',
    });
    input.value = settings().name;
    const count = h('span', { class: 'pf-count', 'aria-hidden': 'true' });
    const renderCount = () => (count.textContent = `${nameLength(input.value)} / ${NAME_MAX}`);
    renderCount();
    input.addEventListener('input', () => {
      // Предел — целыми графемами: maxlength браузера режет по UTF-16 и рвёт эмодзи.
      const fitted = fitName(input.value);
      if (fitted !== input.value) {
        const caret = Math.min(input.selectionStart ?? fitted.length, fitted.length);
        input.value = fitted;
        try {
          input.setSelectionRange(caret, caret);
        } catch {}
      }
      renderCount();
    });
    const saveName = () => {
      settings().name = cleanName(input.value);
      app.save();
      renderName();
      layer?.close();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveName();
      }
    });
    open({
      kind: 'dialog',
      title: COPY.nameTitle,
      closeButton: false,
      body: [
        h('p', { class: 'pf-dialog-note', text: COPY.nameNote }),
        input,
        count,
        h(
          'div',
          { class: 'pf-dialog-actions' },
          button(COPY.cancel, { variant: 'secondary', onClick: () => layer?.close() }),
          button(COPY.save, { variant: 'primary', onClick: saveName }),
        ),
      ],
    });
  }

  // Код прогресса и сброс — как в прежних настройках (SPEC §3.1 п.5).
  const copyCode = async () => {
    const code = exportCode(app.state);
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (copied) app.overlays.toast(t('codeCopied'));
    else {
      app.overlays.toast(t('codeShown'));
      await app.overlays.prompt(t('copyCode'), { value: code, readOnly: true });
    }
  };

  const pasteCode = async () => {
    const code = await app.overlays.prompt(t('pastePrompt'));
    if (code == null || !code.trim()) return;
    const next = importCode(code, app.modes.map((m) => m.id));
    if (!next) {
      app.overlays.toast(t('codeBad'));
      return;
    }
    if (!(await app.overlays.confirm(t('pasteConfirm')))) return;
    app.replaceState(next);
    app.overlays.toast(t('codeApplied'));
    app.go('profile', params);
  };

  const resetProgress = async () => {
    if (!(await app.overlays.confirm(t('resetProgressConfirm'), { danger: true }))) return;
    app.replaceState(defaultState(app.modes.map((m) => m.id)));
    app.overlays.toast(t('progressCleared'));
    app.go('profile', params);
  };

  return {
    el,
    destroy() {
      scroll.removeEventListener('scroll', onScroll);
      layer?.close();
    },
  };
}
