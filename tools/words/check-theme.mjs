// Проверка формата файла темы режима «Слова» (tools/words/themes/<slug>.json).
//   node tools/words/check-theme.mjs tools/words/themes/food.json [...]
// Печатает ошибки и предупреждения; код выхода 1 при ошибках. Используется и авторами контента,
// и tools/words.mjs перед сборкой уровней.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const POS = ['n', 'v', 'adj', 'adv'];
export const MIN_QUOTES = 7;
export const MIN_WORDS = 95;
export const QUOTE_LETTERS = [20, 110];
// Разрешённые символы цитаты: латиница, пробел и типографская пунктуация (без кавычек-ёлочек).
const QUOTE_RE = /^[A-Za-z ,.;:!?'"()\-—]+$/;
const CYR_RE = /[А-Яа-яЁё]/;

export const lettersOf = (s) => s.toUpperCase().replace(/[^A-Z]/g, '');

/** Короткие слова, случайно входящие в ответы (MALLEABLE ← able): не считаются подсказкой. */
export const PART_OK = new Set(['able', 'over', 'ever', 'here', 'there', 'other', 'ally', 'tion', 'ness', 'ment', 'less', 'some', 'what', 'when', 'into', 'once', 'only', 'then', 'them', 'they', 'also', 'more', 'most', 'much', 'with', 'that', 'this', 'your', 'from', 'were', 'have', 'been', 'will', 'such', 'each', 'very', 'like', 'make', 'made', 'used', 'uses', 'used', 'just', 'long', 'well', 'part', 'kind', 'form', 'done', 'gone', 'come', 'take', 'thing', 'person', 'people']);

/**
 * partsIn(answer, clue) → слова определения (≥ 4 букв, без окончаний -s/-es/-ed/-ing/-ly), которые
 * целиком входят в ответ: BEFRIEND ← «friend», WINDSOCK ← «wind», HEARTBURN ← «burning».
 */
export function partsIn(answer, clue) {
  const W = String(answer).toLowerCase();
  const out = [];
  for (const tok of String(clue).toLowerCase().match(/[a-z]+/g) || []) {
    if (tok.length < 4 || PART_OK.has(tok)) continue;
    const base = tok.replace(/(ies)$/, 'y').replace(/(es|s|ed|ing|ly)$/, '');
    for (const t of new Set([tok, base])) if (t.length >= 4 && !PART_OK.has(t) && W.includes(t)) out.push(tok);
  }
  return [...new Set(out)];
}

/** Корень слова для проверки «ответ не подсказан в определении». */
export function stemOf(word) {
  const w = word.toLowerCase();
  return w.slice(0, Math.max(4, w.length - 3));
}

/** checkThemes(themes) → ошибки между темами: одно слово — одна тема (§2.5: слово — один раз в кампании). */
export function checkThemes(themes) {
  const errors = [];
  const where = new Map();
  for (const t of themes) {
    for (const e of t.words || []) {
      if (where.has(e.w) && where.get(e.w) !== t.slug) errors.push(`${e.w}: в темах ${where.get(e.w)} и ${t.slug} — оставь в одной`);
      else where.set(e.w, t.slug);
    }
  }
  return errors;
}

/** checkTheme(obj) → { errors: [], warnings: [] }. */
export function checkTheme(theme, where = 'theme') {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(`${where}: ${m}`);
  const warn = (m) => warnings.push(`${where}: ${m}`);
  if (!theme || typeof theme !== 'object') {
    err('не объект');
    return { errors, warnings };
  }
  for (const k of ['slug', 'ru', 'en']) if (typeof theme[k] !== 'string' || !theme[k].trim()) err(`нет поля ${k}`);
  if (!Array.isArray(theme.quotes)) err('нет массива quotes');
  if (!Array.isArray(theme.words)) err('нет массива words');
  if (errors.length) return { errors, warnings };

  if (theme.quotes.length < MIN_QUOTES) err(`цитат ${theme.quotes.length} < ${MIN_QUOTES}`);
  const seenQ = new Set();
  theme.quotes.forEach((q, i) => {
    const at = `quotes[${i}]`;
    if (!q || typeof q.q !== 'string') return err(`${at}: нет текста q`);
    if (!QUOTE_RE.test(q.q)) err(`${at}: недопустимые символы в «${q.q}» (только латиница, пробел и , . ; : ! ? ' " ( ) - —)`);
    if (/\s{2,}/.test(q.q) || q.q !== q.q.trim()) err(`${at}: лишние пробелы`);
    const n = lettersOf(q.q).length;
    if (n < QUOTE_LETTERS[0] || n > QUOTE_LETTERS[1]) err(`${at}: букв ${n}, нужно ${QUOTE_LETTERS[0]}–${QUOTE_LETTERS[1]}`);
    const longest = Math.max(...q.q.split(/[\s—]+/).map((t) => t.length));
    if (longest > 14) err(`${at}: слишком длинное слово в цитате (${longest} символов) — не влезет в строку сетки`);
    if (typeof q.a !== 'string' || !q.a.trim()) err(`${at}: нет автора a`);
    if (typeof q.ru !== 'string' || !CYR_RE.test(q.ru)) err(`${at}: нет русского перевода ru`);
    for (const f of ['ru', 'a', 'src']) if (typeof q[f] === 'string' && /[<>]/.test(q[f])) err(`${at}: символы < > в поле ${f} запрещены`);
    const key = lettersOf(q.q);
    if (seenQ.has(key)) err(`${at}: дубликат цитаты`);
    seenQ.add(key);
  });

  if (theme.words.length < MIN_WORDS) err(`слов ${theme.words.length} < ${MIN_WORDS}`);
  const seenW = new Set();
  theme.words.forEach((e, i) => {
    const at = `words[${i}]`;
    if (!e || typeof e.w !== 'string') return err(`${at}: нет слова w`);
    if (!/^[A-Z]{4,11}$/.test(e.w)) err(`${at}: «${e.w}» — нужно 4–11 заглавных латинских букв`);
    if (seenW.has(e.w)) err(`${at}: дубликат ${e.w}`);
    seenW.add(e.w);
    if (!POS.includes(e.p)) err(`${at} ${e.w}: часть речи p должна быть одной из ${POS.join(', ')}`);
    if (typeof e.c !== 'string' || e.c.length < 8 || e.c.length > 80) err(`${at} ${e.w}: определение c — 8–80 символов`);
    else {
      if (CYR_RE.test(e.c)) err(`${at} ${e.w}: определение должно быть на английском`);
      if (e.c.toLowerCase().includes(stemOf(e.w))) err(`${at} ${e.w}: определение содержит само слово или его корень «${stemOf(e.w)}»`);
      const parts = partsIn(e.w, e.c);
      if (parts.length) err(`${at} ${e.w}: определение содержит часть ответа «${parts.join('», «')}»`);
      if (/[<>]/.test(e.c) || /[<>]/.test(e.ru)) err(`${at} ${e.w}: символы < > в тексте запрещены`);
    }
    if (typeof e.ru !== 'string' || !CYR_RE.test(e.ru) || e.ru.length > 50) err(`${at} ${e.w}: перевод ru — по-русски, до 50 символов`);
  });
  return { errors, warnings };
}

function main(files) {
  let bad = 0;
  for (const f of files) {
    let theme;
    try {
      theme = JSON.parse(readFileSync(resolve(f), 'utf8'));
    } catch (e) {
      console.error(`✗ ${f}: не JSON — ${e.message}`);
      bad++;
      continue;
    }
    const { errors, warnings } = checkTheme(theme, f);
    for (const w of warnings) console.warn(`! ${w}`);
    for (const e of errors) console.error(`✗ ${e}`);
    if (errors.length) bad++;
    else {
      const lens = theme.quotes.map((q) => lettersOf(q.q).length).sort((a, b) => a - b);
      console.log(`✓ ${f}: цитат ${theme.quotes.length} (букв ${lens.join(', ')}), слов ${theme.words.length}`);
    }
  }
  if (files.length > 1) {
    const themes = files.map((f) => {
      try {
        return JSON.parse(readFileSync(resolve(f), 'utf8'));
      } catch {
        return null;
      }
    }).filter(Boolean);
    const cross = checkThemes(themes);
    for (const e of cross) console.error(`✗ ${e}`);
    if (cross.length) bad++;
  }
  if (bad) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
