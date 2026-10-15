// Режим «Потоки» (§2.3 спеки), контракт модуля режима — §5.1.
//
// Объект режима не трогает DOM, звук и хранилище. Состояние партии — упорядоченные дорожки
// потоков (от точки, с которой начали рисовать); производные поля (owner, dotOf) и кэш
// статического слоя (_cache) не сериализуются и восстанавливаются в create().

import { makeLayout, cellAt, cellCenter, traceCells, areAdjacent, distanceToSegment } from '../core/grid.js';
import { createOffscreen, pixelRatio, roundRect } from '../core/canvas.js';

const HYSTERESIS = 0.7; // доля центральной зоны клетки, в которой клетка считается достигнутой (§4.2)
const STEP_FLASH_MS = 260;
const CUT_FLASH_MS = 320;
const COMPLETE_FLASH_MS = 420;
const REJECT_FLASH_MS = 360;
const HINT_MS = 2500;
const WIN_PULSE_MS = 1200;
const BORN_MS = 200;
const STEP_FLASH_SLOTS = 8;
const DASH = [6, 6];
const NO_DASH = [];
const NO_EVENTS = [];

// Переиспользуемые объекты трассировки (pointer() не аллоцирует лишнего).
const P_FROM = { x: 0, y: 0 };
const P_TO = { x: 0, y: 0 };
let traceState = null;
let traceFlow = -1;
let rejectFrom = -1;
let rejectTo = -1;
let rejectReason = null;

/** canStep для traceCells; запоминает последний отказ, чтобы после трассы выдать событие reject. */
function traceCanStep(a, b) {
  const reason = stepReason(traceState, traceFlow, a, b);
  if (reason === null) return true;
  rejectFrom = a;
  rejectTo = b;
  rejectReason = reason;
  return false;
}

function dotPairs(flows) {
  return flows.map((path) => [path[0], path[path.length - 1]]);
}

/**
 * Пересобирает owner по дорожкам. Возвращает false, если дорожки невалидны: пересекаются, не
 * 4-связны, начинаются не со своей точки, проходят через чужую точку или через свою точку
 * внутри дорожки (своя вторая точка допустима только последней клеткой — путь завершён).
 */
function rebuildOwner(state) {
  const { owner, paths, dots, dotOf, n } = state;
  owner.fill(-1);
  for (let f = 0; f < paths.length; f++) {
    const path = paths[f];
    if (path.length === 0 || (path[0] !== dots[f][0] && path[0] !== dots[f][1])) return false;
    for (let i = 0; i < path.length; i++) {
      const c = path[i];
      if (!Number.isInteger(c) || c < 0 || c >= n * n || owner[c] !== -1) return false;
      if (i > 0 && !areAdjacent(path[i - 1], c, n)) return false;
      const dot = dotOf[c];
      if (dot >= 0 && dot !== f) return false;
      if (dot === f && i > 0 && i !== path.length - 1) return false;
      owner[c] = f;
    }
  }
  return true;
}

/**
 * Совпадают ли два набора дорожек поклеточно (для подсчёта хода по итогу росчерка). Дорожка из
 * одной клетки — это просто точка без линии, поэтому [a] и [b] (две точки одного потока) равны.
 * Дорожка, перерисованная с другой точки (развёрнутая), занимает те же клетки той же линией —
 * поле не изменилось, это тоже не ход (§2.3).
 */
function pathsEqual(a, b) {
  for (let f = 0; f < a.length; f++) {
    const p = a[f];
    const q = b[f];
    const len = p.length;
    if (len !== q.length) return false;
    if (len === 1) continue;
    let same = true;
    for (let i = 0; i < len; i++) {
      if (p[i] !== q[i]) {
        same = false;
        break;
      }
    }
    if (same) continue;
    for (let i = 0; i < len; i++) if (p[i] !== q[len - 1 - i]) return false;
  }
  return true;
}

function otherDot(state, f) {
  const path = state.paths[f];
  const [a, b] = state.dots[f];
  return path[0] === a ? b : a;
}

function isComplete(state, f) {
  const path = state.paths[f];
  return path.length >= 2 && path[path.length - 1] === otherDot(state, f);
}

function filledCells(state) {
  let filled = 0;
  for (const path of state.paths) filled += path.length;
  return filled;
}

/** Клетки, занятые линиями (дорожки длины ≥ 2): одноклеточная дорожка — просто точка, не заполнение. */
function lineCells(state) {
  let filled = 0;
  for (const path of state.paths) if (path.length >= 2) filled += path.length;
  return filled;
}

/** Укорачивает дорожку потока f до длины len, освобождая клетки. Возвращает true, если что-то убрано. */
function truncatePath(state, f, len) {
  const path = state.paths[f];
  if (path.length <= len) return false;
  for (let i = len; i < path.length; i++) state.owner[path[i]] = -1;
  path.length = len;
  return true;
}

/**
 * Правило шага из клетки a в соседнюю b для потока f: null — шаг легален (пустая клетка, своя
 * клетка — укорочение, чужая дорожка — обрезка, вторая точка — завершение), иначе причина отказа.
 */
function stepReason(state, f, a, b) {
  const path = state.paths[f];
  if (a === otherDot(state, f)) return 'complete'; // путь завершён — дальше не растёт
  if (b === path[0] && a !== path[1]) return 'own-start'; // повторный вход в свою первую точку (не откат по дорожке)
  const dot = state.dotOf[b];
  if (dot >= 0 && dot !== f) return 'foreign-dot'; // чужую точку пройти нельзя
  return null;
}

/**
 * Применяет шаг потока f в клетку c (уже проверенную правилами). Укорочение по своей клетке,
 * обрезка чужой дорожки, завершение. Пишет события в out. Возвращает true, если поле изменилось.
 */
function applyStep(state, f, c, t, out) {
  const path = state.paths[f];
  const owner = state.owner[c];
  if (owner === f) {
    const idx = path.indexOf(c);
    return truncatePath(state, f, idx + 1);
  }
  if (owner >= 0) {
    // Проведение по чужой дорожке: у чужого потока остаётся префикс до клетки касания.
    const cutIdx = state.paths[owner].indexOf(c);
    truncatePath(state, owner, cutIdx);
    state._fx.cutT[owner] = t;
    out.push({ kind: 'cut', flow: owner, cell: c });
  }
  path.push(c);
  state.owner[c] = f;
  const fx = state._fx;
  fx.stepCell[fx.stepPtr] = c;
  fx.stepT[fx.stepPtr] = t;
  fx.stepPtr = (fx.stepPtr + 1) % STEP_FLASH_SLOTS;
  out.push({ kind: 'step', flow: f, cell: c });
  if (c === otherDot(state, f)) {
    fx.completeT[f] = t;
    out.push({ kind: 'complete', flow: f });
  }
  return true;
}

function checkSolved(state, t, out) {
  const solved = isSolvedState(state);
  if (solved && !state.solved) {
    state.solved = true;
    state._fx.solvedT = t;
    // Победа наступает внутри move, а up после неё оболочка режиму не передаёт — ход
    // засчитывается сразу (поле заведомо изменилось: до росчерка победы не было).
    countMove(state);
    out.push({ kind: 'solved' });
  } else if (!solved && state.solved) {
    state.solved = false;
  }
}

function isSolvedState(state) {
  for (let f = 0; f < state.paths.length; f++) if (!isComplete(state, f)) return false;
  return filledCells(state) === state.n * state.n;
}

function emitReject(state, reason, cell, t, out) {
  const drag = state._drag;
  if (drag.lastReject === cell) return;
  drag.lastReject = cell;
  state._fx.rejectT = t;
  state._fx.rejectCell = cell;
  out.push({ kind: 'reject', reason, cell });
}

/** Последовательно применяет клетки трассы (без первой — головы). Возвращает true при изменении. */
function applyTrace(state, f, cells, count, t, out) {
  let changed = false;
  for (let i = 1; i < count; i++) {
    if (applyStep(state, f, cells[i], t, out)) changed = true;
  }
  return changed;
}

function pointerDown(state, layout, ev, out) {
  const drag = state._drag;
  if (drag.active) finishStroke(state);
  const cell = cellAt(ev.x, ev.y, layout, 1);
  if (cell < 0) return;
  const dot = state.dotOf[cell];
  const owner = state.owner[cell];
  if (dot < 0 && owner < 0) return; // пустая клетка — ничего
  drag.px = ev.x;
  drag.py = ev.y;
  drag.lastReject = -1;
  drag.changed = false;
  drag.counted = false;
  drag.startPaths = state.paths.map((path) => path.slice()); // поле до росчерка — для подсчёта хода
  drag.active = true;
  if (dot >= 0) {
    // Точка потока: путь начинается заново от неё, старый путь стирается.
    const path = state.paths[dot];
    const hadPath = path.length > 1;
    truncatePath(state, dot, 0);
    path.push(cell);
    state.owner[cell] = dot;
    drag.flow = dot;
    drag.pending = -1;
    state.lastTouched = dot;
    if (hadPath) {
      drag.changed = true;
      out.push({ kind: 'changed' });
      checkSolved(state, ev.t, out);
    }
    return;
  }
  // Своя дорожка: укорочение до этой клетки, когда палец покинет её (см. pointerMove).
  drag.flow = owner;
  drag.pending = cell;
  state.lastTouched = owner;
}

function pointerMove(state, layout, ev, out) {
  const drag = state._drag;
  if (!drag.active) return;
  const f = drag.flow;
  const path = state.paths[f];
  const n = state.n;
  let changed = false;

  if (drag.pending >= 0) {
    // Укорочение до клетки касания — когда палец её покинул (§2.3): дрожание в 1–2 px внутри
    // клетки при случайном тапе не должно разрушать дорожку.
    if (cellAt(ev.x, ev.y, layout, 1) === drag.pending) {
      drag.px = ev.x;
      drag.py = ev.y;
      return;
    }
    const idx = path.indexOf(drag.pending);
    drag.pending = -1;
    if (idx >= 0 && truncatePath(state, f, idx + 1)) changed = true;
  }

  P_FROM.x = drag.px;
  P_FROM.y = drag.py;
  P_TO.x = ev.x;
  P_TO.y = ev.y;
  drag.px = ev.x;
  drag.py = ev.y;

  let head = path[path.length - 1];
  traceState = state;
  traceFlow = f;
  rejectFrom = -1;
  const trace = traceCells(P_FROM, P_TO, layout, n, traceCanStep);
  traceState = null;
  const deep = cellAt(ev.x, ev.y, layout, HYSTERESIS);
  const under = cellAt(ev.x, ev.y, layout, 1);

  if (trace.length > 0 && trace[0] === head) {
    let count = trace.length;
    // Гистерезис: клетка под пальцем достигнута только в её центральной зоне.
    if (deep < 0 && count > 1 && trace[count - 1] === under) {
      count--;
      // Отброшенная клетка не применена — якорь следующей трассы остаётся на голове, иначе при
      // быстром свайпе следующий сэмпл стартует из непройденной клетки (trace[0] ≠ head) и
      // дорожка «замирает» до возврата пальца к голове (§4.2, §8).
      const hc = cellCenter(trace[count - 1], layout);
      drag.px = hc.x;
      drag.py = hc.y;
    }
    if (applyTrace(state, f, trace, count, ev.t, out)) {
      changed = true;
      drag.lastReject = -1;
    }
    head = path[path.length - 1];
    // Трасса остановилась раньше пальца из-за отказа на шаге из головы — событие reject
    // (завершённый путь просто не растёт, без отказа). Когда палец вышел за сетку, отказ
    // учитывается, только если отвергнутая клетка действительно лежит на отрезке движения: на
    // углу traceCells пробует обе промежуточные клетки, и отказ «пробной» клетки при выходе за
    // сетку — не отказ игрока. Внутри поля фильтр не применяется: точная диагональ в чужую точку
    // лежит на границе порога и должна давать отказ.
    if (
      count === trace.length &&
      trace[count - 1] !== under &&
      rejectFrom === head &&
      rejectReason !== 'complete' &&
      (under >= 0 || distanceToSegment(cellCenter(rejectTo, layout), P_FROM, P_TO) < layout.cell * Math.SQRT1_2 - 1e-6)
    ) {
      emitReject(state, rejectReason, rejectTo, ev.t, out);
    }
  } else if (deep >= 0) {
    // Палец не синхронизирован с головой: ждём возврата на свою клетку (кроме первой точки —
    // вход в неё проверяется правилом шага) или к соседу головы.
    if (state.owner[deep] === f && deep !== path[0]) {
      if (applyStep(state, f, deep, ev.t, out)) changed = true;
    } else if (areAdjacent(head, deep, n)) {
      const reason = stepReason(state, f, head, deep);
      if (reason === null) {
        if (applyStep(state, f, deep, ev.t, out)) {
          changed = true;
          drag.lastReject = -1;
        }
      } else if (reason !== 'complete') {
        emitReject(state, reason, deep, ev.t, out);
      }
    }
  }

  if (changed) {
    drag.changed = true;
    out.push({ kind: 'changed' });
    checkSolved(state, ev.t, out);
  }
}

/** Засчитывает ход текущего росчерка (не более одного раза на росчерк). */
function countMove(state) {
  const drag = state._drag;
  if (!drag.active || drag.counted) return;
  drag.counted = true;
  state.moves++;
}

/**
 * Конец росчерка (up/cancel/новый down). Ход = росчерк, изменивший поле (§2.3): сравнивается
 * поле до росчерка и после — росчерк, вернувший дорожки в исходный вид, ходом не считается.
 * Победа внутри move засчитывает ход сразу (см. checkSolved).
 */
function finishStroke(state) {
  const drag = state._drag;
  if (!drag.active) return;
  if (drag.changed && !drag.counted && !pathsEqual(drag.startPaths, state.paths)) countMove(state);
  drag.active = false;
  drag.pending = -1;
  drag.changed = false;
  drag.counted = false;
  drag.startPaths = null;
}

// ---------------------------------------------------------------------------------------------
// Подсказка

/** Число эталонных клеток потока f, занятых сейчас не им (пустых или чужих). */
function divergence(state, f) {
  let count = 0;
  for (const c of state.flows[f]) if (state.owner[c] !== f) count++;
  return count;
}

/**
 * Поток для подсказки или -1, если поле решено. Сначала незавершённые: последний тронутый,
 * иначе самый короткий по эталону (unique:false — с наименьшим числом конфликтов). Если все
 * пары соединены, а поле не заполнено, — поток, расходящийся с эталоном: последний тронутый,
 * иначе с наибольшим расхождением (при равенстве — короче по эталону, затем меньший индекс).
 */
function chooseHintFlow(state) {
  const F = state.paths.length;
  const last = state.lastTouched >= 0 && state.lastTouched < F ? state.lastTouched : -1;
  if (last >= 0 && !isComplete(state, last)) return last;
  let chosen = -1;
  let best = Infinity;
  for (let f = 0; f < F; f++) {
    if (isComplete(state, f)) continue;
    let score = state.flows[f].length;
    if (!state.unique) {
      // В неуникальном уровне эталон может расходиться с верной дорожкой игрока — режем меньше.
      let conflicts = 0;
      for (const c of state.flows[f]) if (state.owner[c] >= 0 && state.owner[c] !== f) conflicts++;
      score = conflicts * 1000 + score;
    }
    if (score < best) {
      best = score;
      chosen = f;
    }
  }
  if (chosen >= 0) return chosen;
  if (isSolvedState(state)) return -1;
  // Все пары соединены, но остались пустые клетки: эталон — полное решение, поэтому поток с
  // расхождением есть всегда, и его раскрытие даёт прогресс.
  if (last >= 0 && divergence(state, last) > 0) return last;
  let bestDiff = 0;
  for (let f = 0; f < F; f++) {
    const d = divergence(state, f);
    if (d > bestDiff || (d === bestDiff && d > 0 && state.flows[f].length < state.flows[chosen].length)) {
      bestDiff = d;
      chosen = f;
    }
  }
  return chosen;
}

// ---------------------------------------------------------------------------------------------
// Рендер

function ensureCache(ctx, state, layout, theme) {
  const size = layout.cell * layout.n;
  const dpr = pixelRatio(ctx);
  let cache = state._cache;
  const fresh = !cache || cache.size !== size || cache.themeId !== theme.id || cache.dpr !== dpr;
  if (!fresh) return cache;
  if (!cache) {
    cache = { canvas: null, ctx: null, size: 0, themeId: null, dpr: 1 };
    state._cache = cache;
  }
  cache.size = size;
  cache.themeId = theme.id;
  cache.dpr = dpr;
  const px = Math.max(1, Math.ceil(size * dpr));
  if (!cache.canvas) {
    cache.canvas = createOffscreen(px, px);
    if (cache.canvas && typeof cache.canvas.getContext === 'function') cache.ctx = cache.canvas.getContext('2d');
    if (!cache.ctx) cache.canvas = null;
  }
  if (cache.canvas) {
    cache.canvas.width = px;
    cache.canvas.height = px;
    const c = cache.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, size, size);
    drawStatic(c, state, { x0: 0, y0: 0, cell: layout.cell, n: layout.n }, theme);
  }
  return cache;
}

/** Статический слой: подложка, сетка, точки. */
function drawStatic(ctx, state, layout, theme) {
  const { x0, y0, cell, n } = layout;
  const size = cell * n;
  const radius = Math.min(14, cell * 0.35);
  ctx.fillStyle = theme.surface;
  roundRect(ctx, x0, y0, size, size, radius);
  ctx.fill();

  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < n; i++) {
    const p = Math.round(i * cell) + 0.5;
    ctx.moveTo(x0 + p, y0 + 1);
    ctx.lineTo(x0 + p, y0 + size - 1);
    ctx.moveTo(x0 + 1, y0 + p);
    ctx.lineTo(x0 + size - 1, y0 + p);
  }
  ctx.stroke();

  const dotR = cell * 0.3;
  for (let f = 0; f < state.dots.length; f++) {
    ctx.fillStyle = theme.flow[f % theme.flow.length];
    for (let s = 0; s < 2; s++) {
      const c = state.dots[f][s];
      const cx = x0 + ((c % n) + 0.5) * cell;
      const cy = y0 + (Math.floor(c / n) + 0.5) * cell;
      ctx.beginPath();
      ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function tracePath(ctx, path, layout) {
  const { x0, y0, cell, n } = layout;
  ctx.beginPath();
  for (let i = 0; i < path.length; i++) {
    const c = path[i];
    const cx = x0 + ((c % n) + 0.5) * cell;
    const cy = y0 + (Math.floor(c / n) + 0.5) * cell;
    if (i === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  }
}

function easeOut(p) {
  return 1 - (1 - p) * (1 - p);
}

/**
 * render(ctx, state, layout, theme, t, opts) → true, если нужен ещё кадр.
 * Статический слой — из кэша (OffscreenCanvas / canvas; без них — рисуется напрямую).
 * shadowBlur не используется: свечение — вторая широкая обводка с низкой альфой.
 */
function render(ctx, state, layout, theme, t, opts) {
  const reduced = !!(opts && opts.reducedMotion);
  const flowNumbers = !!(opts && opts.flowNumbers);
  const { x0, y0, cell, n } = layout;
  const size = cell * n;
  const fx = state._fx;
  let animating = false;

  // Появление уровня: всплытие 200 мс (без reducedMotion) — общий множитель альфы кадра.
  // Только для чистого состояния: восстановление снимка (undo, «Отменить сброс», возврат в партию)
  // уровень не «показывает заново» (§4.3).
  let base = 1;
  if (fx.born && opts && opts.appeared) fx.born = false; // оболочка: состояние после undo/restore
  if (fx.born) {
    if (!fx.bornStarted) {
      fx.bornStarted = true;
      fx.bornT = t;
    }
    const bornAge = t - fx.bornT;
    if (!reduced && bornAge < BORN_MS) {
      base = Math.max(0, Math.min(1, bornAge / BORN_MS));
      animating = true;
    } else {
      fx.born = false;
    }
  }
  ctx.globalAlpha = base;

  const cache = ensureCache(ctx, state, layout, theme);
  if (cache.canvas) ctx.drawImage(cache.canvas, x0, y0, size, size);
  else drawStatic(ctx, state, layout, theme);

  const lineW = cell * 0.32;
  const glowW = cell * 0.56;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  let pulse = 1;
  if (state.solved && !reduced && fx.solvedT > 0 && t - fx.solvedT < WIN_PULSE_MS) {
    pulse = 1 + 0.18 * Math.sin(((t - fx.solvedT) / WIN_PULSE_MS) * Math.PI * 3);
    animating = true;
  }

  for (let f = 0; f < state.paths.length; f++) {
    const path = state.paths[f];
    const color = theme.flow[f % theme.flow.length];
    // Подкраска клеток дорожки.
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.16 * base;
    for (let i = 0; i < path.length; i++) {
      const c = path[i];
      ctx.fillRect(x0 + (c % n) * cell + 1, y0 + Math.floor(c / n) * cell + 1, cell - 2, cell - 2);
    }
    if (path.length < 2) {
      ctx.globalAlpha = base;
      continue;
    }
    tracePath(ctx, path, layout);
    ctx.strokeStyle = color;
    let glowAlpha = 0.22;
    const completeAge = t - fx.completeT[f];
    if (fx.completeT[f] > 0 && completeAge < COMPLETE_FLASH_MS) {
      glowAlpha += 0.4 * (1 - completeAge / COMPLETE_FLASH_MS);
      animating = true;
    }
    ctx.globalAlpha = glowAlpha * base;
    ctx.lineWidth = glowW * pulse;
    ctx.stroke();
    ctx.globalAlpha = base;
    ctx.lineWidth = lineW * pulse;
    ctx.stroke();
    // Вспышка обрезанной дорожки.
    const cutAge = t - fx.cutT[f];
    if (fx.cutT[f] > 0 && cutAge < CUT_FLASH_MS) {
      ctx.globalAlpha = 0.7 * (1 - cutAge / CUT_FLASH_MS) * base;
      ctx.strokeStyle = theme.text;
      ctx.lineWidth = lineW;
      ctx.stroke();
      ctx.globalAlpha = base;
      animating = true;
    }
  }

  // Номера потоков на точках (настройка).
  if (flowNumbers) {
    ctx.font = `bold ${Math.max(10, Math.round(cell * 0.3))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let f = 0; f < state.dots.length; f++) {
      ctx.fillStyle = theme.flowText[f % theme.flowText.length];
      for (let s = 0; s < 2; s++) {
        const c = state.dots[f][s];
        ctx.fillText(String(f + 1), x0 + ((c % n) + 0.5) * cell, y0 + (Math.floor(c / n) + 0.5) * cell + 1);
      }
    }
  }

  // Вспышки шага: расходящееся кольцо.
  for (let i = 0; i < STEP_FLASH_SLOTS; i++) {
    const st = fx.stepT[i];
    if (st <= 0) continue;
    const age = t - st;
    if (age >= STEP_FLASH_MS) continue;
    if (reduced) continue;
    const p = age / STEP_FLASH_MS;
    const c = fx.stepCell[i];
    ctx.globalAlpha = 0.5 * (1 - p) * base;
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x0 + ((c % n) + 0.5) * cell, y0 + (Math.floor(c / n) + 0.5) * cell, cell * (0.2 + 0.3 * easeOut(p)), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = base;
    animating = true;
  }

  // Отказ: красное кольцо с дрожанием по горизонтали.
  if (fx.rejectT > 0 && t - fx.rejectT < REJECT_FLASH_MS && fx.rejectCell >= 0) {
    const age = t - fx.rejectT;
    const p = age / REJECT_FLASH_MS;
    const c = fx.rejectCell;
    const shake = reduced ? 0 : Math.sin(age / 18) * 3 * (1 - p);
    ctx.globalAlpha = 0.9 * (1 - p) * base;
    ctx.strokeStyle = theme.danger;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x0 + ((c % n) + 0.5) * cell + shake, y0 + (Math.floor(c / n) + 0.5) * cell, cell * 0.38, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = base;
    animating = true;
  }

  // Подсказка: пунктир вдоль раскрытого потока, мягко пульсирует до until (гасит оболочка).
  const hint = state.hint;
  if (hint && hint.kind === 'flow' && t < hint.until && hint.cells && hint.cells.length >= 2) {
    const left = (hint.until - t) / HINT_MS;
    ctx.globalAlpha = Math.min(1, left * 3) * (reduced ? 0.9 : 0.7 + 0.3 * Math.sin(t / 120)) * base;
    ctx.strokeStyle = theme.hint;
    ctx.lineWidth = Math.max(2, lineW * 0.35);
    ctx.setLineDash(DASH);
    tracePath(ctx, hint.cells, layout);
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
    ctx.globalAlpha = base;
    animating = true;
  }

  ctx.globalAlpha = 1;
  return animating;
}

// ---------------------------------------------------------------------------------------------
// Объект режима

const flowMode = {
  id: 'flow',
  icon: 'flow',
  name: { ru: 'Потоки', en: 'Flows' },
  tagline: { ru: 'Соедини пары, заполни поле', en: 'Connect the pairs, fill the board' },
  helpText: {
    ru: 'Соедини каждую пару точек дорожкой своего цвета. Дорожки не пересекаются, все клетки должны быть заполнены.',
    en: 'Connect each pair of dots with a path of its colour. Paths never cross and every cell must be filled.',
  },
  color: '#92BCC5', // Lumin (§4.4): приглушённый оттенок режима для тёмной темы
  colorLight: '#4F7C86',

  /** create(levelData, saved) → state. Битый снимок игнорируется — создаётся чистое состояние. */
  create(levelData, saved) {
    const n = levelData.n;
    const flows = levelData.flows.map((path) => path.slice());
    const flowCount = flows.length;
    const dots = dotPairs(flows);
    const state = {
      n,
      flows,
      dots,
      unique: levelData.unique !== false,
      paths: dots.map((pair) => [pair[0]]),
      moves: 0,
      hintUsed: false,
      hint: null,
      lastTouched: -1,
      solved: false,
      owner: new Int8Array(n * n).fill(-1),
      dotOf: new Int8Array(n * n).fill(-1),
      _cache: null,
      _drag: { active: false, flow: -1, pending: -1, changed: false, counted: false, startPaths: null, px: 0, py: 0, lastReject: -1 },
      _fx: {
        stepCell: new Int16Array(STEP_FLASH_SLOTS),
        stepT: new Float64Array(STEP_FLASH_SLOTS),
        stepPtr: 0,
        cutT: new Float64Array(flowCount),
        completeT: new Float64Array(flowCount),
        rejectT: 0,
        rejectCell: -1,
        solvedT: 0,
        born: !saved, // всплытие — только при появлении уровня, не при восстановлении снимка
        bornStarted: false,
        bornT: 0,
      },
    };
    for (let f = 0; f < flowCount; f++) {
      state.dotOf[dots[f][0]] = f;
      state.dotOf[dots[f][1]] = f;
    }
    if (saved && Array.isArray(saved.paths) && saved.paths.length === flowCount) {
      state.paths = saved.paths.map((path) => (Array.isArray(path) ? path.slice() : []));
      if (!rebuildOwner(state)) state.paths = dots.map((pair) => [pair[0]]);
      state.moves = Number.isInteger(saved.moves) && saved.moves >= 0 ? saved.moves : 0;
      state.hintUsed = !!saved.hintUsed;
      const lt = saved.lastTouched;
      state.lastTouched = Number.isInteger(lt) && lt >= 0 && lt < flowCount ? lt : -1;
    }
    rebuildOwner(state);
    state.solved = isSolvedState(state);
    return state;
  },

  serialize(state) {
    return {
      paths: state.paths.map((path) => path.slice()),
      moves: state.moves,
      hintUsed: state.hintUsed,
      lastTouched: state.lastTouched,
    };
  },

  /** layout(state, rect, theme) → { x0, y0, cell, n, size } — квадрат по меньшей стороне rect. */
  layout(state, rect) {
    const l = makeLayout(rect, state.n, 2);
    return { x0: l.x0, y0: l.y0, cell: l.cell, n: l.n, size: l.cell * l.n };
  },

  render,

  /** pointer(state, layout, ev) → events[]; ev = { type:'down'|'move'|'up'|'cancel', x, y, t }. */
  pointer(state, layout, ev) {
    const out = [];
    switch (ev.type) {
      case 'down':
        pointerDown(state, layout, ev, out);
        break;
      case 'move':
        pointerMove(state, layout, ev, out);
        break;
      case 'up':
      case 'cancel':
        finishStroke(state);
        break;
      default:
        break;
    }
    return out.length === 0 ? NO_EVENTS : out;
  },

  isSolved(state) {
    return isSolvedState(state);
  },

  /** Очищает поле: все дорожки — к первой точке; moves обнуляется, hintUsed не трогается. */
  reset(state) {
    for (let f = 0; f < state.paths.length; f++) {
      truncatePath(state, f, 0);
      state.paths[f].push(state.dots[f][0]);
      state.owner[state.dots[f][0]] = f;
    }
    state.moves = 0;
    state.hint = null;
    state.solved = false;
    state._drag.active = false;
    state._drag.pending = -1;
    state._drag.changed = false;
    state._drag.counted = false;
    state._drag.startPaths = null;
  },

  /**
   * hint(state, t): раскрыть один незавершённый поток целиком (последний тронутый, иначе самый
   * короткий по решению; для unique:false — с наименьшим числом конфликтов с текущими дорожками).
   * Если все пары соединены, но поле не заполнено, раскрывается поток, дорожка которого расходится
   * с эталоном (его эталонные клетки и закрывают дыры). Мешающие чужие дорожки обрезаются по
   * правилу обрезки. Ставит state.hint, hintUsed = true. kind:'none' — только для решённого поля.
   */
  hint(state, t) {
    const chosen = chooseHintFlow(state);
    if (chosen < 0) {
      state.hint = { kind: 'none', until: t + HINT_MS };
      return state.hint;
    }
    const F = state.paths.length;
    const f = chosen;
    const solution = state.flows[f];
    const path = state.paths[f];
    // Ориентация — от точки, с которой игрок начал рисовать.
    const cells = path[0] === solution[0] ? solution.slice() : solution.slice().reverse();
    // Обрезка мешающих чужих дорожек: префикс до первой клетки касания (не включая её).
    for (let g = 0; g < F; g++) {
      if (g === f) continue;
      const other = state.paths[g];
      for (let i = 1; i < other.length; i++) {
        if (solution.includes(other[i])) {
          truncatePath(state, g, i);
          state._fx.cutT[g] = t;
          break;
        }
      }
    }
    truncatePath(state, f, 0);
    for (const c of cells) {
      path.push(c);
      state.owner[c] = f;
    }
    state._fx.completeT[f] = t;
    state.hintUsed = true;
    state.lastTouched = f;
    state.hint = { kind: 'flow', flow: f, cells, until: t + HINT_MS };
    state.solved = isSolvedState(state);
    if (state.solved) state._fx.solvedT = t;
    return state.hint;
  },

  stats(state) {
    const F = state.paths.length;
    return { lines: [{ ru: `Ходов ${state.moves} / ${F}`, en: `Moves ${state.moves} / ${F}` }] };
  },

  perfect(state) {
    return state.moves === state.paths.length;
  },

  /**
   * ghost(levelData, layout?) → первые 4 клетки решения первого потока (§5.1). С layout —
   * центры клеток в координатах холста; без него — в единицах сетки (столбец + 0.5, строка + 0.5).
   */
  ghost(levelData, layout) {
    const n = levelData.n;
    const path = levelData.flows[0];
    if (!path || path.length < 2) return null;
    const count = Math.min(4, path.length);
    const points = [];
    for (let i = 0; i < count; i++) {
      const c = path[i];
      const gx = (c % n) + 0.5;
      const gy = Math.floor(c / n) + 0.5;
      points.push(layout ? { x: layout.x0 + gx * layout.cell, y: layout.y0 + gy * layout.cell, cell: c } : { x: gx, y: gy, cell: c });
    }
    return points;
  },

  nextLabel() {
    return null;
  },

  footer(state) {
    // Коротко, чтобы не переносилось на 375pt; одиночные точки заполнением не считаются.
    const pct = Math.round((lineCells(state) / (state.n * state.n)) * 100);
    return { ru: `ходов ${state.moves} · ${pct} %`, en: `moves ${state.moves} · ${pct} %` };
  },
};

export default flowMode;
