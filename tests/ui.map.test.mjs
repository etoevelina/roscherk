// Тесты чистой логики карты уровней и экранов «Режимы» / «Темы „Слов“» (docs/DESIGN.md §5.3–5.5):
// раскладка узлов тропы, состояния и подписи узлов, выбор темы, группы и подписи карточек.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapLayout, nodeState, nodeLabel, resolvePack, chapterName, NODE, STEP, AMP, LABEL_GAP } from '../src/ui/levels.js';
import { wordThemes, groupChips, groupOfLevel, packIdOf, plural, countLine, modeFilter, modeLook, themeLook, MODE_FILTERS, WORD_GROUPS } from '../src/ui/packs.js';
import { levelStatuses } from '../src/core/progress.js';

const lv = (id, chapter, extra = {}) => ({ id, chapter, ...extra });

test('тропа: узлы зигзагом в пределах ±30 % ширины, шаг по вертикали постоянный', () => {
  const levels = Array.from({ length: 20 }, (_, i) => lv(`L${i}`, 1));
  const { nodes, labels, height } = mapLayout(levels);
  assert.equal(nodes.length, 20);
  assert.equal(labels.length, 0);
  assert.equal(nodes[0].x, 0, 'первый узел — по центру');
  for (const n of nodes) assert.ok(Math.abs(n.x) <= AMP + 1e-9, `смещение ${n.x} в пределах ±${AMP}`);
  assert.ok(nodes.some((n) => n.x > 0.25) && nodes.some((n) => n.x < -0.25), 'тропа уходит в обе стороны');
  for (let i = 1; i < nodes.length; i++) assert.equal(nodes[i].y - nodes[i - 1].y, STEP);
  assert.equal(nodes[0].y, NODE / 2);
  assert.equal(height, nodes[19].y + NODE / 2);
});

test('тропа: подписи глав — перед первым узлом главы, между узлами, с запасом места', () => {
  const levels = [lv('a', 1), lv('b', 1), lv('c', 1), lv('d', 2), lv('e', 2), lv('f', 3)];
  const { nodes, labels } = mapLayout(levels, { labels: true });
  assert.deepEqual(
    labels.map((l) => [l.chapter, l.first]),
    [
      [1, 0],
      [2, 3],
      [3, 5],
    ],
  );
  assert.ok(labels[0].y < nodes[0].y - NODE / 2, 'первая подпись выше первого узла');
  for (const l of labels.slice(1)) {
    const prev = nodes[l.first - 1];
    const next = nodes[l.first];
    assert.ok(l.y > prev.y + NODE / 2 && l.y < next.y - NODE / 2, 'подпись между узлами, не на них');
    assert.equal(next.y - prev.y, STEP + LABEL_GAP, 'под подпись добавлено место');
  }
  assert.deepEqual(mapLayout([], { labels: true }), { nodes: [], labels: [], height: 0 });
});

test('узлы: состояния done/current/open/locked/skipped по levelStatuses', () => {
  const levels = Array.from({ length: 8 }, (_, i) => lv(`L${i}`, 1));
  const progress = { L0: { star: true, bestMs: 1000, stars: 3 }, L1: { star: false, bestMs: 2000, stars: 2 } };
  const st = levelStatuses(levels, progress, ['L2']);
  const states = st.map((s, i) => nodeState(s, i === 3));
  assert.deepEqual(states, ['done', 'done', 'skipped', 'current', 'open', 'open', 'locked', 'locked']);
});

test('узлы: подписи для VoiceOver', () => {
  assert.equal(nodeLabel(12, 'done', { stars: 2, bestMs: 41000 }), 'Уровень 12, пройден, 2 звезды из 3, лучшее 0:41');
  assert.equal(nodeLabel(3, 'done', { stars: 1 }), 'Уровень 3, пройден, 1 звезда из 3');
  assert.equal(nodeLabel(13, 'current'), 'Уровень 13, текущий');
  assert.equal(nodeLabel(13, 'current', { resume: true }), 'Уровень 13, текущий, начат');
  assert.equal(nodeLabel(14, 'open'), 'Уровень 14, открыт');
  assert.equal(nodeLabel(15, 'locked'), 'Уровень 15, закрыт');
  assert.equal(nodeLabel(9, 'skipped'), 'Уровень 9, пропущен');
});

test('карта «Слов»: тема по pack (slug или номер), уровню, прерванной партии, последней карте, следующему', () => {
  const campaign = [lv('a', 1, { slug: 'home' }), lv('b', 1, { slug: 'home' }), lv('c', 2, { slug: 'food' }), lv('d', 3, { slug: 'travel' })];
  assert.equal(resolvePack(campaign, { pack: 'food' }), 2);
  assert.equal(resolvePack(campaign, { pack: '3' }), 3);
  assert.equal(resolvePack(campaign, { pack: 'nope', levelId: 'd' }), 3);
  assert.equal(resolvePack(campaign, {}, { kind: 'campaign', levelId: 'c' }), 2);
  assert.equal(resolvePack(campaign, {}, { kind: 'daily', levelId: 'c' }, 3), 3);
  assert.equal(resolvePack(campaign, {}, null, -1), 1);
  assert.equal(resolvePack(campaign, {}, null, 0, 3), 3, 'последняя открытая тема важнее следующего уровня');
  assert.equal(resolvePack(campaign, {}, { kind: 'campaign', levelId: 'c' }, 0, 3), 2, 'прерванная партия важнее');
  assert.equal(resolvePack(campaign, {}, null, 2, 9), 2, 'несуществующая тема пропускается');
  assert.equal(resolvePack([], { pack: 'food' }), null);
});

test('названия глав: темы режима, «Глава 2 · Шарик» у «Карандаша», «Глава 3» у прочих', () => {
  const words = { chapterTitle: (c, l) => l.theme };
  assert.equal(chapterName(words, 4, { theme: { ru: 'Природа', en: 'Nature' } }), 'Природа');
  assert.equal(chapterName({}, 2, { type: 'ball' }), 'Глава 2 · Шарик');
  assert.equal(chapterName({}, 3, { type: 'swarm' }), 'Глава 3 · Рой');
  assert.equal(chapterName({}, 3, {}), 'Глава 3');
});

test('темы «Слов»: группировка по главам, счёт пройденных, группы и чипы', () => {
  const campaign = [
    lv('a', 1, { slug: 'home', theme: { ru: 'Дом и быт', en: 'Home' } }),
    lv('b', 1, { slug: 'home', theme: { ru: 'Дом и быт', en: 'Home' } }),
    lv('c', 2, { slug: 'science', theme: { ru: 'Наука', en: 'Science' } }),
    lv('d', 3, { slug: 'art', theme: { ru: 'Искусство', en: 'Art' } }),
    lv('e', 4, { slug: 'unknown', theme: { ru: 'Прочее', en: 'Misc' } }),
  ];
  const themes = wordThemes(campaign, { a: { bestMs: 10 }, d: { bestMs: 5 } });
  assert.deepEqual(
    themes.map((t) => [t.pack, t.chapter, t.order, t.total, t.done, t.group]),
    [
      ['home', 1, 0, 2, 1, 'world'],
      ['science', 2, 1, 1, 0, 'mind'],
      ['art', 3, 2, 1, 1, 'culture'],
      ['unknown', 4, 3, 1, 0, null],
    ],
  );
  assert.deepEqual(
    groupChips(themes).map((c) => c.id),
    ['all', 'world', 'mind', 'culture'],
  );
  // Меньше двух групп — только «Все».
  assert.deepEqual(groupChips(themes.slice(0, 1)).map((c) => c.id), ['all']);
  assert.equal(groupOfLevel({ slug: 'home', group: 'Культура' }), 'culture', 'поле group в данных важнее slug');
  assert.equal(packIdOf({ chapter: 7 }), '7');
});

test('темы «Слов» из words.json: у каждой темы группа, pack уникален, чипы — все группы', () => {
  const data = JSON.parse(readFileSync(new URL('../src/data/words.json', import.meta.url), 'utf8'));
  const themes = wordThemes(data.words.campaign, {});
  assert.ok(themes.length >= 4);
  for (const t of themes) assert.ok(t.group, `у темы ${t.pack} есть группа`);
  assert.equal(new Set(themes.map((t) => t.pack)).size, themes.length, 'pack темы уникален');
  assert.equal(groupChips(themes).length, WORD_GROUPS.length + 1);
});

test('подписи карточек: склонения и «всё пройдено»', () => {
  assert.equal(plural(1, ['уровень', 'уровня', 'уровней']), 'уровень');
  assert.equal(plural(21, ['уровень', 'уровня', 'уровней']), 'уровень');
  assert.equal(plural(3, ['уровень', 'уровня', 'уровней']), 'уровня');
  assert.equal(plural(12, ['уровень', 'уровня', 'уровней']), 'уровней');
  assert.equal(plural(100, ['уровень', 'уровня', 'уровней']), 'уровней');
  assert.equal(countLine(100, 12), '100 уровней · пройдено 12');
  assert.equal(countLine(5, 2, ['цитата', 'цитаты', 'цитат']), '5 цитат · пройдено 2');
  assert.equal(countLine(5, 5, ['цитата', 'цитаты', 'цитат']), '5 цитат · всё пройдено');
  assert.equal(countLine(0, 0), 'Скоро');
});

test('«Режимы»: фильтры и семейства режимов', () => {
  assert.deepEqual(
    MODE_FILTERS.map((f) => f.label),
    ['Все', 'Линии', 'Слова', 'Физика'],
  );
  assert.deepEqual(
    ['zip', 'flow', 'stroke', 'words', 'draw'].map((id) => modeFilter({ id })),
    ['lines', 'lines', 'lines', 'words', 'physics'],
  );
  assert.equal(modeFilter({ id: 'new', dom: true }), 'words');
  assert.deepEqual(
    ['zip', 'flow', 'stroke', 'words', 'draw'].map((id) => modeLook(id).family),
    ['sage', 'blue', 'blush', 'lav', 'mist'],
  );
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((i) => themeLook(i).family),
    ['sage', 'blue', 'blush', 'lav', 'sage'],
  );
});
