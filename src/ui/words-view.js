// Вид режима «Слова» (§2.5, дизайн-система Lumin «Puzzle»): DOM-разметка вместо холста —
// плитки цитаты с номерами (слова не разрываются), фишки ответов, блок определения, клетки ответа.
// Тапы уходят оболочке через api.tap(target); состояние только читается. Всё, что нужно от логики
// режима, приходит в api.helpers (без циклического импорта src/modes/words.js).
import { h, icon } from './dom.js';
import { tr } from '../core/i18n.js';

const TILE_MAX = 31; // Lumin: плитка 31×39
const TILE_MIN = 21; // буква ≈ 12 px, номер 8 px — мельче нечитаемо
const TILE_FLOOR = 16; // только если иначе слово не влезает по ширине
const TILE_SCALE_MAX = 1.4; // Dynamic Type: плитки растут вместе с текстом, но не больше чем в 1.4 раза
const ANSWER_MAX = 34; // Lumin: клетка ответа 34×42
const POP_MS = 220; // Lumin: распространение буквы
const ERR_MS = 420;

/**
 * mountWordsView(root, api) → { update(state, info), destroy() }.
 * api: { tap(target), invalidate(), reducedMotion(), helpers: { tokenize, cellNum, selNum, wordSolved, LABELS, metaOf } }.
 */
export function mountWordsView(root, api) {
  const H = api.helpers;
  const el = h('div', { class: 'wv' });
  // Подписи клеток — по-русски (lang наследуется от <html lang="ru">); английский — только определение.
  const quote = h('div', { class: 'wv-quote', role: 'group', 'aria-label': 'Цитата' });
  const scroll = h('div', { class: 'wv-scroll' }, quote);
  const chips = h('div', { class: 'wv-chips', role: 'tablist', 'aria-label': 'Ответы' });
  const noEl = h('span', { class: 'wv-no', 'aria-hidden': 'true' });
  const defEl = h('p', { class: 'wv-def', lang: 'en' });
  const metaEl = h('div', { class: 'wv-meta' });
  const trEl = h('div', { class: 'wv-tr' });
  const prev = h('button', { class: 'wv-nav', type: 'button', 'aria-label': 'Предыдущий ответ', dataset: { step: '-1' } }, icon('back'));
  const next = h('button', { class: 'wv-nav next', type: 'button', 'aria-label': 'Следующий ответ', dataset: { step: '1' } }, icon('back'));
  const answer = h('div', { class: 'wv-answer', role: 'group', 'aria-label': 'Ответ' });
  // Озвучка ввода для VoiceOver: «E — неверно», «Слово отгадано: brush — щётка».
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const panel = h(
    'div',
    { class: 'wv-panel' },
    chips,
    h('div', { class: 'wv-clue' }, prev, h('div', { class: 'wv-clue-body' }, h('div', { class: 'wv-clue-head' }, noEl, defEl), metaEl, trEl), next),
    answer,
  );
  el.append(scroll, panel, live);
  root.appendChild(el);

  // Делегирование тапов: плитка/клетка ответа (data-z), фишка (data-clue), стрелка (data-step).
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
  let chipBtns = [];
  let cells = []; // клетки текущего ответа
  let shownClue = -1;
  let lastSeq = -1;
  // Анимации ввода — в отдельных слотах: быстрая следующая буква не гасит красную вспышку ошибки.
  const flashes = { pop: null, err: null };
  const timers = { pop: 0, err: 0 };
  let lastSel = '';
  let lastChip = -1;
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
    chipBtns = state.clues.map((c, k) => h('button', { class: 'wv-chip', type: 'button', role: 'tab', dataset: { clue: String(k) }, text: H.LABELS[k] }));
    chips.replaceChildren(...chipBtns);
    shownClue = -1;
    lastSeq = -1;
    lastChip = -1;
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

  /** Масштаб системного текста (Dynamic Type): размер шрифта определения к базовым 16 px. */
  function textScale() {
    const fs = typeof getComputedStyle === 'function' ? parseFloat(getComputedStyle(defEl).fontSize) || 16 : 16;
    return Math.max(1, Math.min(TILE_SCALE_MAX, fs / 16));
  }

  /**
   * Плитки — крупнейшего размера, при котором цитата помещается: по высоте без прокрутки и по
   * ширине (слово не разрывается — самое длинное слово должно влезть в строку карточки). Если не
   * помещается даже минимальная плитка (длинная цитата на маленьком экране) — она и прокрутка:
   * мельче плитки нечитаемы (Lumin: не уменьшать текст ниже читаемого; на телефоне цитата может
   * быть видна частично). Шире строки — только при словах длиннее ~13 букв.
   */
  function fit() {
    const avail = scroll.clientHeight;
    if (!avail) return;
    const k = textScale();
    const tmax = Math.round(TILE_MAX * k);
    const tmin = Math.round(TILE_MIN * k);
    const fitsWidth = () => quote.scrollWidth <= quote.clientWidth + 1;
    for (let t = tmax; t >= tmin; t--) {
      el.style.setProperty('--t', `${t}px`);
      if (fitsWidth() && quote.offsetHeight <= avail) return;
    }
    let t = tmin;
    el.style.setProperty('--t', `${t}px`);
    while (!fitsWidth() && t > TILE_FLOOR) el.style.setProperty('--t', `${--t}px`);
  }

  function fitAnswer(len) {
    const w = answer.clientWidth || el.clientWidth || 300;
    const gap = 6;
    const max = Math.round(ANSWER_MAX * textScale());
    const size = Math.max(18, Math.min(max, Math.floor((w - gap * (len - 1)) / Math.max(1, len))));
    el.style.setProperty('--a', `${size}px`);
  }

  // Подгонка — только при смене размера самого вида (поворот, клавиатура, Dynamic Type), а не при
  // смене ответа: панель ответа фиксированной высоты, плитки под пальцем не прыгают.
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

    const k = state.cur >= 0 && state.cur < state.m ? state.cur : 0;
    chipBtns.forEach((btn, j) => {
      const done = H.wordSolved(state, j);
      const cls = `wv-chip${j === k ? ' cur' : ''}${done ? ' done' : ''}`;
      if (btn.className !== cls) btn.className = cls;
      btn.setAttribute('aria-selected', j === k ? 'true' : 'false');
      btn.setAttribute('aria-label', `Ответ ${H.LABELS[j]}${done ? ', отгадан' : ''}`);
    });
    if (k !== lastChip) {
      lastChip = k;
      const chip = chipBtns[k];
      if (chip) {
        // Активная фишка — в видимой части ряда (прокрутка только самого ряда, не страницы).
        const r = chip.getBoundingClientRect();
        const c = chips.getBoundingClientRect();
        if (r.left < c.left) chips.scrollLeft -= c.left - r.left + 8;
        else if (r.right > c.right) chips.scrollLeft += r.right - c.right + 8;
      }
    }

    if (k !== shownClue) buildAnswer(state, k);
    const clue = state.clues[k] || {};
    noEl.textContent = H.LABELS[k] || '';
    defEl.textContent = clue.c || '';
    metaEl.textContent = tr(H.metaOf(clue));
    const done = H.wordSolved(state, k);
    trEl.className = `wv-tr${done ? ' ok' : state.shown.has(k) ? ' hint' : ''}`;
    trEl.textContent = done ? `✓ ${String(clue.w).toLowerCase()} — ${clue.ru}` : state.shown.has(k) ? clue.ru : '';
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
