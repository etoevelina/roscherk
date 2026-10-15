// Сборщик уровней «Слов» (§2.5, tools/words.mjs): ответы покрывают буквы цитаты, открытые буквы,
// номера букв, детерминизм, уникальность слов по кампании, формат темы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickClues, chooseGiven, assignNumbers, clueBounds, givenAway, buildWords, clash, levelId, MAX_GIVEN } from '../tools/words.mjs';
import { lettersOf, checkTheme, checkThemes, stemOf, partsIn } from '../tools/words/check-theme.mjs';
import { jsonInlineSafe } from '../tools/build.mjs';

const QUOTE = "After a good dinner one can forgive anybody, even one's own relations.";
const POOL = ['SUCCULENT', 'RAVENOUS', 'MORSEL', 'SIMMER', 'GARNISH', 'PALATE', 'BLAND', 'GOURMET', 'SKEWER', 'HUNGER',
  'WHISK', 'BROTH', 'YEAST', 'FEAST', 'THYME', 'DINER', 'FORAGE', 'VINEGAR', 'ONION', 'GRAVY', 'DOUGH', 'FONDUE', 'BRAISE',
  'NOODLE', 'TENDER', 'RADISH', 'DEVOUR', 'FRUGAL', 'RECIPE', 'BANQUET', 'NIBBLE', 'GRAIN', 'SOUR', 'BAGEL', 'ROAST', 'LEAVEN',
  'GLAZE', 'ADORN', 'DINNER', 'FORGIVE', 'BOTANY', 'WAFER'].map((w) => ({ w, p: 'n', c: 'x', ru: 'х' }));

test('pickClues: покрывает буквы цитаты, число ответов в границах, детерминизм, слова цитаты не загадываются', () => {
  const a = pickClues(QUOTE, POOL, 42);
  const b = pickClues(QUOTE, POOL, 42);
  assert.deepEqual(a.chosen.map((e) => e.w), b.chosen.map((e) => e.w));
  const Q = new Set(lettersOf(QUOTE));
  const covered = new Set(a.chosen.flatMap((e) => [...e.w]));
  const missing = [...Q].filter((ch) => !covered.has(ch));
  assert.deepEqual(missing, a.uncovered);
  assert.ok(a.uncovered.length <= MAX_GIVEN, `непокрыто ${a.uncovered}`);
  assert.ok(a.chosen.length >= a.bounds.min && a.chosen.length <= a.bounds.max);
  assert.ok(!a.chosen.some((e) => e.w === 'DINNER' || e.w === 'FORGIVE'));
  for (const e of a.chosen) {
    const set = new Set(e.w);
    const inQ = [...set].filter((ch) => Q.has(ch)).length;
    assert.ok(inQ / set.size >= 0.5, `${e.w}: больше половины букв — из цитаты`);
  }
});

test('clueBounds и givenAway', () => {
  assert.deepEqual(clueBounds(12), { min: 4, max: 6, target: 5 });
  assert.deepEqual(clueBounds(20), { min: 7, max: 9, target: 8 });
  assert.equal(givenAway('DINNER', ['AFTER', 'DINNER']), true);
  assert.equal(givenAway('TRAVEL', ['TRAVELLING']), true);
  assert.equal(givenAway('DINER', ['DINNER']), false);
});

test('chooseGiven: непокрытые буквы + частые; у каждого ответа ≥ 2 неоткрытые буквы; больше MAX_GIVEN непокрытых — null', () => {
  const clues = [{ w: 'BROTH' }, { w: 'NOODLE' }];
  const g = chooseGiven('the noodle broth', clues, [], 2);
  assert.equal(g.length, 2);
  for (const c of clues) assert.ok(new Set([...c.w].filter((ch) => !g.includes(ch))).size >= 2);
  assert.equal(chooseGiven('abc', clues, ['X', 'Y', 'Z'], 1), null);
  assert.ok(chooseGiven('xylophone broth', clues, ['X', 'Y'], 1).includes('X'));
});

test('assignNumbers: номера 1…K без пропусков и повторов, детерминизм', () => {
  const key = assignNumbers([...'HELLOWORLD'], 7);
  const used = key.filter((n) => n > 0).sort((a, b) => a - b);
  assert.deepEqual(used, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(assignNumbers([...'HELLOWORLD'], 7), key);
  assert.equal(key[25], 0, 'Z не встречается — 0');
});

test('check-theme: формат темы, корень ответа в определении запрещён', () => {
  assert.equal(stemOf('SUCCULENT'), 'succul');
  assert.equal(stemOf('BAKE'), 'bake');
  const theme = {
    slug: 't', ru: 'Т', en: 'T',
    quotes: Array.from({ length: 7 }, (_, i) => ({ q: `Hunger is the best sauce number ${'x'.repeat(i + 1)}.`, a: 'Proverb', ru: 'Голод' })),
    words: Array.from({ length: 95 }, (_, i) => ({ w: `WORD${ABC[i % 26]}${ABC[(i / 26) | 0]}`, p: 'n', c: 'A thing that is clued here', ru: 'слово' })),
  };
  assert.deepEqual(checkTheme(theme).errors, []);
  theme.words[0] = { w: 'SIMMER', p: 'v', c: 'To simmer gently', ru: 'тушить' };
  theme.words[1] = { w: 'bad', p: 'x', c: 'ok', ru: 'en' };
  theme.quotes[0] = { q: 'Ça va «bien»', a: '', ru: 'x' };
  const errs = checkTheme(theme).errors.join('\n');
  assert.match(errs, /корень «simm»/);
  assert.match(errs, /4–11 заглавных/);
  assert.match(errs, /часть речи/);
  assert.match(errs, /недопустимые символы/);
  assert.match(errs, /нет автора/);
});

test('partsIn: определение не должно содержать часть ответа; checkThemes: слово — в одной теме', () => {
  assert.deepEqual(partsIn('BEFRIEND', 'To become a friend to someone'), ['friend']);
  assert.deepEqual(partsIn('WINDSOCK', 'Tube on a pole that shows the wind'), ['wind']);
  assert.deepEqual(partsIn('HEARTBURN', 'A burning pain in the chest'), ['burning']);
  assert.deepEqual(partsIn('MALLEABLE', 'Able to be hammered into shape'), []);
  assert.deepEqual(partsIn('WINDSOCK', 'Fabric tube that shows which way the air is blowing'), []);
  const t = (slug, ws) => ({ slug, words: ws.map((w) => ({ w })) });
  assert.deepEqual(checkThemes([t('a', ['ONE', 'TWO']), t('b', ['THREE'])]), []);
  assert.equal(checkThemes([t('a', ['ONE']), t('b', ['ONE'])]).length, 1);
});

test('clash: ответы с общей частью или определением, называющим другой ответ', () => {
  assert.equal(clash({ w: 'WORKHORSE', c: 'x' }, { w: 'WORKAHOLIC', c: 'y' }), true);
  assert.equal(clash({ w: 'MUMPS', c: 'Painful swelling of glands' }, { w: 'SWELLING', c: 'A raised area' }), true);
  assert.equal(clash({ w: 'BROTH', c: 'Thin soup' }, { w: 'NOODLE', c: 'Long thin pasta' }), false);
});

test('jsonInlineSafe: «<» → \\u003c, JSON разбирается обратно без потерь', () => {
  const raw = JSON.stringify({ c: 'a <!-- b </script> c' });
  const safe = jsonInlineSafe(raw);
  assert.ok(!safe.includes('<'));
  assert.deepEqual(JSON.parse(safe), JSON.parse(raw));
});
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

test('buildWords: темы по порядку, уровни по длине цитаты, слово — один раз, инварианты уровня, детерминизм', () => {
  const mk = (slug, quotes) => ({ slug, ru: slug, en: slug, quotes: quotes.map((q) => ({ q, a: 'Proverb', src: 'Proverb', ru: 'перевод' })), words: POOL });
  const themes = [
    mk('food', [QUOTE, 'Hunger is the best sauce in the world, said the old cook.', 'Too many cooks spoil the broth.']),
    mk('more', ['A good dinner is a fine thing for anybody.', 'Brave words over a warm bowl of broth.']),
  ];
  const { data } = buildWords({ themes, seed: 1, per: 2 });
  const lv = data.words.campaign;
  assert.ok(lv.length >= 3, `уровней ${lv.length}`);
  const seen = new Set();
  let prev = { chapter: 0, L: 0 };
  for (const l of lv) {
    const L = lettersOf(l.quote).length;
    if (l.chapter === prev.chapter) assert.ok(L >= prev.L, 'по возрастанию длины');
    else assert.ok(l.chapter > prev.chapter, 'темы по порядку');
    prev = { chapter: l.chapter, L };
    assert.match(l.id, /^[0-9a-f]{8}$/);
    const nums = l.key.filter((n) => n > 0).sort((a, b) => a - b);
    assert.deepEqual(nums, nums.map((_, i) => i + 1), 'номера 1…K');
    const letters = new Set([...lettersOf(l.quote), ...l.clues.flatMap((c) => [...c.w])]);
    for (const ch of letters) assert.ok(l.key[ABC.indexOf(ch)] > 0, `у ${ch} есть номер`);
    for (const ch of new Set(lettersOf(l.quote))) {
      assert.ok(l.given.includes(ch) || l.clues.some((c) => c.w.includes(ch)), `${ch} цитаты есть в ответах или открыта`);
    }
    for (const c of l.clues) {
      assert.ok(!seen.has(c.w), `${c.w} повторяется`);
      seen.add(c.w);
    }
  }
  assert.deepEqual(buildWords({ themes, seed: 1, per: 2 }).data.words, data.words, 'детерминизм');
  for (const l of lv) assert.equal(l.id, levelId(l.slug, l.quote));
});

test('append-only: выпущенные уровни сохраняются со своими словами при правках темы; пропажа — в lost', () => {
  const mk = (slug, quotes, words = POOL) => ({ slug, ru: slug, en: slug, quotes: quotes.map((q) => ({ q, a: 'Proverb', src: 'Proverb', ru: 'перевод' })), words });
  const quotes = [QUOTE, 'Hunger is the best sauce in the world, said the old cook.', 'Too many cooks spoil the broth.', 'A good dinner is a fine thing for anybody.'];
  const first = buildWords({ themes: [mk('food', quotes)], seed: 1, per: 2 }).data.words.campaign;
  // Правка перевода и определения, новая цитата в начале, новые слова в начале словаря.
  const edited = POOL.map((e) => ({ ...e, c: `${e.c} (edited)`, ru: 'новый перевод' }));
  const more = [{ w: 'BANNOCK', p: 'n', c: 'Flat oat bread', ru: 'лепёшка' }, ...edited];
  const second = buildWords({ themes: [mk('food', ['Eat to live, do not live to eat.', ...quotes], more)], seed: 9, per: 3, lock: first });
  const camp = second.data.words.campaign;
  assert.deepEqual(second.lost, []);
  for (const old of first) {
    const now = camp.find((l) => l.id === old.id);
    assert.ok(now, `уровень ${old.id} на месте`);
    assert.deepEqual(now.clues.map((c) => c.w), old.clues.map((c) => c.w), 'те же слова в том же порядке');
    assert.equal(now.clues[0].ru, 'новый перевод', 'текст слов обновлён');
    assert.deepEqual(now.key, old.key, 'номера букв те же');
  }
  assert.deepEqual(camp.slice(0, first.length).map((l) => l.id), first.map((l) => l.id), 'выпущенные — первыми, в прежнем порядке');
  const gone = buildWords({ themes: [mk('food', quotes.slice(1))], seed: 1, per: 2, lock: first });
  assert.ok(gone.lost.length >= 1, 'удалённая цитата выпущенного уровня — в lost');
});
