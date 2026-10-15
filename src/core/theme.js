// Тема (§4.4): тёмная по умолчанию, светлая по prefers-color-scheme или настройке.
// CSS-переменные на :root[data-theme] читаются один раз при смене темы в объект theme.

const FLOW_COUNT = 12;

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

/**
 * lighten(color, amount) → hex, смешанный с белым на долю amount (0…1). Используется для свечения
 * линии от акцента режима; не-hex цвет возвращается как есть.
 */
export function lighten(color, amount = 0.4) {
  const rgb = parseHex(color);
  if (!rgb) return color;
  const k = Math.max(0, Math.min(1, amount));
  const mix = rgb.map((c) => Math.round(c + (255 - c) * k));
  return `#${mix.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

const GLOW_LIGHTEN = { dark: 0.4, light: 0.3 };

/**
 * readTheme(root, accent) → объект theme по §4.4. accent — цвет режима для текущей темы
 * (mode.color / mode.colorLight); при отсутствии берётся --accent из CSS. Свечение линии
 * (lineGlow) производится от акцента режима, чтобы ореол совпадал с цветом линии; без режима —
 * --line-glow из CSS.
 */
export function readTheme(root = document.documentElement, accent = null) {
  const cs = getComputedStyle(root);
  const v = (name, fallback = '') => (cs.getPropertyValue(name) || fallback).trim();
  const id = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const flow = [];
  const flowText = [];
  for (let i = 0; i < FLOW_COUNT; i++) {
    flow.push(v(`--flow-${i}`, '#888888'));
    flowText.push(v(`--flow-text-${i}`, id === 'dark' ? '#000000' : '#ffffff'));
  }
  return {
    id,
    bg: v('--bg'),
    surface: v('--surface'),
    surface2: v('--surface2'),
    text: v('--text'),
    textMuted: v('--text-muted'),
    grid: v('--grid'),
    wall: v('--wall'),
    line: accent || v('--accent'),
    lineGlow: accent ? lighten(accent, GLOW_LIGHTEN[id]) : v('--line-glow'),
    accent: accent || v('--accent'),
    hint: v('--hint'),
    danger: v('--danger'),
    ok: v('--ok'),
    flow,
    flowText,
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
