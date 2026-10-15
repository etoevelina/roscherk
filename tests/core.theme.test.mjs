// Тесты src/core/theme.js (§4.4): выбор темы, акцент режима, чтение объекта theme из CSS-переменных
// (фейковый getComputedStyle), свечение линии от акцента режима. Регресс: инлайн --accent на :root
// не должен участвовать — объект theme читается только из CSS темы и акцента режима.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveThemeId, modeAccent, readTheme, lighten } from '../src/core/theme.js';

const VARS = {
  dark: { '--bg': '#0f1117', '--accent': '#4f8cff', '--line-glow': '#8fb5ff', '--text': '#f2f4f8', '--flow-0': '#ff5d6c', '--flow-text-5': '#ffffff' },
  light: { '--bg': '#f4f5f9', '--accent': '#2f6fe0', '--line-glow': '#6f9df0', '--text': '#141824', '--flow-0': '#d7263d', '--flow-text-5': '#ffffff' },
};

/** Фейковый корневой элемент с data-theme и инлайн-стилем, getComputedStyle читает CSS темы. */
function fakeRoot(themeId, inline = {}) {
  const attrs = { 'data-theme': themeId };
  return {
    getAttribute: (k) => attrs[k] ?? null,
    style: { getPropertyValue: (k) => inline[k] ?? '' },
    computed: (k) => inline[k] ?? VARS[themeId][k] ?? '',
  };
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
    assert.equal(dark.flow.length, 12);
    assert.equal(dark.flowText.length, 12);
    assert.equal(dark.flow[0], '#ff5d6c');
    assert.equal(dark.flow[3], '#888888', 'нет переменной → заглушка');
    assert.equal(dark.flowText[5], '#ffffff');
    assert.equal(dark.flowText[7], '#000000', 'нет переменной → чёрные цифры в тёмной теме');
    const light = readTheme(fakeRoot('light'), null);
    assert.equal(light.id, 'light');
    assert.equal(light.accent, '#2f6fe0');
    assert.equal(light.lineGlow, '#6f9df0');
    assert.equal(light.flowText[7], '#ffffff');
  });
});

test('readTheme с режимом: accent/line — цвет режима, lineGlow — осветлённый акцент режима', () => {
  withComputedStyle(() => {
    const dark = readTheme(fakeRoot('dark'), modeAccent(MODE, 'dark'));
    assert.equal(dark.accent, '#F2A33C');
    assert.equal(dark.line, '#F2A33C');
    assert.equal(dark.lineGlow, lighten('#F2A33C', 0.4));
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
