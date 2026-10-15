// Профиль и «Специальные возможности» (docs/DESIGN.md §5.10–5.11): чистые помощники экрана
// (src/ui/settings.js) и CSS эффектов body.a11y-large / body.a11y-contrast (src/styles/50-profile.css).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  plural,
  streakLabel,
  starsLabel,
  formatNumber,
  initialOf,
  cleanName,
  fitName,
  nameLength,
  totalStars,
  themeLabel,
  backTo,
  mountSettings,
  PRIVACY_URL,
  COPY,
} from '../src/ui/settings.js';
import { mountA11y, A11Y_COPY } from '../src/ui/a11y.js';
import { normalize, NAME_MAX } from '../src/core/storage.js';
import { cssSources } from '../tools/build.mjs';

test('plural: русские формы для серии и звёзд', () => {
  assert.equal(streakLabel(1), 'день серии');
  assert.equal(streakLabel(2), 'дня серии');
  assert.equal(streakLabel(5), 'дней серии');
  assert.equal(streakLabel(11), 'дней серии');
  assert.equal(streakLabel(12), 'дней серии');
  assert.equal(streakLabel(21), 'день серии');
  assert.equal(streakLabel(0), 'дней серии');
  assert.equal(starsLabel(1), 'звезда');
  assert.equal(starsLabel(3), 'звезды');
  assert.equal(starsLabel(62), 'звезды');
  assert.equal(starsLabel(111), 'звёзд');
  assert.equal(starsLabel(114), 'звёзд');
  assert.equal(plural(104, ['a', 'b', 'c']), 'b');
});

test('formatNumber: разряды через неразрывный пробел', () => {
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(999), '999');
  assert.equal(formatNumber(1240), '1 240');
  assert.equal(formatNumber(1234567), '1 234 567');
  assert.equal(formatNumber(-3), '0');
});

test('initialOf: заглавная первая буква, пустое имя — пусто (иконка)', () => {
  assert.equal(initialOf('евелина'), 'Е');
  assert.equal(initialOf('  ann '), 'A');
  assert.equal(initialOf(''), '');
  assert.equal(initialOf(null), '');
  assert.equal(initialOf('😀 Smile'), '😀'); // суррогатная пара не рвётся
});

test('cleanName: как storage.normalize — пробелы схлопнуты, не длиннее 24', () => {
  assert.equal(cleanName('  Ева   Мария  '), 'Ева Мария');
  assert.equal(cleanName('x'.repeat(40)).length, NAME_MAX);
  assert.equal(cleanName(''), '');
  const raw = 'Константин Константинович';
  const st = normalize({ v: 1, settings: { name: raw } });
  assert.equal(cleanName(raw), st.settings.name);
  const emoji = `${'a'.repeat(23)}😀`; // 25 code units: эмодзи не режется пополам
  assert.ok(!/[\uD800-\uDBFF]$/.test(cleanName(emoji)));
});

test('имя с эмодзи: аватар, счётчик и обрезка — целыми графемами', () => {
  const fam = '👨‍👩‍👧‍👦'; // ZWJ-цепочка, 11 единиц UTF-16
  assert.equal(initialOf('🇷🇺Ева'), '🇷🇺'); // флаг целиком, не одинокий региональный индикатор
  assert.equal(initialOf(`${fam} Ева`), fam);
  assert.equal(nameLength(`${fam}${fam} Ева`), 6); // счётчик: эмодзи = 1
  assert.equal(nameLength('Ева'), 3);
  const cut = cleanName(`${fam}${fam} Ева`);
  assert.ok(cut.length <= NAME_MAX);
  assert.ok(cut.startsWith(`${fam}${fam}`)); // семья не порвана
  assert.ok(!/[\u200D\uD800-\uDBFF]$/.test(cut));
  assert.equal(normalize({ v: 1, settings: { name: cut } }).settings.name, cut); // переживает перезагрузку
  assert.equal(fitName(`${'a'.repeat(20)}${fam}`), 'a'.repeat(20)); // эмодзи не влезает — уходит целиком
  assert.equal(cleanName('👨‍👩‍'), '👨‍👩'); // висячий ZWJ от старой обрезки убран
});

test('totalStars: сумма 1–3 звёзд по режимам, только уровни кампании сборки', () => {
  const sets = {
    zip: { campaign: [{ id: 'z1' }, { id: 'z2' }, { id: 'z3' }] },
    words: { campaign: [{ id: 'w1' }] },
  };
  const app = {
    modes: [{ id: 'zip' }, { id: 'words' }, { id: 'flow' }],
    modeSets: (id) => sets[id] || { campaign: [] },
    state: {
      progress: {
        zip: { z1: { star: true, bestMs: 10, stars: 3 }, z2: { star: false, bestMs: 10, stars: 2 }, old: { star: true, bestMs: 1, stars: 3 } },
        words: { w1: { star: false, bestMs: 10 } }, // старая запись без stars → 1
      },
    },
  };
  assert.equal(totalStars(app), 3 + 2 + 1);
  assert.equal(totalStars({ ...app, state: { progress: {} } }), 0);
});

test('themeLabel и backTo: подписи темы, «назад» по params.back или запасному экрану', () => {
  assert.equal(themeLabel('system'), 'Системная');
  assert.equal(themeLabel('light'), 'Светлая');
  assert.equal(themeLabel('dark'), 'Тёмная');
  assert.equal(themeLabel('???'), 'Системная');
  const calls = [];
  const app = { go: (name, params) => calls.push([name, params]) };
  backTo(app, {}, 'home');
  backTo(app, { back: { name: 'game', params: { levelId: 'x' } } }, 'profile');
  let fn = 0;
  backTo(app, { back: () => fn++ }, 'profile');
  assert.deepEqual(calls, [
    ['home', undefined],
    ['game', { levelId: 'x' }],
  ]);
  assert.equal(fn, 1);
});

test('экраны и тексты: профиль и «Специальные возможности» на русском', () => {
  assert.equal(typeof mountSettings, 'function');
  assert.equal(typeof mountA11y, 'function');
  assert.equal(COPY.tagline, 'Любознательный ум. Исследователь линий.');
  assert.equal(PRIVACY_URL, 'https://etoevelina.github.io/roscherk/privacy.html');
  for (const k of ['largeText', 'reduceMotion', 'contrast', 'haptics', 'done']) assert.ok(A11Y_COPY[k], k);
});

test('CSS: эффекты body.a11y-large и body.a11y-contrast на плитки «Слов», файл в сборке', () => {
  const css = readFileSync(new URL('../src/styles/50-profile.css', import.meta.url), 'utf8');
  assert.match(css, /body\.a11y-large \.wv-tile b\s*\{[^}]*calc\(var\(--t\) \* 0\.67\)/);
  assert.match(css, /body\.a11y-large \.wv-acell b/);
  assert.match(css, /body\.a11y-contrast \.wv-tile em/);
  assert.match(css, /body\.a11y-contrast[^{]*\.wv-acell small/);
  assert.ok(cssSources().includes('src/styles/50-profile.css'));
});
