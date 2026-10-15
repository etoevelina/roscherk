// Вид режима «Слова» (§2.5; оформление — WORDS 1.2, docs/DESIGN.md §5.6): DOM-разметка вместо
// холста — цитата плитками с номерами на бумажной панели (слова не разрываются), список
// определений строками с кружками-метками (текущее — чернилами), клетки ответа с подчёркиванием.
// Тапы уходят оболочке через api.tap(target); состояние только читается. Всё, что нужно от логики
// режима, приходит в api.helpers (без циклического импорта src/modes/words.js). Стили — 60-game.css.
import { h } from './dom.js';
import { tr } from '../core/i18n.js';

const TILE_MAX = 31; // WORDS: плитка 31×39
const TILE_MIN = 21; // буква ≈ 12 px, номер 8 px — мельче нечитаемо
const TILE_FLOOR = 16; // только если иначе слово не влезает по ширине
const TILE_SCALE_MAX = 1.4; // Dynamic Type: плитки растут вместе с текстом, но не больше чем в 1.4 раза
const ANSWER_MAX = 34; // WORDS: клетка ответа 34×42
const CLUE_SLACK_KEEP = 16; // воздух над панелью цитаты, который не отдаём списку определений
const POP_MS = 220; // WORDS: распространение буквы
const ERR_MS = 420;

/** «11 букв» из подписи режима «прил. · 11 букв»: длина показана справа «(11)», в подписи — только часть речи. */
function posOnly(meta) {
  const parts = String(meta || '').split(' · ');
  return parts.length > 1 ? parts.slice(0, -1).join(' · ') : '';
}

/**
 * mountWordsView(root, api) → { update(state, info), destroy() }.
 * api: { tap(target), invalidate(), reducedMotion(), helpers: { tokenize, cellNum, selNum, wordSolved, LABELS, metaOf } }.
 */
export function mountWordsView(root, api) {
  const H = api.helpers;
  const el = h('div', { class: 'wv' });
  // Подписи клеток — по-русски (lang наследуется от <html lang="ru">); английский — только определения.
  const quote = h('div', { class: 'wv-quote', role: 'group', 'aria-label': 'Цитата' });
  const scroll = h('div', { class: 'wv-scroll' }, quote);
  const clues = h('div', { class: 'wv-clues', role: 'group', 'aria-label': 'Определения' });
  const answer = h('div', { class: 'wv-answer', role: 'group', 'aria-label': 'Ответ' });
  // Озвучка ввода для VoiceOver: «E — неверно», «Слово отгадано: brush — щётка».
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const panel = h('div', { class: 'wv-panel' }, clues, answer);
  el.append(scroll, panel, live);
  root.appendChild(el);

  // Делегирование тапов: плитка/клетка ответа (data-z), строка определения (data-clue).
  el.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('[data-z],[data-clue],[data-step]') : null;
    if (!b || !el.contains(b) || b.getAttribute('aria-disabled') === 'true') return;
    const d = b.dataset;
    if (d.z) api.tap({ z: d.z, k: Number(d.k) || 0, i: Number(d.i) });
    else if (d.clue !== undefined) api.tap({ clue: Number(d.clue) });
    else api.tap({ step: Number(d.step) });
  });

  let level = null;
  let tiles = []; // { btn, b, n, i }
  let rows = []; // { btn, no, def, sub, meta, tr, len }
  let cells = []; // клетки текущего ответа
  let shownClue = -1;
  let lastSeq = -1;
  // Анимации ввода — в отдельных слотах: быстрая следующая буква не гасит красную вспышку ошибки.
  const flashes = { pop: null, err: null };
  const timers = { pop: 0, err: 0 };
  let lastSel = '';
  let lastRow = -1;
  let lastSize = '';

  function build(state) {
    level = state.level;
    tiles = [];
    const words = [];
    let li = 0;
    for (const tok of H.tokenize(level.quote)) {
      const word = h('span', { class: 'wv-word' });
      for (const ch of tok.text) {
        if (/[A-Za-z]/.test(ch)) {
          const i = li++;
          const n = state.qnum[i];
          const b = h('b', { lang: 'en' });
          const btn = h('button', { class: 'wv-tile', type: 'button', dataset: { z: 'q', i: String(i) } }, b, h('em', { 'aria-hidden': 'true', text: String(n) }));
          tiles.push({ btn, b, n, i });
          word.appendChild(btn);
        } else {
          word.appendChild(h('span', { class: 'wv-punct', 'aria-hidden': 'true', text: ch }));
        }
      }
      words.push(word);
    }
    quote.replaceChildren(...words);
    rows = state.clues.map((c, k) => {
      const no = h('span', { class: 'wv-no', 'aria-hidden': 'true', text: H.LABELS[k] });
      const def = h('span', { class: 'wv-def', lang: 'en', text: c.c || '' });
      const meta = h('span', { class: 'wv-meta' });
      const trEl = h('span', { class: 'wv-tr' });
      const sub = h('span', { class: 'wv-sub' }, meta, trEl);
      const len = h('span', { class: 'wv-len', 'aria-hidden': 'true', text: `(${String(c.w || '').length})` });
      const btn = h('button', { class: 'wv-row', type: 'button', dataset: { clue: String(k) } }, no, h('span', { class: 'wv-row-body' }, def, sub), len);
      return { btn, no, def, sub, meta, tr: trEl, len };
    });
    clues.replaceChildren(...rows.map((r) => r.btn));
    shownClue = -1;
    lastSeq = -1;
    lastRow = -1;
    lastSize = '';
    fit();
  }

  function buildAnswer(state, k) {
    const nums = state.anum[k] || [];
    cells = nums.map((n, i) => {
      const b = h('b', { lang: 'en' });
      const btn = h('button', { class: 'wv-acell', type: 'button', dataset: { z: 'a', k: String(k), i: String(i) } }, b, h('small', { 'aria-hidden': 'true', text: String(n) }));
      return { btn, b, n, i };
    });
    answer.replaceChildren(...cells.map((c) => c.btn));
    shownClue = k;
    fitAnswer(nums.length);
  }

  /**
   * Масштаб текста: размер шрифта определений к базовым 15 px — растёт с Dynamic Type и с
   * «Крупным текстом в головоломке» (body.a11y-large: определения 17 px, буквы в плитках +20 % — CSS).
   */
  function textScale() {
    const probe = rows[0]?.def;
    const fs = probe && typeof getComputedStyle === 'function' ? parseFloat(getComputedStyle(probe).fontSize) || 15 : 15;
    return Math.max(1, Math.min(TILE_SCALE_MAX, fs / 15));
  }

  /**
   * Плитки — крупнейшего размера, при котором цитата помещается: по высоте без прокрутки и по
   * ширине (слово не разрывается — самое длинное слово должно влезть в строку панели). Если не
   * помещается даже минимальная плитка (длинная цитата на маленьком экране) — она и прокрутка:
   * мельче плитки нечитаемы (WORDS: не уменьшать текст ниже читаемого). Шире строки — только при
   * словах длиннее ~13 букв.
   */
  function fit() {
    // Список определений — базовой высоты из CSS; остаток места после подгонки цитаты отдаём ему.
    clues.style.height = '';
    el.classList.remove('fitted');
    const cs = typeof getComputedStyle === 'function' ? getComputedStyle(scroll) : null;
    const pad = cs ? (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) : 0;
    const avail = scroll.clientHeight - pad;
    if (avail <= 0) return;
    const k = textScale();
    const tmax = Math.round(TILE_MAX * k);
    const tmin = Math.round(TILE_MIN * k);
    const fitsWidth = () => quote.scrollWidth <= quote.clientWidth + 1;
    for (let t = tmax; t >= tmin; t--) {
      el.style.setProperty('--t', `${t}px`);
      if (fitsWidth() && quote.offsetHeight <= avail) return growClues(avail);
    }
    let t = tmin;
    el.style.setProperty('--t', `${t}px`);
    while (!fitsWidth() && t > TILE_FLOOR) el.style.setProperty('--t', `${--t}px`);
  }

  /**
   * Цитата поместилась с запасом: панель цитаты обнимает плитки, а лишняя высота уходит списку
   * определений (до высоты всех строк) — как в эталоне, где под полем видно три-четыре определения.
   */
  function growClues(avail) {
    el.classList.add('fitted');
    const need = quote.offsetHeight;
    el.classList.remove('fitted');
    const slack = avail - need - CLUE_SLACK_KEEP;
    if (slack <= 0) return;
    const base = clues.offsetHeight;
    // Строки ещё свёрнуты (текущая раскроется в update): запас на 3 строки текущего определения.
    const em = (typeof getComputedStyle === 'function' && parseFloat(getComputedStyle(clues).fontSize)) || 15;
    const target = Math.min(base + slack, Math.max(base, clues.scrollHeight + 2 + em * 2.8));
    if (target > base + 4) clues.style.height = `${Math.round(target)}px`;
  }

  function fitAnswer(len) {
    const w = answer.clientWidth || el.clientWidth || 300;
    const gap = 6;
    const max = Math.round(ANSWER_MAX * textScale());
    const size = Math.max(18, Math.min(max, Math.floor((w - gap * (len - 1)) / Math.max(1, len))));
    el.style.setProperty('--a', `${size}px`);
  }

  // Подгонка — только при смене размера самого вида (поворот, клавиатура, Dynamic Type), а не при
  // смене ответа: панель определений фиксированной высоты, плитки под пальцем не прыгают.
  const ro =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          const size = `${el.clientWidth}x${el.clientHeight}`;
          if (size === lastSize) return;
          lastSize = size;
          fit();
          if (cells.length) fitAnswer(cells.length);
        })
      : null;
  ro?.observe(el);

  function flashClass(n) {
    if (flashes.err && flashes.err.num === n) return ` err-${flashes.err.parity}`;
    if (flashes.pop && flashes.pop.num === n) return ` pop-${flashes.pop.parity}`;
    return '';
  }

  function announce(text) {
    if (!text) return;
    live.textContent = '';
    // Новый текст в следующем кадре — VoiceOver объявляет даже повтор той же фразы.
    requestAnimationFrame(() => {
      live.textContent = text;
    });
  }

  /** Подпись клетки: зона, номер, буква и состояние (выбрана, открыта, подсказка, неверно, отгадан). */
  function label(prefix, state, n, isSel, done) {
    const g = state.guess[n];
    return (
      `${prefix}, номер ${n}, ${g ? `буква ${g}` : 'пусто'}` +
      `${isSel ? ', выбрана' : ''}${state.given[n] ? ', открыта' : ''}${state.rev[n] ? ', подсказка' : ''}` +
      `${state.chk[n] ? ', неверно' : ''}${done ? ', отгадан' : ''}`
    );
  }

  /** Текущая строка определения — в видимой части списка (прокрутка только самого списка). */
  function revealRow(k, reduced) {
    const row = rows[k]?.btn;
    if (!row || !clues.clientHeight) return;
    const top = row.offsetTop - clues.offsetTop;
    const bottom = top + row.offsetHeight;
    let next = clues.scrollTop;
    if (top < clues.scrollTop) next = top - 4;
    else if (bottom > clues.scrollTop + clues.clientHeight) next = bottom - clues.clientHeight + 4;
    if (next === clues.scrollTop) return;
    if (typeof clues.scrollTo === 'function') clues.scrollTo({ top: Math.max(0, next), behavior: reduced ? 'auto' : 'smooth' });
    else clues.scrollTop = Math.max(0, next);
  }

  function update(state, info = {}) {
    if (state.level !== level) build(state);
    const reduced = !!info.reducedMotion;
    const solved = !!state.solved || !!info.won;
    // Новое событие ввода → анимация на всех клетках номера (чётность перезапускает анимацию).
    if (state.fx && state.fx.seq !== lastSeq) {
      if (lastSeq >= 0 && state.fx.num && !solved) {
        const kind = state.fx.kind === 'err' ? 'err' : 'pop';
        if (kind === 'err' || !reduced) {
          flashes[kind] = { num: state.fx.num, parity: state.fx.seq % 2 ? 'a' : 'b' };
          clearTimeout(timers[kind]);
          timers[kind] = setTimeout(
            () => {
              flashes[kind] = null;
              api.invalidate();
            },
            (kind === 'err' ? ERR_MS : POP_MS) + 30,
          );
        }
        if (kind === 'err') announce(`${state.guess[state.fx.num] || ''} — неверно`);
        // Буква, введённая в ответ, встаёт и в цитату — показать ближайшую такую плитку.
        const linked = tiles.find((tl) => tl.n === state.fx.num);
        if (linked && !(state.sel && state.sel.z === 'q')) linked.btn.scrollIntoView?.({ block: 'nearest' });
      }
      if (lastSeq >= 0 && state.fx.clue >= 0 && state.fx.clueAt === state.fx.at) {
        const c = state.clues[state.fx.clue] || {};
        announce(`Слово отгадано: ${String(c.w || '').toLowerCase()} — ${c.ru || ''}`);
      }
      lastSeq = state.fx.seq;
    }
    const sn = H.selNum(state);
    const s = state.sel;
    el.classList.toggle('solved', solved);

    for (const tile of tiles) {
      const { n, i } = tile;
      const g = state.guess[n];
      if (tile.b.textContent !== g) tile.b.textContent = g;
      const isSel = !solved && !!s && s.z === 'q' && s.i === i;
      let cls = 'wv-tile';
      if (state.given[n]) cls += ' given';
      else if (g) cls += ' filled';
      if (isSel) cls += ' sel';
      else if (!solved && n === sn) cls += ' link';
      if (state.chk[n]) cls += ' bad';
      if (state.rev[n]) cls += ' rev';
      cls += flashClass(n);
      if (tile.btn.className !== cls) tile.btn.className = cls;
      tile.btn.setAttribute('aria-label', label('Цитата', state, n, isSel, false));
      tile.btn.setAttribute('aria-disabled', state.given[n] || solved ? 'true' : 'false');
      if (isSel) tile.btn.setAttribute('aria-current', 'true');
      else tile.btn.removeAttribute('aria-current');
    }

    // Список определений: текущее — чернильный кружок и полный текст, отгаданные — шалфей и ✓.
    const k = state.cur >= 0 && state.cur < state.m ? state.cur : 0;
    rows.forEach((r, j) => {
      const c = state.clues[j] || {};
      const done = H.wordSolved(state, j);
      const cur = j === k;
      const cls = `wv-row${cur ? ' cur' : ''}${done ? ' done' : ''}`;
      if (r.btn.className !== cls) r.btn.className = cls;
      r.no.textContent = done && !cur ? '✓' : H.LABELS[j];
      const shown = state.shown.has(j);
      r.btn.setAttribute(
        'aria-label',
        `Ответ ${H.LABELS[j]}, ${tr(H.metaOf(c))}${done ? `, отгадан: ${String(c.w).toLowerCase()} — ${c.ru}` : shown ? `, перевод: ${c.ru}` : ''}. ${c.c || ''}`,
      );
      if (cur) r.btn.setAttribute('aria-current', 'true');
      else r.btn.removeAttribute('aria-current');
      if (!cur) return;
      const meta = posOnly(tr(H.metaOf(c)));
      if (r.meta.textContent !== meta) r.meta.textContent = meta;
      r.tr.className = `wv-tr${done ? ' ok' : shown ? ' hint' : ''}`;
      const trText = done ? `${String(c.w).toLowerCase()} — ${c.ru}` : shown ? c.ru : '';
      if (r.tr.textContent !== trText) r.tr.textContent = trText;
    });
    if (k !== lastRow) {
      // Первый показ — без анимации; дальше — плавно (если движение не отключено).
      revealRow(k, reduced || lastRow < 0);
      lastRow = k;
    }

    if (k !== shownClue) buildAnswer(state, k);
    const done = H.wordSolved(state, k);
    answer.setAttribute('aria-label', `Ответ ${H.LABELS[k] || ''}`);
    for (const cell of cells) {
      const { n, i } = cell;
      const g = state.guess[n];
      if (cell.b.textContent !== g) cell.b.textContent = g;
      const isSel = !solved && !!s && s.z === 'a' && s.k === k && s.i === i;
      let cls = 'wv-acell';
      if (state.given[n]) cls += ' given';
      else if (g) cls += ' filled';
      if (isSel) cls += ' sel';
      else if (!solved && n === sn) cls += ' link';
      if (done) cls += ' done';
      if (state.chk[n]) cls += ' bad';
      if (state.rev[n]) cls += ' rev';
      cls += flashClass(n);
      if (cell.btn.className !== cls) cell.btn.className = cls;
      cell.btn.setAttribute('aria-label', label(`Ответ ${H.LABELS[k]}, буква ${i + 1}`, state, n, isSel, done));
      cell.btn.setAttribute('aria-disabled', state.given[n] || solved ? 'true' : 'false');
      if (isSel) cell.btn.setAttribute('aria-current', 'true');
      else cell.btn.removeAttribute('aria-current');
    }

    // Выделенная плитка цитаты — в видимой части прокрутки.
    const selKey = s ? `${s.z}:${s.k}:${s.i}` : '';
    if (selKey !== lastSel) {
      lastSel = selKey;
      if (s && s.z === 'q') tiles[s.i]?.btn.scrollIntoView?.({ block: 'nearest' });
    }
  }

  return {
    el,
    update,
    destroy() {
      ro?.disconnect();
      clearTimeout(timers.pop);
      clearTimeout(timers.err);
      el.remove();
    },
  };
}
