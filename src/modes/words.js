// Режим «Слова» (words) — английский акростих с номерами букв (§2.5, дизайн-система Lumin).
// Логика без DOM: догадки хранятся по номерам (одна правда на номер), клетки цитаты и ответов
// выводятся из них. Вид — DOM-разметка src/ui/words-view.js (contract: dom + view).
// Расширения контракта §5.1: dom/view/tap, keyboard/key, skin, hintOptions/hint(id), campaignOnly,
// openByChapter, chapterTitle, titleFor, intro, stats().quote/accuracy/vocab, события miss/notice.
import { mountWordsView } from '../ui/words-view.js';

export const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const LABELS = ABC;
export const ERR_MS = 420;
const HINT_MS = 2500;

export const MSG_WRONG = {
  ru: 'Есть ошибки — проверь буквы',
  en: 'Some letters are wrong — check them',
};
const POS = {
  n: { ru: 'сущ.', en: 'n.' },
  v: { ru: 'гл.', en: 'v.' },
  adj: { ru: 'прил.', en: 'adj.' },
  adv: { ru: 'нареч.', en: 'adv.' },
};

// --- Чистые функции текста ---------------------------------------------------------------

/** quoteLetters(quote) → ['T','H','E',…] — буквы A–Z цитаты по порядку (клетки цитаты). */
export function quoteLetters(quote) {
  return String(quote).toUpperCase().replace(/[^A-Z]/g, '').split('');
}

/**
 * tokenize(quote) → [{ text, space }]: слова цитаты для переноса. Делим по пробелам и после
 * длинного тире (перенос возможен сразу за ним); space — был ли перед токеном пробел.
 */
export function tokenize(quote) {
  const out = [];
  for (const part of String(quote).split(' ')) {
    if (!part) continue;
    let buf = '';
    let first = true;
    for (const ch of part) {
      buf += ch;
      if (ch === '—') {
        out.push({ text: buf, space: first });
        first = false;
        buf = '';
      }
    }
    if (buf) out.push({ text: buf, space: first });
  }
  return out;
}

/** «7 букв» / «4 буквы» / «1 буква». */
export function lettersWord(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} буква`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} буквы`;
  return `${n} букв`;
}

const idx = (ch) => ch.charCodeAt(0) - 65;

/** Статические производные уровня (не сериализуются). */
function buildStatic(level) {
  const key = Array.isArray(level.key) && level.key.length === 26 ? level.key : new Array(26).fill(0);
  const K = Math.max(0, ...key.map((n) => (Number.isInteger(n) && n > 0 ? n : 0)));
  const letterOf = new Array(K + 1).fill('');
  for (let i = 0; i < 26; i++) if (key[i] > 0) letterOf[key[i]] = ABC[i];
  const numOf = (ch) => key[idx(ch)] || 0;
  const letters = quoteLetters(level.quote);
  const qnum = letters.map(numOf);
  const clues = Array.isArray(level.clues) ? level.clues : [];
  const anum = clues.map((c) => [...String(c.w)].map(numOf));
  const given = new Uint8Array(K + 1);
  for (const ch of String(level.given || '')) if (numOf(ch)) given[numOf(ch)] = 1;
  const inQuote = new Uint8Array(K + 1);
  for (const n of qnum) inQuote[n] = 1;
  return { K, key, letterOf, letters, L: letters.length, qnum, clues, m: clues.length, anum, given, inQuote };
}

// --- Выделение и навигация ------------------------------------------------------------------

/** Номер клетки: зона 'q' (цитата, i) или 'a' (ответ k, i). */
export function cellNum(state, z, k, i) {
  if (z === 'q') return state.qnum[i] || 0;
  return (state.anum[k] && state.anum[k][i]) || 0;
}

export function selNum(state) {
  const s = state.sel;
  return s ? cellNum(state, s.z, s.k, s.i) : 0;
}

const isCorrect = (state, n) => n > 0 && state.guess[n] === state.letterOf[n];

export function wordSolved(state, k) {
  const nums = state.anum[k];
  if (!nums || !nums.length) return false;
  for (const n of nums) if (!isCorrect(state, n)) return false;
  return true;
}

function solvedCount(state) {
  let c = 0;
  for (let k = 0; k < state.m; k++) if (wordSolved(state, k)) c++;
  return c;
}

function computeSolved(state) {
  if (!state.L) return false;
  for (const n of state.qnum) if (!isCorrect(state, n)) return false;
  return true;
}

function quoteFilled(state) {
  for (const n of state.qnum) if (!state.guess[n]) return false;
  return true;
}

/** Длина зоны выделения: число клеток цитаты или ответа k. */
function zoneLen(state, z, k) {
  return z === 'q' ? state.L : (state.anum[k] || []).length;
}

/** Выбрать клетку, если она не открытая; ответ под клеткой цитаты — первый нерешённый с этим номером. */
function select(state, z, k, i) {
  const n = cellNum(state, z, k, i);
  if (!n || state.given[n]) return false;
  state.sel = { z, k: z === 'a' ? k : 0, i };
  if (z === 'a') state.cur = k;
  else {
    let best = -1;
    for (let j = 0; j < state.m; j++) {
      if (!state.anum[j].includes(n)) continue;
      if (best < 0) best = j;
      if (!wordSolved(state, j)) {
        best = j;
        break;
      }
    }
    if (best >= 0) state.cur = best;
  }
  return true;
}

/** Первая пустая неоткрытая клетка ответа k (иначе первая неоткрытая); −1 — нет таких. */
function entryIndex(state, k) {
  const nums = state.anum[k] || [];
  let first = -1;
  for (let i = 0; i < nums.length; i++) {
    if (state.given[nums[i]]) continue;
    if (first < 0) first = i;
    if (!state.guess[nums[i]]) return i;
  }
  return first;
}

function selectClue(state, k) {
  if (k < 0 || k >= state.m) return false;
  const i = entryIndex(state, k);
  if (i < 0) return false;
  return select(state, 'a', k, i);
}

/** Следующий после k ответ (по кругу) с пустыми клетками; −1 — все заполнены. */
function nextOpenClue(state, k) {
  for (let s = 1; s <= state.m; s++) {
    const j = (k + s) % state.m;
    if ((state.anum[j] || []).some((n) => !state.given[n] && !state.guess[n])) return j;
  }
  return -1;
}

/** Все неоткрытые клетки текущей зоны (ответа или цитаты) заполнены. */
function zoneFull(state) {
  const s = state.sel;
  if (!s) return false;
  const nums = s.z === 'q' ? state.qnum : state.anum[s.k] || [];
  return nums.every((n) => state.given[n] || state.guess[n]);
}

/** Сдвиг на dir в зоне выделения по неоткрытым клеткам; emptyOnly — только к пустым. */
function step(state, dir, { emptyOnly = false, wrap = false } = {}) {
  const s = state.sel;
  if (!s) return false;
  const len = zoneLen(state, s.z, s.k);
  for (let d = 1; d < len + (wrap ? len : 0); d++) {
    let j = s.i + dir * d;
    if (wrap) j = ((j % len) + len) % len;
    else if (j < 0 || j >= len) return false;
    const n = cellNum(state, s.z, s.k, j);
    if (!n || state.given[n]) continue;
    if (emptyOnly && state.guess[n]) continue;
    if (j === s.i) return false;
    return select(state, s.z, s.k, j);
  }
  return false;
}

/**
 * Курсор после ввода (§2.5): к следующей пустой клетке зоны; заполненный ответ → следующий ответ.
 * overtype — зона была заполнена ещё до нажатия (игрок перепечатывает слово): курсор идёт по
 * клеткам подряд, иначе после первой буквы он убегал бы к другому ответу.
 */
function advance(state, overtype = false) {
  const s = state.sel;
  if (overtype && step(state, 1)) return;
  if (step(state, 1, { emptyOnly: true })) return;
  if (s.z === 'a') {
    if (step(state, 1, { emptyOnly: true, wrap: true })) return;
    const next = nextOpenClue(state, s.k);
    if (next >= 0) selectClue(state, next);
    return;
  }
  step(state, 1, { emptyOnly: true, wrap: true });
}

function ensureSelection(state) {
  const n = selNum(state);
  if (n && !state.given[n]) return true;
  for (let k = 0; k < state.m; k++) if (selectClue(state, k)) return true;
  for (let i = 0; i < state.L; i++) if (select(state, 'q', 0, i)) return true;
  state.sel = null;
  return false;
}

// --- Изменения букв ------------------------------------------------------------------------

function bumpFx(state, kind, n, t) {
  state.fx = { seq: state.fx.seq + 1, kind, num: n, at: t, clue: state.fx.clue, clueAt: state.fx.clueAt };
}

/** Записать букву ch в номер n; события step/miss/changed/complete. */
function setGuess(state, n, ch, t, events) {
  const before = [];
  for (let k = 0; k < state.m; k++) before.push(wordSolved(state, k));
  if (state.guess[n] === ch) return false;
  state.guess[n] = ch;
  state.rev[n] = 0;
  state.chk[n] = 0;
  state.ent++;
  events.push({ kind: 'changed' });
  if (ch === state.letterOf[n]) {
    bumpFx(state, 'pop', n, t);
    events.push({ kind: 'step', index: state.guess.filter(Boolean).length });
  } else {
    state.bad++;
    bumpFx(state, 'err', n, t);
    events.push({ kind: 'miss', num: n });
  }
  for (let k = 0; k < state.m; k++) {
    if (!before[k] && wordSolved(state, k)) {
      const clue = state.clues[k] || {};
      const word = String(clue.w || '').toLowerCase();
      state.fx.clue = k;
      state.fx.clueAt = t;
      // Момент обучения (§2.5): перевод отгаданного слова — тостом, курсор уже уходит дальше.
      events.push({ kind: 'complete', clue: k, message: clue.ru ? { ru: `${word} — ${clue.ru}`, en: `${word} — ${clue.ru}` } : null });
    }
  }
  return true;
}

function checkEnd(state, t, events) {
  if (computeSolved(state)) {
    if (!state.solved) {
      state.solved = true;
      state.solvedAt = t;
      events.push({ kind: 'solved' });
    }
  } else if (quoteFilled(state)) {
    events.push({ kind: 'notice', message: MSG_WRONG });
  }
}

/** Ответ, к которому относятся подсказки и панель: текущий (state.cur). */
function currentClue(state) {
  return state.cur >= 0 && state.cur < state.m ? state.cur : 0;
}

/** Номер для «Открыть букву»: выделенный, если не верен; иначе первый неверный в ответе; иначе в цитате. */
function letterTarget(state) {
  const n = selNum(state);
  if (n && !state.given[n] && !isCorrect(state, n)) return n;
  for (const m of state.anum[currentClue(state)] || []) if (!state.given[m] && !isCorrect(state, m)) return m;
  for (const m of state.qnum) if (!state.given[m] && !isCorrect(state, m)) return m;
  return 0;
}

// --- Объект режима ------------------------------------------------------------------------

const mode = {
  id: 'words',
  icon: 'words',
  name: { ru: 'Слова', en: 'Words' },
  tagline: { ru: 'Английские слова открывают цитату', en: 'English words reveal a quote' },
  helpText: {
    ru: 'Отгадай английское слово по определению. У каждой буквы свой номер — буква встанет во все клетки с этим номером.',
    en: 'Guess the English word from its definition. Every letter has a number — it fills every cell with that number.',
  },
  color: '#B3ABDB', // Lumin (§4.4): приглушённый оттенок режима для тёмной темы
  colorLight: '#6A6296',
  dom: true,
  keyboard: true,
  skin: 'lumin',
  campaignOnly: true,
  openByChapter: true,
  /** Знакомство при первом входе (Lumin «Onboarding»: три карточки — отгадывай, связывай, открывай). */
  intro: [
    { title: { ru: 'Отгадывай слова' }, text: { ru: 'Под цитатой — английские определения. Впиши слово: перевод появится, когда угадаешь.' } },
    { title: { ru: 'Связывай номера' }, text: { ru: 'У каждой буквы свой номер. Буква, введённая в клетку, встаёт во все клетки с тем же номером.' } },
    { title: { ru: 'Открывай цитату' }, text: { ru: 'Отгаданные слова открывают цитату, а цитата помогает со словами. Ошибки не штрафуются.' } },
  ],
  /** DOM-вид (§2.5): оболочка передаёт tap/invalidate/reducedMotion, режим — свои помощники. */
  view(root, api) {
    return mountWordsView(root, { ...api, helpers: { tokenize, cellNum, selNum, wordSolved, LABELS, metaOf: (c) => mode.metaOf(c) } });
  },

  chapterTitle(chapter, level) {
    return level && level.theme ? level.theme : { ru: `Тема ${chapter}`, en: `Theme ${chapter}` };
  },

  /** Заголовок экрана игры: «Еда и кухня · 3/5». */
  titleFor(level, index, campaign) {
    const same = campaign.filter((l) => l.chapter === level.chapter);
    const pos = same.indexOf(level) + 1;
    const theme = level.theme || { ru: '', en: '' };
    return { ru: `${theme.ru} · ${pos}/${same.length}`, en: `${theme.en} · ${pos}/${same.length}` };
  },

  /**
   * create(levelData, saved) → state. Снимок восстанавливает догадки по номерам, выделение,
   * переводы, подсказки и точность; открытые буквы на месте всегда; мусор игнорируется.
   */
  create(levelData, saved) {
    const st = buildStatic(levelData);
    const state = {
      level: levelData,
      ...st,
      guess: new Array(st.K + 1).fill(''),
      rev: new Uint8Array(st.K + 1),
      chk: new Uint8Array(st.K + 1),
      shown: new Set(),
      hints: 0,
      hintUsed: false,
      hint: null,
      ent: 0,
      bad: 0,
      sel: null,
      cur: 0,
      solved: false,
      solvedAt: -Infinity,
      fx: { seq: 0, kind: '', num: 0, at: -Infinity, clue: -1, clueAt: -Infinity },
    };
    for (let n = 1; n <= st.K; n++) if (st.given[n]) state.guess[n] = st.letterOf[n];
    if (saved && typeof saved === 'object') {
      if (typeof saved.g === 'string' && saved.g.length === st.K) {
        for (let n = 1; n <= st.K; n++) {
          const ch = saved.g[n - 1];
          if (!st.given[n] && ch >= 'A' && ch <= 'Z') state.guess[n] = ch;
        }
      }
      const nums = (list, arr) => {
        if (Array.isArray(list)) for (const n of list) if (Number.isInteger(n) && n > 0 && n <= st.K && !st.given[n]) arr[n] = 1;
      };
      nums(saved.rev, state.rev);
      nums(saved.chk, state.chk);
      for (let n = 1; n <= st.K; n++) {
        if (state.rev[n] && !isCorrect(state, n)) state.rev[n] = 0;
        if (state.chk[n] && (!state.guess[n] || isCorrect(state, n))) state.chk[n] = 0;
      }
      if (Array.isArray(saved.shown)) for (const k of saved.shown) if (Number.isInteger(k) && k >= 0 && k < st.m) state.shown.add(k);
      for (const f of ['hints', 'ent', 'bad']) if (Number.isInteger(saved[f]) && saved[f] >= 0) state[f] = saved[f];
      if (state.bad > state.ent) state.bad = state.ent;
      state.hintUsed = saved.hintUsed === true;
      if (Array.isArray(saved.sel) && saved.sel.length === 3) {
        const [z, k, i] = saved.sel;
        if ((z === 'q' || z === 'a') && Number.isInteger(k) && Number.isInteger(i) && i >= 0 && i < zoneLen(state, z, k)) select(state, z, k, i);
      }
      if (Number.isInteger(saved.cur) && saved.cur >= 0 && saved.cur < st.m) state.cur = saved.cur;
    }
    ensureSelection(state);
    state.solved = computeSolved(state);
    return state;
  },

  serialize(state) {
    const list = (arr) => {
      const out = [];
      for (let n = 1; n <= state.K; n++) if (arr[n]) out.push(n);
      return out;
    };
    const s = state.sel;
    return {
      g: state.guess.slice(1).map((ch) => ch || '.').join(''),
      sel: s ? [s.z, s.k, s.i] : null,
      cur: state.cur,
      shown: [...state.shown].sort((a, b) => a - b),
      rev: list(state.rev),
      chk: list(state.chk),
      hints: state.hints,
      hintUsed: state.hintUsed,
      ent: state.ent,
      bad: state.bad,
    };
  },

  // Холст не используется (dom: true): заглушки контракта §5.1.
  layout() {
    return null;
  },
  render() {
    return false;
  },
  pointer() {
    return [];
  },

  /**
   * tap(state, target) → события. target: { z:'q', i } | { z:'a', k, i } | { clue: k } | { step: ±1 }.
   * Только выделение — шаг undo не создаётся.
   */
  tap(state, target) {
    if (state.solved || !target || typeof target !== 'object') return [];
    let ok = false;
    if (target.z === 'q' || target.z === 'a') {
      const k = target.z === 'a' ? target.k | 0 : 0;
      if (Number.isInteger(target.i) && target.i >= 0 && target.i < zoneLen(state, target.z, k)) ok = select(state, target.z, k, target.i);
    } else if (Number.isInteger(target.clue)) ok = selectClue(state, target.clue);
    else if (target.step === 1 || target.step === -1) ok = selectClue(state, (currentClue(state) + target.step + state.m) % state.m);
    return ok ? [{ kind: 'select' }] : [];
  },

  /**
   * key(state, key, t) → события. key: 'A'…'Z' | 'Backspace' | 'Left' | 'Right' | 'Next'.
   * Буква ставится в номер выделенной клетки (во все клетки с ним) и двигает курсор.
   */
  key(state, key, t = 0) {
    const events = [];
    if (state.solved || typeof key !== 'string' || !ensureSelection(state)) return events;
    if (/^[A-Z]$/.test(key)) {
      const n = selNum(state);
      const overtype = zoneFull(state);
      setGuess(state, n, key, t, events);
      advance(state, overtype);
      checkEnd(state, t, events);
      return events;
    }
    if (key === 'Backspace') {
      let n = selNum(state);
      if (!state.guess[n] || state.given[n]) {
        if (!step(state, -1)) return events;
        n = selNum(state);
      }
      if (state.guess[n] && !state.given[n]) {
        state.guess[n] = '';
        state.rev[n] = 0;
        state.chk[n] = 0;
        events.push({ kind: 'changed' });
      } else events.push({ kind: 'select' });
      return events;
    }
    if (key === 'Left' || key === 'Right') {
      if (step(state, key === 'Left' ? -1 : 1)) events.push({ kind: 'select' });
      return events;
    }
    if (key === 'Next') {
      const k = currentClue(state);
      const next = nextOpenClue(state, k);
      if (selectClue(state, next >= 0 ? next : (k + 1) % state.m)) events.push({ kind: 'select' });
    }
    return events;
  },

  isSolved(state) {
    return computeSolved(state);
  },

  /** Сброс: остаются открытые буквы; переводы, подсказки, hintUsed и точность — нет (§2.1). */
  reset(state) {
    for (let n = 1; n <= state.K; n++) {
      state.guess[n] = state.given[n] ? state.letterOf[n] : '';
      state.rev[n] = 0;
      state.chk[n] = 0;
    }
    state.solved = false;
    state.hint = null;
    state.sel = null;
    state.cur = 0;
    ensureSelection(state);
  },

  /** Варианты подсказки для шторки (Lumin «Hints»: эффект виден до выбора). */
  hintOptions(state) {
    const k = currentClue(state);
    const label = LABELS[k] || '?';
    const n = letterTarget(state);
    const filledWrong = (state.anum[k] || []).some((m) => !state.given[m] && state.guess[m]);
    const solved = state.solved || computeSolved(state);
    return [
      {
        id: 'letter',
        label: { ru: 'Открыть букву', en: 'Reveal a letter' },
        detail: n ? { ru: `Номер ${n} откроется во всех клетках`, en: `Number ${n} fills every cell` } : { ru: 'Все буквы уже верны', en: 'All letters are right' },
        disabled: solved || !n,
      },
      {
        id: 'check',
        label: { ru: 'Проверить ответ', en: 'Check this answer' },
        detail: { ru: `Неверные буквы ответа ${label} подсветятся`, en: `Wrong letters in answer ${label} are marked` },
        disabled: solved || wordSolved(state, k) || !filledWrong,
      },
      {
        id: 'translate',
        label: { ru: 'Показать перевод', en: 'Reveal the translation' },
        detail: { ru: `Перевод слова ${label} появится под определением`, en: `The translation of ${label} appears under the clue` },
        disabled: solved || state.shown.has(k) || wordSolved(state, k),
      },
    ];
  },

  /**
   * hint(state, t, id = 'letter') → результат. Любая применённая подсказка ставит hintUsed;
   * нечего подсказывать — kind:'none' без hintUsed.
   */
  hint(state, t = 0, id = 'letter') {
    if (computeSolved(state)) {
      state.hint = null;
      return { kind: 'none' };
    }
    const k = currentClue(state);
    if (id === 'translate') {
      if (state.shown.has(k) || wordSolved(state, k)) return { kind: 'none' };
      state.shown.add(k);
      state.hintUsed = true;
      state.hints++;
      state.hint = { kind: 'translate', clue: k, until: t + HINT_MS };
      return { kind: 'translate', clue: k };
    }
    if (id === 'check') {
      if (wordSolved(state, k)) return { kind: 'none' };
      let wrong = 0;
      for (const n of state.anum[k] || []) {
        if (!state.given[n] && state.guess[n] && !isCorrect(state, n)) {
          state.chk[n] = 1;
          wrong++;
        }
      }
      if (!(state.anum[k] || []).some((n) => !state.given[n] && state.guess[n])) return { kind: 'none' };
      state.hintUsed = true;
      state.hints++;
      state.hint = { kind: 'check', clue: k, wrong, until: t + HINT_MS };
      return { kind: 'check', clue: k, wrong };
    }
    const n = letterTarget(state);
    if (!n) return { kind: 'none' };
    const events = [];
    state.hintUsed = true;
    state.hints++;
    setGuess(state, n, state.letterOf[n], t, events);
    state.ent--; // подсказка — не ввод игрока, точность не трогаем
    state.rev[n] = 1;
    state.solved = computeSolved(state);
    state.hint = { kind: 'cells', num: n, until: t + HINT_MS };
    if (!state.solved) {
      const s = state.sel;
      if (s && cellNum(state, s.z, s.k, s.i) === n) advance(state);
    }
    return { kind: 'cells', num: n, events };
  },

  /** Экран победы (Lumin «Level complete»): цитата, точность, подсказки, слова с переводами. */
  stats(state) {
    const lv = state.level;
    const accuracy = state.ent > 0 ? Math.round((100 * (state.ent - state.bad)) / state.ent) : 100;
    return {
      lines: [],
      quote: { text: lv.quote, author: lv.author, src: lv.src, ru: lv.ru },
      accuracy,
      hints: state.hints,
      vocab: state.clues.map((c) => ({ w: c.w, ru: c.ru, p: c.p, c: c.c })),
    };
  },

  perfect() {
    return true;
  },
  ghost() {
    return null;
  },
  nextLabel() {
    return null;
  },

  /** «слов 3/7». */
  footer(state) {
    const done = solvedCount(state);
    return { ru: `слов ${done}/${state.m}`, en: `words ${done}/${state.m}` };
  },

  /** Подпись части речи и длины: «прил. · 7 букв». */
  metaOf(clue) {
    const p = POS[clue.p];
    return { ru: `${p ? p.ru + ' · ' : ''}${lettersWord(String(clue.w).length)}`, en: `${p ? p.en + ' · ' : ''}${String(clue.w).length} letters` };
  },
};

export default mode;
