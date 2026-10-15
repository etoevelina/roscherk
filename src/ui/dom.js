// Мини-помощники DOM и инлайн-иконки (SVG, без внешних ресурсов).

/**
 * h(tag, props, ...children) → элемент. props: class, text, html (только доверенные строки),
 * on* — обработчики, style — объект, остальное — атрибуты. children: узлы, строки, массивы, null.
 */
export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') applyStyle(el, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

/**
 * Стили из объекта: camelCase-свойства — как поля el.style; CSS-переменные ('--mode-color') —
 * только через setProperty (присваивание el.style['--x'] молча игнорируется).
 */
function applyStyle(el, styles) {
  for (const [name, value] of Object.entries(styles)) {
    if (value == null) continue;
    if (name.startsWith('--')) el.style.setProperty(name, String(value));
    else el.style[name] = value;
  }
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** icon(name) → <svg> 24×24 с штрихом currentColor. */
export function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

const ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  hint: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 1 4 12.7V17H8v-2.3A7 7 0 0 1 12 2z"/>',
  skip: '<path d="M5 4l10 8-10 8z"/><path d="M19 5v14"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  star: '<path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  share: '<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  plus: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>',
  rotate: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/><path d="M2 12a10 10 0 0 1 3-7"/><path d="M22 12a10 10 0 0 1-3 7"/>',
  route: '<path d="M4 6h8a4 4 0 0 1 0 8H8a3 3 0 0 0 0 6h12"/><circle cx="4" cy="6" r="1.5"/><circle cx="20" cy="20" r="1.5"/>',
  flow: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5V14a4 4 0 0 0 4 4h5.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/>',
  stroke: '<path d="M4 20L12 4l8 16H4z"/><path d="M4 20l8-6 8 6"/>',
  infinity: '<path d="M12 12c-2-2.7-3.3-4-5.5-4a4 4 0 0 0 0 8c2.2 0 3.5-1.3 5.5-4s3.3-4 5.5-4a4 4 0 0 1 0 8c-2.2 0-3.5-1.3-5.5-4z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  words: '<rect x="2.5" y="6" width="6" height="12" rx="1.5"/><rect x="9" y="6" width="6" height="12" rx="1.5"/><rect x="15.5" y="6" width="6" height="12" rx="1.5"/><path d="M4.5 14.5l1-5 1 5M11 9.5h2M12 9.5v5M17.5 9.5h2a1 1 0 0 1 0 2.5h-2v-2.5zM17.5 12h2a1.2 1.2 0 0 1 0 2.5h-2z"/>',
  backspace: '<path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="M12 9l6 6M18 9l-6 6"/>',
  pencil: '<path d="M4 20l4-1 11-11-3-3L5 16l-1 4z"/><path d="M13 7l3 3"/><path d="M3 21c4-2 8-1 12 0"/>',
  // WORDS (docs/DESIGN.md): навигация, профиль, статистика, подсказки.
  home: '<path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
  packs: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  bars: '<path d="M5 20V12M10 20V6M15 20v-9M20 20V9"/>',
  arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  flame: '<path d="M12 21c-3.9 0-7-2.8-7-6.6 0-3.3 2.3-5.2 3.6-7.7.4 1.8 1.4 3 2.6 3.6C11.5 7 12.3 4.6 14.2 3c.4 3.2 4.8 5.5 4.8 11.4 0 3.8-3.1 6.6-7 6.6z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.2-4 4.3-6 8-6s6.8 2 8 6"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  eraser: '<path d="M8 20h12"/><path d="M4.6 14.6l9.2-9.2a2 2 0 0 1 2.8 0l2 2a2 2 0 0 1 0 2.8L11 18.8a2 2 0 0 1-1.4.6H8.2a2 2 0 0 1-1.4-.6l-2.2-2.2a2 2 0 0 1 0-2.8z"/><path d="M9 10l5 5"/>',
  shuffle: '<path d="M3 7h3.5c4.5 0 6.5 10 11 10H21"/><path d="M3 17h3.5c1.6 0 2.8-1.2 3.8-2.8M13.7 9.8C14.7 8.2 15.9 7 17.5 7H21"/><path d="M18.5 4.5L21 7l-2.5 2.5M18.5 14.5L21 17l-2.5 2.5"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  vibrate: '<rect x="8" y="3" width="8" height="18" rx="2"/><path d="M4 8v8M20 8v8"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.3 0 2-.9 2-2 0-1.6-1.5-2-1.5-3.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4-4-7-9-7z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="15" cy="7" r="1.2"/>',
  access: '<circle cx="12" cy="4.5" r="1.8"/><path d="M5 8.5l7 1.5 7-1.5"/><path d="M12 10v4.5L9 21M12 14.5l3 6.5"/>',
  transfer: '<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5h.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8v.5"/><path d="M12 17h.01"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
};

/** Иконка режима: имя задаёт сам модуль режима полем icon (§5.1). */
export function modeIcon(mode) {
  return icon((mode && mode.icon) || 'route');
}
