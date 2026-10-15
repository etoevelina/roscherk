// Сборка уровней режима «Слова» (§2.5): tools/words/themes/<slug>.json → src/data/words.json.
//   node tools/words.mjs [--seed 20260101] [--out src/data/words.json] [--per 5] [--quiet] [--partial]
// Механика Lumin «одна цифра — одна буква»: у каждой буквы свой номер, ответы покрывают все буквы
// цитаты, кроме 1–2 открытых. Для каждой темы (в порядке THEME_ORDER) подбираются ещё не
// использованные слова темы (рандомизированный жадный набор, детерминированно от seed), из годных
// цитат берутся 5 разной длины, номера букв перемешиваются.
// Стабильность (§2.5): id уровня = sha1({ slug, quote }) — правка определений, переводов и порядок
// тем его не меняют. Выпущенные уровни (прежний src/data/words.json) сохраняются со своими словами,
// новые дописываются в конец темы; если уровень пропал бы — сборка падает (флаг --replace разрешает,
// --fresh собирает с нуля).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTheme, checkThemes, lettersOf, stemOf } from './words/check-theme.mjs';
import { mulberry32, hash32 } from '../src/core/rng.js';
import { contentId } from '../src/core/hash.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const THEME_ORDER = [
  'home', 'food', 'travel', 'nature', 'weather', 'emotions', 'character', 'love', 'work', 'money',
  'science', 'tech', 'health', 'mind', 'art', 'books', 'law', 'society', 'history', 'language',
];
export const DEFAULT_SEED = 20260101;
export const LEVELS_PER_THEME = 5;
export const MIN_CLUES = 4;
export const MAX_CLUES = 10;
export const MAX_GIVEN = 2; // открытых букв не больше
export const ONBOARDING_LETTERS = 40; // первый уровень кампании — короткая цитата
const RUNS = 400;
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Число ответов для цитаты с D разными буквами: около D / 2.4, в пределах 4…10. */
export function clueBounds(distinct) {
  const target = Math.max(5, Math.min(9, Math.round(distinct / 2.4)));
  return { min: Math.max(MIN_CLUES, target - 1), max: Math.min(MAX_CLUES, target + 1), target };
}

/** Открытых букв: в первых четырёх темах — 2, дальше — 1. */
export function givenCountFor(chapter) {
  return chapter <= 4 ? 2 : 1;
}

/** Слова цитаты (буквы, верхний регистр) — ответ не должен совпадать с ними или быть их частью. */
export function quoteWords(quote) {
  return quote
    .split(/[\s—-]+/)
    .map((w) => lettersOf(w))
    .filter(Boolean);
}

/** Ответ «подсказан» цитатой: равен её слову или одно начинается с другого (длина ≥ 5). */
export function givenAway(answer, qWords) {
  for (const q of qWords) {
    if (q === answer) return true;
    if (answer.length >= 5 && q.startsWith(answer)) return true;
    if (q.length >= 5 && answer.startsWith(q)) return true;
  }
  return false;
}

/** Два ответа одного уровня «пересекаются»: общий кусок из 4 букв или одно определение называет другой ответ. */
function sharesPart(a, b) {
  for (let i = 0; i + 4 <= a.length; i++) if (b.includes(a.slice(i, i + 4))) return true;
  return false;
}
export function clash(a, b) {
  return sharesPart(a.w, b.w) || String(a.c).toLowerCase().includes(stemOf(b.w)) || String(b.c).toLowerCase().includes(stemOf(a.w));
}

/** id уровня «Слов»: тема + текст цитаты (§2.5) — не зависит от слов, переводов и порядка тем. */
export function levelId(slug, quote) {
  return contentId({ slug, quote });
}

/**
 * pickClues(quote, candidates, seed) → { chosen, uncovered, bounds, distinct, score } — набор
 * ответов, покрывающий буквы цитаты (uncovered — непокрытые буквы, их придётся открыть).
 * Предпочтение — словам, у которых большая часть букв есть в цитате (они больше открывают), и
 * повторному покрытию букв (ответы помогают друг другу). Детерминирован от seed.
 */
export function pickClues(quote, candidates, seed, { runs = RUNS } = {}) {
  const Q = new Set(lettersOf(quote));
  const qWords = quoteWords(quote);
  const bounds = clueBounds(Q.size);
  const pool = [];
  for (const e of candidates) {
    if (givenAway(e.w, qWords)) continue;
    const set = new Set(e.w);
    let inQ = 0;
    for (const ch of set) if (Q.has(ch)) inQ++;
    const rel = inQ / set.size;
    if (inQ < 3 || rel < 0.5) continue;
    pool.push({ e, set, inQ, outQ: set.size - inQ, rel });
  }
  // Ответы одного уровня не должны подсказывать друг друга (WORKHORSE + WORKAHOLIC, SWELLING + «swelling»).
  for (const x of pool) x.bad = new Set(pool.filter((y) => y !== x && clash(x.e, y.e)));
  const blocked = (x, chosen) => chosen.some((y) => x.bad.has(y));
  const rng = mulberry32(seed >>> 0);
  let best = null;
  for (let run = 0; run < runs && pool.length; run++) {
    const uncovered = new Set(Q);
    const cover = new Map(); // буква → сколько ответов её содержат
    const chosen = [];
    const used = new Set();
    const add = (x) => {
      chosen.push(x);
      used.add(x);
      for (const ch of x.set) {
        uncovered.delete(ch);
        if (Q.has(ch)) cover.set(ch, (cover.get(ch) || 0) + 1);
      }
    };
    // 1. Покрытие: новые буквы цитаты важнее всего.
    while (uncovered.size && chosen.length < bounds.max) {
      let pick = null;
      let pickScore = -Infinity;
      for (const x of pool) {
        if (used.has(x) || blocked(x, chosen)) continue;
        let fresh = 0;
        for (const ch of x.set) if (uncovered.has(ch)) fresh++;
        if (!fresh) continue;
        const sc = fresh * 4 + x.inQ * 0.5 - x.outQ + rng.next() * 3;
        if (sc > pickScore) {
          pickScore = sc;
          pick = x;
        }
      }
      if (!pick) break;
      add(pick);
    }
    // 2. Добор до целевого числа: повторное покрытие редких букв, высокая доля букв цитаты.
    while (chosen.length < bounds.target) {
      let pick = null;
      let pickScore = -Infinity;
      for (const x of pool) {
        if (used.has(x) || blocked(x, chosen)) continue;
        let redund = 0;
        for (const ch of x.set) if (Q.has(ch) && (cover.get(ch) || 0) < 2) redund++;
        const sc = redund + x.rel * 3 + rng.next() * 2;
        if (sc > pickScore) {
          pickScore = sc;
          pick = x;
        }
      }
      if (!pick) break;
      add(pick);
    }
    let twice = 0;
    for (const ch of Q) if ((cover.get(ch) || 0) >= 2) twice++;
    const relSum = chosen.reduce((a, x) => a + x.rel, 0);
    const score =
      -uncovered.size * 1000 - Math.max(0, bounds.min - chosen.length) * 500 + relSum * 10 + twice * 2 - Math.abs(chosen.length - bounds.target) * 3;
    if (!best || score > best.score) best = { chosen: chosen.map((x) => x.e), uncovered: [...uncovered].sort(), score };
  }
  return { ...(best || { chosen: [], uncovered: [...Q].sort(), score: -Infinity }), bounds, distinct: Q.size };
}

/**
 * chooseGiven(quote, clues, uncovered, count) → строка открытых букв: сначала непокрытые
 * ответами, затем самые частые буквы цитаты — так, чтобы у каждого ответа осталось ≥ 2 неоткрытые
 * буквы. null — если непокрытых больше MAX_GIVEN или условие не выполнить.
 */
export function chooseGiven(quote, clues, uncovered, count) {
  if (uncovered.length > MAX_GIVEN) return null;
  const given = new Set(uncovered);
  const freq = new Map();
  for (const ch of lettersOf(quote)) freq.set(ch, (freq.get(ch) || 0) + 1);
  const byFreq = [...freq.keys()].sort((a, b) => freq.get(b) - freq.get(a) || (a < b ? -1 : 1));
  const ok = (g) => clues.every((c) => new Set([...c.w].filter((ch) => !g.has(ch))).size >= 2);
  for (const ch of byFreq) {
    if (given.size >= Math.max(count, uncovered.length)) break;
    if (given.has(ch)) continue;
    const next = new Set(given).add(ch);
    if (ok(next)) given.add(ch);
  }
  if (!ok(given)) return null;
  return [...given].sort().join('');
}

/** assignNumbers(letters, seed) → key[26]: номера 1…K буквам из letters в случайном порядке. */
export function assignNumbers(letters, seed) {
  const uniq = [...new Set(letters)].sort();
  const order = mulberry32(seed >>> 0).shuffle(uniq.slice());
  const key = new Array(26).fill(0);
  order.forEach((ch, i) => {
    key[ABC.indexOf(ch)] = i + 1;
  });
  return key;
}

/** Попробовать цитату на свободных словах: подходящий подбор или null. */
function fitQuote(theme, item, avail, seed, chapter) {
  const s = hash32(seed, 'words', theme.slug, item.qi);
  const fit = pickClues(item.q.q, avail, s);
  if (fit.chosen.length < fit.bounds.min || fit.uncovered.length > MAX_GIVEN) return null;
  const given = chooseGiven(item.q.q, fit.chosen, fit.uncovered, givenCountFor(chapter));
  if (given === null) return null;
  return { item, fit, given, seed: s, L: lettersOf(item.q.q).length };
}

/** Выбрать per элементов из отсортированного по длине списка — равномерно от короткого к длинному. */
function spread(list, per) {
  if (per <= 0) return [];
  if (list.length <= per) return list.slice();
  if (per === 1) return [list[0]];
  const out = [];
  const used = new Set();
  for (let i = 0; i < per; i++) {
    let j = Math.round((i * (list.length - 1)) / (per - 1));
    while (used.has(j) && j < list.length - 1) j++;
    used.add(j);
    out.push(list[j]);
  }
  return out;
}

/** Открытые буквы прежнего уровня ещё годятся: покрывают непокрытые и оставляют ответам ≥ 2 буквы. */
function givenStillValid(given, quote, entries, uncovered) {
  if (typeof given !== 'string' || !given || given.length > MAX_GIVEN) return false;
  const Q = new Set(lettersOf(quote));
  const g = new Set(given);
  if ([...g].some((ch) => !Q.has(ch))) return false;
  if (uncovered.some((ch) => !g.has(ch))) return false;
  return entries.every((c) => new Set([...c.w].filter((ch) => !g.has(ch))).size >= 2);
}

/** Прежний (выпущенный) уровень на текущем словаре темы: те же слова, если они на месте, иначе подбор заново. */
function refitLocked(theme, old, item, avail, usedWords, seed, chapter) {
  const entries = old.clues.map((c) => theme.words.find((e) => e.w === c.w));
  if (entries.every(Boolean) && entries.every((e) => !usedWords.has(e.w))) {
    const Q = [...new Set(lettersOf(item.q.q))];
    const uncovered = Q.filter((ch) => !entries.some((e) => e.w.includes(ch))).sort();
    if (uncovered.length <= MAX_GIVEN) {
      const given = givenStillValid(old.given, item.q.q, entries, uncovered) ? old.given : chooseGiven(item.q.q, entries, uncovered, givenCountFor(chapter));
      if (given !== null) {
        return { item, fit: { chosen: entries, uncovered, distinct: Q.length }, given, seed: old.seed, L: lettersOf(item.q.q).length, keepOrder: true, oldKey: old.key };
      }
    }
  }
  return fitQuote(theme, item, avail, seed, chapter);
}

/**
 * buildWords({ themes, seed, per, lock }) → { data, stats, warnings, lost }.
 * lock — уровни прежней сборки (выпущенные): они сохраняются в своих темах первыми (append-only),
 * новые уровни дописываются до per. lost — id выпущенных уровней, которых нет в результате.
 */
export function buildWords({ themes, seed = DEFAULT_SEED, per = LEVELS_PER_THEME, version = '0.0.0', lock = null }) {
  const usedWords = new Set();
  const campaign = [];
  const stats = [];
  const warnings = [];
  const lockBySlug = new Map();
  for (const l of lock || []) {
    if (!l || !l.slug) continue;
    if (!lockBySlug.has(l.slug)) lockBySlug.set(l.slug, []);
    lockBySlug.get(l.slug).push(l);
  }
  themes.forEach((theme, ti) => {
    const chapter = ti + 1;
    const avail = () => theme.words.filter((e) => !usedWords.has(e.w));
    const items = theme.quotes.map((q, qi) => ({ q, qi }));
    const commit = (fit) => {
      for (const e of fit.fit.chosen) usedWords.add(e.w);
    };
    // 1. Выпущенные уровни темы — в прежнем порядке.
    const kept = [];
    const usedQuotes = new Set();
    for (const old of lockBySlug.get(theme.slug) || []) {
      const item = items.find((it) => it.q.q === old.quote);
      if (!item) {
        warnings.push(`${theme.slug}: цитата выпущенного уровня ${old.id} удалена из темы`);
        continue;
      }
      const fit = refitLocked(theme, old, item, avail(), usedWords, seed, chapter);
      if (!fit) {
        warnings.push(`${theme.slug}: выпущенный уровень ${old.id} не собрать на текущем словаре`);
        continue;
      }
      commit(fit);
      kept.push(fit);
      usedQuotes.add(item.qi);
    }
    // 2. Новые уровни: годные цитаты по длине, разброс длин; первой теме — короткая цитата.
    const need = Math.max(0, per - kept.length);
    const valid = items
      .filter((it) => !usedQuotes.has(it.qi))
      .map((item) => fitQuote(theme, item, avail(), seed, chapter))
      .filter(Boolean)
      .sort((a, b) => a.L - b.L || a.item.qi - b.item.qi);
    let target = spread(valid, need);
    if (ti === 0 && kept.length === 0 && target.length && target[0].L > ONBOARDING_LETTERS) {
      const short = valid.find((v) => v.L <= ONBOARDING_LETTERS);
      if (short) target = [short, ...target.slice(1).filter((v) => v !== short)];
      else warnings.push(`${theme.slug}: нет годной цитаты ≤ ${ONBOARDING_LETTERS} букв для первого уровня`);
    }
    const reserve = valid.filter((v) => !target.includes(v));
    // Раздача слов: короткие цитаты первыми; не хватило — ближайшая по длине из запаса.
    const fresh = [];
    const queue = target.slice().sort((a, b) => a.L - b.L || a.item.qi - b.item.qi);
    while (queue.length && fresh.length < need) {
      const cand = queue.shift();
      const fit = fitQuote(theme, cand.item, avail(), seed, chapter);
      if (fit) {
        commit(fit);
        fresh.push(fit);
        continue;
      }
      warnings.push(`${theme.slug}: цитате #${cand.item.qi} не хватило свободных слов — замена`);
      reserve.sort((a, b) => Math.abs(a.L - cand.L) - Math.abs(b.L - cand.L) || a.item.qi - b.item.qi);
      if (reserve.length) queue.push(reserve.shift());
    }
    fresh.sort((a, b) => a.L - b.L || a.item.qi - b.item.qi);
    const picked = [...kept, ...fresh];
    if (picked.length < per) warnings.push(`${theme.slug}: набрано ${picked.length} уровней из ${per}`);
    for (const p of picked) {
      const words = p.keepOrder ? p.fit.chosen.slice() : mulberry32(hash32(p.seed, 'order')).shuffle(p.fit.chosen.slice());
      const letters = [...lettersOf(p.item.q.q), ...words.flatMap((e) => [...e.w])];
      const letterSet = [...new Set(letters)].sort().join('');
      const oldSet = Array.isArray(p.oldKey) ? ABC.split('').filter((_, i) => p.oldKey[i] > 0).join('') : '';
      const key = oldSet === letterSet ? p.oldKey.slice() : assignNumbers(letters, hash32(p.seed, 'key'));
      const level = {
        id: levelId(theme.slug, p.item.q.q),
        seed: p.seed,
        chapter,
        difficulty: p.L,
        slug: theme.slug,
        theme: { ru: theme.ru, en: theme.en },
        quote: p.item.q.q,
        author: p.item.q.a,
        src: p.item.q.src || '',
        ru: p.item.q.ru,
        clues: words.map((e) => ({ w: e.w, p: e.p, c: e.c, ru: e.ru })),
        key,
        given: p.given,
      };
      campaign.push(level);
      stats.push({
        theme: theme.slug,
        letters: p.L,
        distinct: p.fit.distinct,
        clues: words.length,
        given: p.given,
        numbers: Math.max(...level.key),
        kept: p.keepOrder ? 'да' : '',
        author: p.item.q.a,
      });
    }
  });
  const ids = new Set(campaign.map((l) => l.id));
  const lost = (lock || []).filter((l) => l && l.id && !ids.has(l.id)).map((l) => `${l.slug || '?'}:${l.id} «${String(l.quote).slice(0, 40)}»`);
  const data = {
    meta: { masterSeed: seed, generatedAt: new Date().toISOString(), version, themes: themes.length },
    words: { campaign },
  };
  return { data, stats, warnings, lost };
}

export function loadThemes(dir, order = THEME_ORDER) {
  const themes = [];
  const errors = [];
  for (const slug of order) {
    const path = resolve(dir, `${slug}.json`);
    if (!existsSync(path)) {
      errors.push(`${slug}: нет файла ${path}`);
      continue;
    }
    const theme = JSON.parse(readFileSync(path, 'utf8'));
    const res = checkTheme(theme, `${slug}.json`);
    errors.push(...res.errors);
    if (theme.slug !== slug) errors.push(`${slug}.json: slug «${theme.slug}» не совпадает с именем файла`);
    themes.push(theme);
  }
  errors.push(...checkThemes(themes));
  return { themes, errors };
}

function parseArgs(argv) {
  const args = { seed: DEFAULT_SEED, out: 'src/data/words.json', per: LEVELS_PER_THEME, quiet: false, dir: 'tools/words/themes', partial: false, fresh: false, replace: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') args.seed = Number(argv[++i]) >>> 0;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--per') args.per = Number(argv[++i]) | 0;
    else if (a === '--dir') args.dir = argv[++i];
    else if (a === '--quiet') args.quiet = true;
    else if (a === '--partial') args.partial = true; // только существующие темы (отладка, не для релиза)
    else if (a === '--fresh') args.fresh = true; // собрать с нуля, без выпущенных уровней
    else if (a === '--replace') args.replace = true; // разрешить пропажу выпущенных уровней
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = args.quiet ? () => {} : console.log;
  const dir = resolve(ROOT, args.dir);
  const order = args.partial ? THEME_ORDER.filter((s) => existsSync(resolve(dir, `${s}.json`))) : THEME_ORDER;
  const { themes, errors } = loadThemes(dir, order);
  if (errors.length) {
    for (const e of errors) console.error(`✗ ${e}`);
    process.exit(1);
  }
  const version = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version;
  if (!(args.per >= 1)) {
    console.error('--per должен быть ≥ 1');
    process.exit(1);
  }
  const outPath = resolve(ROOT, args.out);
  let lock = null;
  if (!args.fresh && existsSync(outPath)) {
    try {
      lock = JSON.parse(readFileSync(outPath, 'utf8'))?.words?.campaign || null;
    } catch {
      lock = null;
    }
  }
  const t0 = performance.now();
  const { data, stats, warnings, lost } = buildWords({ themes, seed: args.seed, per: args.per, version, lock });
  if (lost.length && !args.replace) {
    console.error(`✗ Пропали бы выпущенные уровни (прогресс игроков по ним сбросится):\n  ${lost.join('\n  ')}\nВерни их цитаты/слова или запусти с --replace (осознанно).`);
    process.exit(1);
  }
  mkdirSync(dirname(outPath), { recursive: true });
  const json = JSON.stringify(data);
  writeFileSync(outPath, json);
  if (!args.quiet) console.table(stats);
  for (const w of warnings) console.warn(`! ${w}`);
  if (lock) log(`Выпущенных уровней сохранено: ${lock.length - lost.length} из ${lock.length}`);
  const lv = data.words.campaign;
  log(`Уровней: ${lv.length}, слов: ${lv.reduce((a, l) => a + l.clues.length, 0)}${args.partial ? ' (--partial: не все темы)' : ''}`);
  log(`Записано ${outPath}: ${(Buffer.byteLength(json) / 1024).toFixed(1)} КБ за ${Math.round(performance.now() - t0)} мс`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
