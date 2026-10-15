// Режим «Слова» (§2.5, механика Lumin «одна цифра — одна буква»): номера букв, распространение
// по номеру, курсор, ⌫, ошибки без штрафа, подсказки из шторки, победа, снимки, точность.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import words, { quoteLetters, tokenize, lettersWord, cellNum, selNum, wordSolved, MSG_WRONG } from '../src/modes/words.js';

const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
// Номера: H1 U2 N3 G4 E5 R6 I7 S8 T9 B10 A11 C12 L13 M14 (буквы цитаты и ответов).
const NUM = { H: 1, U: 2, N: 3, G: 4, E: 5, R: 6, I: 7, S: 8, T: 9, B: 10, A: 11, C: 12, L: 13, M: 14 };
const KEY = [...ABC].map((ch) => NUM[ch] || 0);
const LEVEL = {
  id: 'test0001',
  chapter: 1,
  theme: { ru: 'Еда', en: 'Food' },
  quote: 'Hunger is the best sauce.',
  author: 'Proverb',
  src: 'Proverb',
  ru: 'Голод — лучшая приправа.',
  clues: [
    { w: 'BRUSH', p: 'n', c: 'Tool with bristles', ru: 'щётка' },
    { w: 'CLING', p: 'v', c: 'To hold on tightly', ru: 'цепляться' },
    { w: 'MAGNET', p: 'n', c: 'It attracts iron', ru: 'магнит' },
  ],
  key: KEY,
  given: 'E',
};
const QUOTE = quoteLetters(LEVEL.quote).join(''); // HUNGERISTHEBESTSAUCE

const kinds = (events) => events.map((e) => e.kind);
/** Набрать буквы, каждый раз — правильную для текущей клетки. */
const solveAll = (st) => {
  for (let guard = 0; guard < 100 && !words.isSolved(st); guard++) {
    const n = selNum(st);
    words.key(st, st.letterOf[n], guard);
  }
};

test('номера: одна буква — один номер, открытые буквы — во всех клетках', () => {
  const st = words.create(LEVEL);
  assert.equal(st.K, 14);
  assert.equal(QUOTE, 'HUNGERISTHEBESTSAUCE');
  assert.deepEqual(st.qnum.slice(0, 5), [1, 2, 3, 4, 5]);
  assert.equal(st.guess[5], 'E', 'E открыта');
  assert.deepEqual(st.anum[2], [14, 11, 4, 3, 5, 9]);
  assert.equal(st.sel.z, 'a');
  assert.equal(st.sel.k, 0, 'курсор на первом ответе');
  assert.equal(words.isSolved(st), false);
});

test('буква ставится по номеру во все клетки (цитата и ответы), курсор идёт к пустой клетке слова', () => {
  const st = words.create(LEVEL);
  // BRUSH: B10 R6 U2 S8 H1
  const ev = words.key(st, 'B', 1);
  assert.deepEqual(kinds(ev), ['changed', 'step']);
  assert.equal(st.guess[10], 'B');
  assert.equal(selNum(st), 6, 'следующая клетка ответа — R');
  words.key(st, 'R', 2);
  words.key(st, 'U', 3);
  assert.equal(st.guess[2], 'U');
  assert.equal(cellNum(st, 'q', 0, 1), 2, 'U цитаты — тот же номер');
  words.key(st, 'S', 4);
  const done = words.key(st, 'H', 5);
  const complete = done.find((e) => e.kind === 'complete');
  assert.ok(complete, 'BRUSH отгадан');
  assert.deepEqual(complete.message, { ru: 'brush — щётка', en: 'brush — щётка' });
  assert.ok(wordSolved(st, 0));
  assert.equal(st.sel.k, 1, 'курсор на следующем ответе');
  assert.deepEqual(words.footer(st), { ru: 'слов 1/3', en: 'words 1/3' });
});

test('неверная буква — miss без штрафа: остаётся, точность падает, исправление — без звука отказа', () => {
  const st = words.create(LEVEL);
  const ev = words.key(st, 'X', 1);
  assert.deepEqual(kinds(ev), ['changed', 'miss']);
  assert.equal(st.guess[10], 'X');
  assert.equal(st.fx.kind, 'err');
  assert.equal(st.bad, 1);
  assert.equal(st.ent, 1);
  words.tap(st, { z: 'a', k: 0, i: 0 });
  words.key(st, 'B', 2);
  assert.equal(st.guess[10], 'B');
  assert.equal(words.stats(st).accuracy, 50);
});

test('тап по открытой клетке не выделяет её; тап по цитате выбирает ответ с этим номером', () => {
  const st = words.create(LEVEL);
  assert.deepEqual(words.tap(st, { z: 'q', i: 4 }), [], 'E открыта');
  assert.deepEqual(kinds(words.tap(st, { z: 'q', i: 3 })), ['select']); // G
  assert.equal(selNum(st), 4);
  assert.equal(st.sel.z, 'q');
  assert.equal(st.cur, 1, 'G есть в CLING (первый нерешённый)');
  words.key(st, 'G', 1);
  assert.equal(st.sel.i, 5, 'к следующей пустой клетке цитаты, мимо открытой E');
  assert.deepEqual(words.tap(st, { z: 'q', i: 999 }), []);
  assert.deepEqual(words.tap(st, null), []);
});

test('фишка и стрелки: выбор ответа и курсор на первую пустую клетку', () => {
  const st = words.create(LEVEL);
  words.tap(st, { clue: 2 });
  assert.equal(st.sel.k, 2);
  assert.equal(st.sel.i, 0);
  words.tap(st, { step: 1 });
  assert.equal(st.cur, 0, 'по кругу');
  words.tap(st, { step: -1 });
  assert.equal(st.cur, 2);
  // MAGNET: E (i=4) открыта — пропускается
  words.key(st, 'M', 1);
  words.key(st, 'A', 2);
  words.key(st, 'G', 3);
  words.key(st, 'N', 4);
  assert.equal(st.sel.i, 5, 'открытая E пропущена');
});

test('⌫: стирает номер выделенной клетки, а если пусто — предыдущую; открытые не стираются', () => {
  const st = words.create(LEVEL);
  words.key(st, 'B', 1);
  words.key(st, 'R', 2);
  assert.equal(st.sel.i, 2);
  let ev = words.key(st, 'Backspace', 3);
  assert.deepEqual(kinds(ev), ['changed']);
  assert.equal(st.guess[6], '');
  assert.equal(st.sel.i, 1);
  ev = words.key(st, 'Backspace', 4);
  assert.equal(st.guess[10], '', 'выделенная пуста — шаг назад и стереть B');
  assert.equal(st.sel.i, 0);
  ev = words.key(st, 'Backspace', 5);
  assert.deepEqual(ev, [], 'в начале слова двигаться некуда');
  assert.equal(st.guess[5], 'E', 'открытая не стирается');
});

test('вся цитата заполнена с ошибкой → notice; исправили → solved; после победы ввод игнорируется', () => {
  const st = words.create(LEVEL);
  // Заполнить цитату по клеткам, U — неверно
  words.tap(st, { z: 'q', i: 0 });
  let last = [];
  for (let s = 0; s < 40; s++) {
    const n = selNum(st);
    if (st.guess[n]) break;
    last = words.key(st, n === 2 ? 'O' : st.letterOf[n], s);
  }
  assert.ok(last.some((e) => e.kind === 'notice' && e.message === MSG_WRONG), 'notice об ошибках');
  assert.equal(words.isSolved(st), false);
  words.tap(st, { z: 'q', i: 1 });
  const fix = words.key(st, 'U', 99);
  assert.ok(kinds(fix).includes('solved'));
  assert.equal(words.isSolved(st), true);
  assert.deepEqual(words.key(st, 'A', 100), []);
  assert.deepEqual(words.tap(st, { clue: 0 }), []);
});

test('подсказки: перевод, проверка ответа, буква по номеру; варианты шторки отражают состояние', () => {
  const st = words.create(LEVEL);
  let opts = words.hintOptions(st);
  assert.deepEqual(opts.map((o) => o.id), ['letter', 'check', 'translate']);
  assert.equal(opts.find((o) => o.id === 'check').disabled, true, 'проверять нечего');
  let r = words.hint(st, 0, 'translate');
  assert.equal(r.kind, 'translate');
  assert.ok(st.shown.has(0));
  assert.equal(st.hintUsed, true);
  assert.equal(words.hintOptions(st).find((o) => o.id === 'translate').disabled, true);
  words.key(st, 'Q', 1); // B ← неверно
  words.key(st, 'R', 2);
  r = words.hint(st, 3, 'check');
  assert.deepEqual([r.kind, r.wrong], ['check', 1]);
  assert.equal(st.chk[10], 1, 'неверная Q помечена');
  words.tap(st, { z: 'a', k: 0, i: 0 });
  words.key(st, 'B', 4);
  assert.equal(st.chk[10], 0, 'исправление снимает пометку');
  r = words.hint(st, 5, 'letter');
  assert.equal(r.kind, 'cells');
  assert.equal(st.guess[r.num], st.letterOf[r.num]);
  assert.equal(st.rev[r.num], 1);
  assert.equal(st.hints, 3);
  const ent = st.ent;
  words.hint(st, 6, 'letter');
  assert.equal(st.ent, ent, 'подсказка — не ввод игрока');
  opts = words.hintOptions(st);
  assert.ok(opts.every((o) => typeof o.label.ru === 'string' && typeof o.detail.ru === 'string'));
});

test('подсказки «буква» до конца решают уровень; на решённом — none без hintUsed', () => {
  const st = words.create(LEVEL);
  for (let i = 0; i < 40 && !words.isSolved(st); i++) words.hint(st, i, 'letter');
  assert.ok(words.isSolved(st));
  const st2 = words.create(LEVEL);
  solveAll(st2);
  assert.ok(words.isSolved(st2));
  assert.deepEqual(words.hint(st2, 0, 'letter'), { kind: 'none' });
  assert.equal(st2.hintUsed, false);
  assert.equal(words.stats(st2).accuracy, 100);
});

test('serialize → create: догадки по номерам, выделение, пометки, точность; мусор игнорируется', () => {
  const st = words.create(LEVEL);
  words.key(st, 'B', 1);
  words.key(st, 'Z', 2);
  words.hint(st, 3, 'translate');
  words.hint(st, 4, 'check');
  const snap = JSON.parse(JSON.stringify(words.serialize(st)));
  assert.equal(snap.g.length, 14);
  const back = words.create(LEVEL, snap);
  assert.deepEqual(back.guess, st.guess);
  assert.deepEqual(back.sel, st.sel);
  assert.deepEqual([...back.chk], [...st.chk]);
  assert.deepEqual([...back.shown], [...st.shown]);
  assert.deepEqual([back.ent, back.bad, back.hints, back.hintUsed], [st.ent, st.bad, st.hints, true]);
  const junk = words.create(LEVEL, { g: 'Q'.repeat(14), sel: ['x', 9, 9], shown: [7, -1], rev: [5, 99, 'a'], chk: [3], hints: -1, ent: 2, bad: 9 });
  assert.equal(junk.guess[5], 'E', 'открытая не перезаписана');
  assert.equal(junk.guess[1], 'Q');
  assert.equal(junk.rev[5], 0);
  assert.equal(junk.chk[3], 1, 'Q на месте N неверна — пометка допустима');
  assert.equal(junk.shown.size, 0);
  assert.equal(junk.hints, 0);
  assert.ok(junk.bad <= junk.ent);
  assert.ok(junk.sel && junk.sel.z === 'a');
  const short = words.create(LEVEL, { g: 'AB' });
  assert.equal(short.guess.filter(Boolean).length, 1, 'снимок другой длины не применяется');
});

test('reset: остаются открытые буквы; переводы, подсказки и точность сохраняются', () => {
  const st = words.create(LEVEL);
  words.key(st, 'B', 1);
  words.key(st, 'X', 2);
  words.hint(st, 3, 'translate');
  words.reset(st);
  assert.equal(st.guess.filter(Boolean).length, 1);
  assert.equal(st.hintUsed, true);
  assert.equal(st.shown.size, 1);
  assert.equal(st.ent, 2);
  assert.ok(st.sel);
});

test('Left/Right/Next двигают курсор без изменений поля', () => {
  const st = words.create(LEVEL);
  assert.deepEqual(kinds(words.key(st, 'Right', 0)), ['select']);
  assert.equal(st.sel.i, 1);
  words.key(st, 'Left', 0);
  assert.equal(st.sel.i, 0);
  assert.deepEqual(words.key(st, 'Left', 0), [], 'начало слова');
  words.key(st, 'Next', 0);
  assert.equal(st.cur, 1);
  assert.equal(st.guess.filter(Boolean).length, 1);
});

test('tokenize: перенос по словам, длинное тире — точка переноса; lettersWord склоняет', () => {
  assert.deepEqual(
    tokenize("It is large—'tis lightning.").map((t) => [t.text, t.space]),
    [['It', true], ['is', true], ['large—', true], ["'tis", false], ['lightning.', true]],
  );
  assert.deepEqual([1, 2, 4, 5, 11, 12, 21, 22].map(lettersWord), ['1 буква', '2 буквы', '4 буквы', '5 букв', '11 букв', '12 букв', '21 буква', '22 буквы']);
});

test('stats, заголовок, тема, метаданные ответа', () => {
  const st = words.create(LEVEL);
  const s = words.stats(st);
  assert.deepEqual(s.quote, { text: LEVEL.quote, author: 'Proverb', src: 'Proverb', ru: LEVEL.ru });
  assert.deepEqual(s.vocab.map((v) => v.w), ['BRUSH', 'CLING', 'MAGNET']);
  assert.equal(s.accuracy, 100);
  assert.deepEqual(words.chapterTitle(1, LEVEL), { ru: 'Еда', en: 'Food' });
  assert.deepEqual(words.titleFor(LEVEL, 0, [LEVEL]), { ru: 'Еда · 1/1', en: 'Food · 1/1' });
  assert.deepEqual(words.metaOf(LEVEL.clues[2]), { ru: 'сущ. · 6 букв', en: 'n. · 6 letters' });
  assert.equal(words.dom, true);
  assert.equal(words.layout(), null);
  assert.equal(words.render(), false);
  assert.deepEqual(words.pointer(), []);
});

test('перепечатка заполненного ответа: курсор идёт по клеткам этого же ответа', () => {
  const st = words.create(LEVEL);
  for (const ch of 'BRQSH') words.key(st, ch, 1); // опечатка в U
  assert.equal(st.sel.k, 1, 'ответ заполнен — курсор ушёл к следующему');
  words.tap(st, { z: 'a', k: 0, i: 0 });
  words.key(st, 'B', 2);
  assert.equal(st.sel.k, 0, 'после первой буквы курсор остался в ответе A');
  assert.equal(st.sel.i, 1);
  words.key(st, 'R', 3);
  words.key(st, 'U', 4);
  assert.ok(wordSolved(st, 0), 'опечатка исправлена перепечаткой');
});

test('проверка уже отгаданного ответа — none, звезда не теряется', () => {
  const st = words.create(LEVEL);
  for (const ch of 'BRUSH') words.key(st, ch, 1);
  words.tap(st, { clue: 0 });
  assert.deepEqual(words.hint(st, 2, 'check'), { kind: 'none' });
  assert.equal(st.hintUsed, false);
});
