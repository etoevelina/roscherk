// Тема (§4.4, docs/DESIGN.md §2): светлая/тёмная по настройке или prefers-color-scheme.
// CSS-переменные на :root[data-theme] читаются один раз при смене темы в объект theme. Поля
// холстов режимов — палитра WORDS: поле — бумага (--w-paper) на холсте (--w-canvas), стены и
// чернила — --w-ink, плитки под числами — --w-white, подсказка — спокойная лаванда, ошибка и
// успех — --w-danger / --w-success. Палитра «Потоков» живёт здесь (FLOW_PALETTE), а не в CSS.

const FLOW_COUNT = 12;

/**
 * «Потоки»: 12 различимых при дальтонизме оттенков — прежние (Lumin), смешанные на 6 % с тёплым
 * серым под фарфор WORDS. Минимальная попарная ΔE2000 при протанопии / дейтеранопии / тританопии
 * не падает (4.1 / 6.2 / 4.5 против 4.1 / 6.6 / 4.6). Светлая тема — глубокие тона (≥ 3.3:1 к бумаге
 * #f4f1ec), тёмная — пастель (≥ 4.8:1 к #1d1e1b); номера на точках — readableOn (≥ 4.5:1).
 */
export const FLOW_PALETTE = Object.freeze({
  light: Object.freeze(['#a1494e', '#8e4f0e', '#9e8129', '#3a6734', '#337e78', '#264f7f', '#7f68a9', '#80305d', '#6e7c26', '#336f8d', '#a27455', '#3d414b']),
  dark: Object.freeze(['#cb7c80', '#e3a76d', '#e6cd78', '#99c78f', '#6fc1b9', '#a2c1f1', '#b29ce1', '#b9779f', '#92a54a', '#629fbb', '#a78161', '#c6cbd4']),
});

/** Тёмные цифры на светлых плитках (и в тёмной теме — на пастельных точках). */
const DARK_TEXT = '#111311';
const LIGHT_TEXT = '#ffffff';

/** resolveThemeId(setting, systemDark) → 'dark' | 'light'. */
export function resolveThemeId(setting, systemDark) {
  if (setting === 'dark' || setting === 'light') return setting;
  return systemDark ? 'dark' : 'light';
}

/** Проставить data-theme на корневой элемент и вернуть итоговый id темы. */
export function applyTheme(setting, root = document.documentElement) {
  const systemDark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : true;
  const id = resolveThemeId(setting, systemDark);
  root.setAttribute('data-theme', id);
  return id;
}

/** Разбор #rgb / #rrggbb → [r, g, b] или null. */
function parseHex(color) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((color || '').trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.replace(/./g, (ch) => ch + ch);
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

const toHex = (rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/**
 * lighten(color, amount) → hex, смешанный с белым на долю amount (0…1). Используется для свечения
 * линии от акцента режима; не-hex цвет возвращается как есть.
 */
export function lighten(color, amount = 0.4) {
  return mixColor(color, '#ffffff', amount);
}

/** mixColor(a, b, k) → hex: a, смешанный с b на долю k (0…1); если один из цветов не hex — a как есть. */
export function mixColor(a, b, k = 0.5) {
  const ra = parseHex(a);
  const rb = parseHex(b);
  if (!ra || !rb) return a;
  const t = Math.max(0, Math.min(1, k));
  return toHex(ra.map((c, i) => c + (rb[i] - c) * t));
}

/** Относительная яркость WCAG для hex-цвета (null для не-hex). */
function luminance(color) {
  const rgb = parseHex(color);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** contrastRatio(a, b) → коэффициент контраста WCAG (1…21); для не-hex цветов — 1. */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return 1;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** readableOn(bg) → тёмный или белый текст — тот, у которого контраст с bg выше (AA для палитр). */
export function readableOn(bg, dark = DARK_TEXT, light = LIGHT_TEXT) {
  return contrastRatio(dark, bg) >= contrastRatio(light, bg) ? dark : light;
}

// Свечение линии: в светлой теме — светлее акцента; в тёмной почти цвет линии: осветлённый ореол
// низкой альфы на графите читался бы серой каймой, а не мягким свечением.
const GLOW_LIGHTEN = { dark: 0.12, light: 0.3 };

/**
 * readTheme(root, accent) → объект theme по §4.4. accent — цвет режима для текущей темы
 * (mode.color / mode.colorLight); при отсутствии берётся --accent из CSS. Свечение линии
 * (lineGlow) производится от акцента режима, чтобы ореол совпадал с цветом линии; без режима —
 * --line-glow из CSS. Токены WORDS (--w-*) читаются с откатом на прежние переменные оболочки.
 *
 * Поля поля режима (docs/DESIGN.md §5.6): canvas — фон холста, paper — поле, tile — плитки под
 * числами и узлами, ink — стены и чернила, hairline — тонкая обводка поля, track — непройденные
 * отрезки «Одного штриха» (≥ 3:1 к бумаге). large / contrast — «Крупный текст в головоломке» и
 * «Контрастные номера» (классы a11y-large / a11y-contrast на <body>, src/main.js).
 */
export function readTheme(root = document.documentElement, accent = null) {
  const cs = getComputedStyle(root);
  const v = (name, fallback = '') => (cs.getPropertyValue(name) || fallback).trim();
  const id = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const flow = FLOW_PALETTE[id].slice(0, FLOW_COUNT);
  const flowText = flow.map((c) => readableOn(c));

  const bg = v('--bg');
  const surface = v('--surface');
  const text = v('--text');
  const textMuted = v('--text-muted');
  const grid = v('--grid');
  const paper = v('--w-paper') || surface;
  const ink = v('--w-ink') || text;
  // Непройденные отрезки — мягче узлов, но не ниже 3:1 к бумаге (WCAG 1.4.11).
  let track = mixColor(textMuted, paper, 0.22);
  if (contrastRatio(track, paper) < 3) track = textMuted;

  const body = root && root.ownerDocument ? root.ownerDocument.body : null;
  const cls = body && body.classList;
  return {
    id,
    bg,
    surface,
    surface2: v('--surface2'),
    text,
    textMuted,
    grid,
    wall: v('--w-ink') || v('--wall'),
    line: accent || v('--accent'),
    lineGlow: accent ? lighten(accent, GLOW_LIGHTEN[id]) : v('--line-glow'),
    accent: accent || v('--accent'),
    // Подсказка — спокойная лаванда WORDS («открытия»), не спорит ни с одним акцентом режима.
    hint: v(id === 'light' ? '--w-lav-ink' : '--w-lav') || v('--hint'),
    danger: v('--w-danger') || v('--danger'),
    ok: v('--w-success') || v('--ok'),
    flow,
    flowText,
    canvas: v('--w-canvas') || bg,
    paper,
    tile: v('--w-white') || surface,
    ink,
    hairline: v('--w-line') || grid,
    track,
    large: !!(cls && cls.contains('a11y-large')),
    contrast: !!(cls && cls.contains('a11y-contrast')),
  };
}

/** Подписка на системную тему: cb(systemDark). Возвращает функцию отписки. */
export function watchSystemTheme(cb) {
  if (typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const handler = (e) => cb(e.matches);
  if (mq.addEventListener) mq.addEventListener('change', handler);
  else mq.addListener(handler);
  return () => {
    if (mq.removeEventListener) mq.removeEventListener('change', handler);
    else mq.removeListener(handler);
  };
}

/** Цвет акцента режима для темы. */
export function modeAccent(mode, themeId) {
  if (!mode) return null;
  return themeId === 'light' ? mode.colorLight || mode.color : mode.color;
}

/** Обновить meta theme-color под цвет шапки/фона. */
export function setThemeColorMeta(color) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && color) meta.setAttribute('content', color);
}
