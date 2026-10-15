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
};

/** Иконка режима: имя задаёт сам модуль режима полем icon (§5.1). */
export function modeIcon(mode) {
  return icon((mode && mode.icon) || 'route');
}
