// Данные «Слов» (§2.5, src/data/words.json): 20 тем × 5 уровней, номера букв, открытые буквы,
// покрытие цитаты ответами, id по содержимому, слова не повторяются, каждый уровень решается.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEME_ORDER, MAX_CLUES, MIN_CLUES, MAX_GIVEN, ONBOARDING_LETTERS, givenAway, quoteWords, levelId, clash } from '../tools/words.mjs';
import words, { quoteLetters, selNum } from '../src/modes/words.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PATH = resolve(ROOT, 'src/data/words.json');
const data = existsSync(PATH) ? JSON.parse(readFileSync(PATH, 'utf8')) : null;
const levels = data?.words?.campaign || [];
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

test('words.json: 20 тем × 5 уровней, главы 1…20 подряд, одна тема на главу', () => {
  assert.ok(data, 'нет src/data/words.json — npm run words');
  assert.equal(levels.length, THEME_ORDER.length * 5);
  for (let ch = 1; ch <= THEME_ORDER.length; ch++) {
    const list = levels.filter((l) => l.chapter === ch);
    assert.equal(list.length, 5, `тема ${ch}`);
    assert.ok(list.every((l) => l.theme.ru === list[0].theme.ru));
  }
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i].chapter >= levels[i - 1].chapter);
});

test('каждый уровень: номера 1…K, буквы цитаты покрыты ответами или открыты, ≤ 2 открытых, 4–10 ответов, id', () => {
  const ids = new Set();
  for (const l of levels) {
    const where = `${l.id} «${l.quote.slice(0, 30)}…»`;
    assert.equal(l.slug, THEME_ORDER[l.chapter - 1], `${where}: slug темы`);
    assert.equal(l.id, levelId(l.slug, l.quote), `${where}: id = тема + цитата`);
    assert.ok(!ids.has(l.id), `${where}: дубликат`);
    ids.add(l.id);
    assert.ok(l.clues.length >= MIN_CLUES && l.clues.length <= MAX_CLUES, `${where}: ответов ${l.clues.length}`);
    assert.equal(l.key.length, 26);
    const nums = l.key.filter((n) => n > 0).sort((a, b) => a - b);
    assert.deepEqual(nums, nums.map((_, i) => i + 1), `${where}: номера`);
    const qLetters = new Set(quoteLetters(l.quote));
    const all = new Set([...qLetters, ...l.clues.flatMap((c) => [...c.w])]);
    assert.equal(nums.length, all.size, `${where}: номера ровно у букв уровня`);
    assert.ok(l.given.length >= 1 && l.given.length <= MAX_GIVEN, `${where}: открытых ${l.given}`);
    for (const ch of qLetters) assert.ok(l.given.includes(ch) || l.clues.some((c) => c.w.includes(ch)), `${where}: ${ch} не покрыта`);
    for (const c of l.clues) {
      assert.match(c.w, /^[A-Z]{4,11}$/);
      assert.ok(c.c && c.ru && ['n', 'v', 'adj', 'adv'].includes(c.p), `${where}: поля ${c.w}`);
      assert.ok(new Set([...c.w].filter((ch) => !l.given.includes(ch))).size >= 2, `${where}: ${c.w} почти открыт`);
    }
    assert.ok(l.author && l.ru && l.theme.ru && l.theme.en, `${where}: автор, перевод, тема`);
  }
});

test('ответы одного уровня не подсказывают друг друга (общие части, определение называет другой ответ)', () => {
  for (const l of levels) {
    for (let a = 0; a < l.clues.length; a++) {
      for (let b = a + 1; b < l.clues.length; b++) assert.ok(!clash(l.clues[a], l.clues[b]), `${l.id}: ${l.clues[a].w} ↔ ${l.clues[b].w}`);
    }
  }
});

test('слова не повторяются по кампании и не подсказаны своей цитатой', () => {
  const seen = new Map();
  for (const l of levels) {
    const qw = quoteWords(l.quote);
    for (const c of l.clues) {
      assert.ok(!seen.has(c.w), `${c.w} уже был в ${seen.get(c.w)}`);
      seen.set(c.w, l.id);
      assert.ok(!givenAway(c.w, qw), `${c.w} подсказан цитатой ${l.id}`);
    }
  }
  assert.ok(seen.size >= 500, `слов в кампании ${seen.size}`);
});

test('каждый уровень решается вводом и подсказками, снимок восстанавливается', () => {
  for (const l of levels) {
    const st = words.create(l);
    for (let i = 0; i < 400 && !words.isSolved(st); i++) words.key(st, st.letterOf[selNum(st)] || 'A', i);
    assert.ok(words.isSolved(st), `${l.id}: ввод`);
    const st2 = words.create(l);
    for (let i = 0; i < 60 && !words.isSolved(st2); i++) words.hint(st2, i, 'letter');
    assert.ok(words.isSolved(st2), `${l.id}: подсказки`);
    assert.ok(words.isSolved(words.create(l, words.serialize(st))));
  }
});

test('первый уровень кампании — короткая цитата для знакомства', () => {
  assert.ok(quoteLetters(levels[0].quote).length <= ONBOARDING_LETTERS, levels[0].quote);
  assert.ok(ABC.length === 26);
});
