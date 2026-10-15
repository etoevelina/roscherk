// Тесты src/core/theme.js (§4.4, docs/DESIGN.md §5.6): выбор темы, акцент режима, чтение объекта
// theme из CSS-переменных (фейковый getComputedStyle), свечение линии от акцента режима, палитра
// полей WORDS (токены --w-* с откатом на прежние переменные), палитра «Потоков» и контраст.
// Регресс: инлайн --accent на :root не должен участвовать — объект theme читается только из CSS
// темы и акцента режима.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveThemeId, modeAccent, readTheme, lighten, mixColor, contrastRatio, readableOn, FLOW_PALETTE } from '../src/core/theme.js';
import zip from '../src/modes/zip.js';
import flow from '../src/modes/flow.js';
import stroke from '../src/modes/stroke.js';
import draw from '../src/modes/draw.js';

const VARS = {
  dark: { '--bg': '#0f1117', '--accent': '#4f8cff', '--line-glow': '#8fb5ff', '--text': '#f2f4f8', '--flow-0': '#ff5d6c', '--flow-text-5': '#ffffff' },
  light: { '--bg': '#f4f5f9', '--accent': '#2f6fe0', '--line-glow': '#6f9df0', '--text': '#141824', '--flow-0': '#d7263d', '--flow-text-5': '#ffffff' },
};

// Токены WORDS (src/styles/00-tokens.css) — значения, как их отдаёт getComputedStyle.
const WORDS = {
  light: { '--w-canvas': '#e9e4de', '--w-paper': '#f4f1ec', '--w-white': '#ffffff', '--w-ink': '#111311', '--w-line': 'rgba(17, 19, 17, 0.1)', '--w-lav': '#aaa7c6', '--w-lav-ink': '#5e5887', '--w-danger': '#9a5e5e', '--w-success': '#5f795e', '--text-muted': '#5b605c', '--surface': '#f4f1ec' },
  dark: { '--w-canvas': '#141513', '--w-paper': '#1d1e1b', '--w-white': '#2a2c28', '--w-ink': '#f1efea', '--w-line': 'rgba(241, 239, 234, 0.12)', '--w-lav': '#a39dc9', '--w-lav-ink': '#c4bee6', '--w-danger': '#e0a3a3', '--w-success': '#a9c8a2', '--text-muted': '#a6aba6', '--surface': '#1d1e1b' },
};

/** Фейковый корневой элемент с data-theme и инлайн-стилем, getComputedStyle читает CSS темы. */
function fakeRoot(themeId, inline = {}, { words = false, bodyClasses = null } = {}) {
  const attrs = { 'data-theme': themeId };
  const vars = words ? { ...VARS[themeId], ...WORDS[themeId] } : VARS[themeId];
  const root = {
    getAttribute: (k) => attrs[k] ?? null,
    style: { getPropertyValue: (k) => inline[k] ?? '' },
    computed: (k) => inline[k] ?? vars[k] ?? '',
  };
  if (bodyClasses) root.ownerDocument = { body: { classList: { contains: (c) => bodyClasses.includes(c) } } };
  return root;
}

function withComputedStyle(fn) {
  const prev = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (root) => ({
    // Как в браузере: объявленная переменная — с пробелами вокруг, необъявленная — пустая строка.
    getPropertyValue: (k) => (root.computed(k) ? ` ${root.computed(k)} ` : ''),
  });
  try {
    return fn();
  } finally {
    if (prev === undefined) delete globalThis.getComputedStyle;
    else globalThis.getComputedStyle = prev;
  }
}

const MODE = { id: 'stroke', color: '#F2A33C', colorLight: '#C97A12' };

test('resolveThemeId: настройка побеждает систему', () => {
  assert.equal(resolveThemeId('dark', false), 'dark');
  assert.equal(resolveThemeId('light', true), 'light');
  assert.equal(resolveThemeId('system', true), 'dark');
  assert.equal(resolveThemeId('system', false), 'light');
  assert.equal(resolveThemeId(undefined, true), 'dark');
});

test('modeAccent: цвет режима по теме, без режима — null', () => {
  assert.equal(modeAccent(MODE, 'dark'), '#F2A33C');
  assert.equal(modeAccent(MODE, 'light'), '#C97A12');
  assert.equal(modeAccent({ id: 'x', color: '#123456' }, 'light'), '#123456', 'без colorLight — color');
  assert.equal(modeAccent(null, 'dark'), null);
});

test('readTheme без режима читает accent и lineGlow из CSS темы (обе темы)', () => {
  withComputedStyle(() => {
    const dark = readTheme(fakeRoot('dark'), null);
    assert.equal(dark.id, 'dark');
    assert.equal(dark.accent, '#4f8cff');
    assert.equal(dark.line, '#4f8cff');
    assert.equal(dark.lineGlow, '#8fb5ff');
    assert.equal(dark.bg, '#0f1117');
    // Палитра «Потоков» — FLOW_PALETTE темы, а не прежние --flow-* из CSS.
    assert.equal(dark.flow.length, 12);
    assert.equal(dark.flowText.length, 12);
    assert.deepEqual(dark.flow, [...FLOW_PALETTE.dark]);
    assert.notEqual(dark.flow[0], '#ff5d6c', 'CSS --flow-0 не участвует');
    assert.equal(dark.flowText[7], '#111311', 'пастель тёмной темы — тёмные цифры');
    const light = readTheme(fakeRoot('light'), null);
    assert.equal(light.id, 'light');
    assert.equal(light.accent, '#2f6fe0');
    assert.equal(light.lineGlow, '#6f9df0');
    assert.deepEqual(light.flow, [...FLOW_PALETTE.light]);
    assert.equal(light.flowText[7], '#ffffff', 'глубокие тона светлой темы — белые цифры');
    assert.equal(light.flowText[2], '#111311', 'горчичный — тёмные цифры (белые < 4.5:1)');
  });
});

test('readTheme: поле WORDS — токены --w-*, без них откат на прежние переменные', () => {
  withComputedStyle(() => {
    for (const id of ['light', 'dark']) {
      const w = readTheme(fakeRoot(id, {}, { words: true }), null);
      assert.equal(w.canvas, WORDS[id]['--w-canvas']);
      assert.equal(w.paper, WORDS[id]['--w-paper']);
      assert.equal(w.tile, WORDS[id]['--w-white']);
      assert.equal(w.ink, WORDS[id]['--w-ink']);
      assert.equal(w.wall, WORDS[id]['--w-ink'], 'стены — чернила в обеих темах');
      assert.equal(w.hairline, WORDS[id]['--w-line']);
      assert.equal(w.hint, WORDS[id][id === 'light' ? '--w-lav-ink' : '--w-lav'], 'подсказка — спокойная лаванда');
      assert.equal(w.danger, WORDS[id]['--w-danger']);
      assert.equal(w.ok, WORDS[id]['--w-success']);
      assert.ok(contrastRatio(w.hint, w.paper) >= 3, `подсказка ≥ 3:1 к бумаге (${id})`);
      assert.ok(contrastRatio(w.track, w.paper) >= 3, `непройденные отрезки ≥ 3:1 к бумаге (${id})`);
      assert.ok(contrastRatio(w.track, w.paper) < contrastRatio(w.textMuted, w.paper), 'отрезки мягче узлов');
      assert.equal(w.large, false);
      assert.equal(w.contrast, false);
    }
    const legacy = readTheme(fakeRoot('dark'), null);
    assert.equal(legacy.paper, '');
    assert.equal(legacy.ink, '#f2f4f8', 'без --w-ink — --text');
    assert.equal(legacy.canvas, '#0f1117', 'без --w-canvas — --bg');
  });
});

test('readTheme: «Крупный текст» и «Контрастные номера» — классы a11y на <body>', () => {
  withComputedStyle(() => {
    const on = readTheme(fakeRoot('light', {}, { words: true, bodyClasses: ['a11y-large', 'a11y-contrast'] }), null);
    assert.equal(on.large, true);
    assert.equal(on.contrast, true);
    const off = readTheme(fakeRoot('light', {}, { words: true, bodyClasses: ['a11y-motion'] }), null);
    assert.equal(off.large, false);
    assert.equal(off.contrast, false);
  });
});

test('FLOW_PALETTE: 12 различимых оттенков, видны на бумаге, номера ≥ 4.5:1', () => {
  const paper = { light: '#f4f1ec', dark: '#1d1e1b' };
  for (const id of ['light', 'dark']) {
    const pal = FLOW_PALETTE[id];
    assert.equal(pal.length, 12);
    assert.equal(new Set(pal).size, 12, 'без повторов');
    for (const c of pal) {
      assert.ok(contrastRatio(c, paper[id]) >= 3.2, `${c} ≥ 3.2:1 к бумаге (${id})`);
      assert.ok(contrastRatio(readableOn(c), c) >= 4.5, `номер на ${c} ≥ 4.5:1`);
    }
  }
});

test('акценты холстовых режимов: светлая — ≥ 4:1 к бумаге и белый текст ≥ 4.5:1, тёмная — ≥ 7:1', () => {
  for (const m of [zip, flow, stroke, draw]) {
    assert.ok(contrastRatio(m.colorLight, '#f4f1ec') >= 4, `${m.id}: ${m.colorLight} к бумаге`);
    assert.ok(contrastRatio(m.colorLight, '#ffffff') >= 4.5, `${m.id}: белый текст на ${m.colorLight}`);
    assert.ok(contrastRatio(m.color, '#1d1e1b') >= 7, `${m.id}: ${m.color} к тёмной бумаге`);
  }
  // Числа «Маршрута» — чернила на плитке: ≥ 4.5:1 в обеих темах.
  assert.ok(contrastRatio('#111311', '#ffffff') >= 4.5);
  assert.ok(contrastRatio('#f1efea', '#2a2c28') >= 4.5);
});

test('mixColor / contrastRatio / readableOn', () => {
  assert.equal(mixColor('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mixColor('#123456', '#ffffff', 0), '#123456');
  assert.equal(mixColor('rgba(0,0,0,.1)', '#ffffff', 0.5), 'rgba(0,0,0,.1)', 'не-hex — как есть');
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21);
  assert.equal(contrastRatio('#abc', '#abc'), 1);
  assert.equal(contrastRatio('red', '#fff'), 1, 'не-hex → 1');
  assert.equal(readableOn('#ffffff'), '#111311');
  assert.equal(readableOn('#111311'), '#ffffff');
});

test('readTheme с режимом: accent/line — цвет режима, lineGlow — осветлённый акцент режима', () => {
  withComputedStyle(() => {
    const dark = readTheme(fakeRoot('dark'), modeAccent(MODE, 'dark'));
    assert.equal(dark.accent, '#F2A33C');
    assert.equal(dark.line, '#F2A33C');
    assert.equal(dark.lineGlow, lighten('#F2A33C', 0.12), 'тёмная тема: ореол почти цвета линии (без серой каймы)');
    assert.notEqual(dark.lineGlow.toLowerCase(), '#8fb5ff', 'свечение не синее при янтарной линии');
    const light = readTheme(fakeRoot('light'), modeAccent(MODE, 'light'));
    assert.equal(light.accent, '#C97A12');
    assert.equal(light.lineGlow, lighten('#C97A12', 0.3));
    assert.equal(light.bg, '#f4f5f9', 'остальные цвета — из CSS темы');
  });
});

test('смена темы после игры: без инлайн --accent главный экран получает акцент своей темы', () => {
  withComputedStyle(() => {
    // Игровой экран читал акцент режима; затем тема переключена на светлую без режима.
    readTheme(fakeRoot('dark'), modeAccent(MODE, 'dark'));
    const home = readTheme(fakeRoot('light'), null);
    assert.equal(home.accent, '#2f6fe0');
    // Если бы на :root остался инлайн --accent режима, он победил бы CSS темы — именно этого не должно быть.
    const stuck = readTheme(fakeRoot('light', { '--accent': '#C97A12' }), null);
    assert.equal(stuck.accent, '#C97A12', 'инлайн действительно перекрывает CSS — поэтому оболочка его не пишет');
  });
});

test('lighten: смешивание с белым, короткий hex, не-hex как есть', () => {
  assert.equal(lighten('#000000', 0.5), '#808080');
  assert.equal(lighten('#ffffff', 0.5), '#ffffff');
  assert.equal(lighten('#000', 1), '#ffffff');
  assert.equal(lighten('#4f8cff', 0), '#4f8cff');
  assert.equal(lighten('rgb(1,2,3)', 0.5), 'rgb(1,2,3)');
  assert.equal(lighten('#F2A33C', 0.4), '#f7c88a');
});
