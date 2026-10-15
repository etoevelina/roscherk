// Режим «Маршрут» (zip) — объект режима по контракту §5.1 спеки; правила — §2.2.
// Модуль не трогает DOM, звук и хранилище: только чистое состояние, ввод и рисование в ctx.
// Статический слой (сетка, стены) кэшируется в state._cache (не сериализуется).
import { makeLayout, cellAt, cellCenter, traceCells, areAdjacent } from '../core/grid.js';
import { createOffscreen, pixelRatio, roundRect } from '../core/canvas.js';

const HYSTERESIS = 0.7; // центральная зона клетки, в которой палец «достиг» её (§4.2)
const HINT_MS = 2500;
const STEP_FLASH_MS = 220;
const REJECT_MS = 360;
const WIN_PULSE_MS = 1200;
const APPEAR_MS = 200;
const PULSE_ACTIVE_MS = 4000; // пульс «следующего числа» идёт столько после последнего изменения
const BOARD_PAD = 6; // поля вокруг сетки под толщину стен и рамки (CSS px)
const MARK_R = 0.34; // радиус плитки под числом в долях клетки
const FONT = '-apple-system, system-ui, "SF Pro Text", "Helvetica Neue", Arial, sans-serif';

// Биты стен по направлениям: 0 — вверх, 1 — вправо, 2 — вниз, 3 — влево.
function dirBit(a, b, n) {
  if (b === a - n) return 1;
  if (b === a + 1) return 2;
  if (b === a + n) return 4;
  if (b === a - 1) return 8;
  return 0;
}

/** Статические производные данные уровня (не сериализуются). */
function buildStatic(level) {
  const n = level.n;
  const N = n * n;
  const markOf = new Uint8Array(N);
  let K = 0;
  for (const [cell, m] of level.marks) {
    markOf[cell] = m;
    if (m > K) K = m;
  }
  let startCell = -1;
  let goalCell = -1;
  for (const [cell, m] of level.marks) {
    if (m === 1) startCell = cell;
    if (m === K) goalCell = cell;
  }
  const wallBits = new Uint8Array(N);
  const walls = level.walls || [];
  for (const [a, b] of walls) {
    wallBits[a] |= dirBit(a, b, n);
    wallBits[b] |= dirBit(b, a, n);
  }
  // Числа, отсортированные по значению — для рендера и подсказки.
  const marks = level.marks.slice().sort((p, q) => p[1] - q[1]);
  return { n, N, K, markOf, startCell, goalCell, wallBits, walls, marks };
}

function hasWall(state, a, b) {
  return (state.wallBits[a] & dirBit(a, b, state.n)) !== 0;
}

/** Снимок пути допустим: начинается с 1, без повторов, по соседям, без стен, числа по порядку. */
function validPrefix(state, cells) {
  if (!Array.isArray(cells) || cells.length > state.N) return false;
  if (cells.length === 0) return true;
  if (cells[0] !== state.startCell) return false;
  const seen = new Uint8Array(state.N);
  let next = 2;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (!Number.isInteger(c) || c < 0 || c >= state.N || seen[c]) return false;
    seen[c] = 1;
    if (i > 0) {
      if (!areAdjacent(cells[i - 1], c, state.n) || hasWall(state, cells[i - 1], c)) return false;
      const m = state.markOf[c];
      if (m !== 0) {
        if (m !== next) return false;
        if (c === state.goalCell && i !== state.N - 1) return false;
        next++;
      }
    }
  }
  return true;
}

function pushCell(state, cell) {
  const len = state.path.length;
  state.path.push(cell);
  state.posOf[cell] = len;
  const m = state.markOf[cell];
  if (m !== 0) state.nextMark = m + 1;
  state.marksUpTo[len] = state.nextMark;
}

/** Укоротить путь до keep клеток; возвращает число убранных клеток. */
function truncateTo(state, keep) {
  let removed = 0;
  while (state.path.length > keep) {
    const c = state.path.pop();
    state.posOf[c] = -1;
    removed++;
  }
  state.nextMark = keep > 0 ? state.marksUpTo[keep - 1] : 1;
  state.backtracks += removed;
  return removed;
}

function markChanged(state, t) {
  state.changedAt = t;
}

/** Отказ с тряской клетки: событие reject и визуальный отклик. */
function rejectCell(state, events, t, reason, cell, extra) {
  events.push({ kind: 'reject', reason, cell, ...extra });
  state.fx.rejectAt = t;
  state.fx.rejectCell = cell;
}

/** Отказ со вспышкой стены между a и b. */
function rejectWall(state, events, t, a, b) {
  events.push({ kind: 'reject', reason: 'wall', edge: a < b ? [a, b] : [b, a] });
  state.fx.rejectAt = t;
  state.fx.rejectCell = -1;
  state.fx.rejectWallA = a;
  state.fx.rejectWallB = b;
}

/**
 * Один шаг росчерка в клетку b из клетки курсора. Возвращает true, если шаг принят (или был
 * движением по дорожке), false — при отказе (событие reject уже записано в events).
 */
function applyStep(state, b, events, t) {
  const drag = state.drag;
  const cursor = drag.cursor;
  const a = state.path[cursor];
  const p = state.posOf[b];
  if (p >= 0) {
    // Движение по собственной дорожке: назад — укорачивает, вперёд — лишь сдвигает курсор.
    if (p < cursor) {
      truncateTo(state, p + 1);
      state.solved = false;
      markChanged(state, t);
      state.dirty = true;
    }
    drag.cursor = p;
    return true;
  }
  if (hasWall(state, a, b)) {
    rejectWall(state, events, t, a, b);
    return false;
  }
  if (a === state.goalCell) {
    // Клетка K терминальна — из неё дорожка не растёт.
    rejectCell(state, events, t, 'terminal', b);
    state.fx.rejectCell = a;
    return false;
  }
  const m = state.markOf[b];
  if (m !== 0) {
    if (b === state.goalCell) {
      const remaining = state.N - (cursor + 1) - 1;
      if (remaining > 0) {
        rejectCell(state, events, t, 'early-finish', b, { remaining });
        return false;
      }
    } else if (m !== state.marksUpTo[cursor]) {
      rejectCell(state, events, t, 'order', b, { expected: state.marksUpTo[cursor] });
      return false;
    }
  }
  if (state.path.length - 1 > cursor) truncateTo(state, cursor + 1);
  pushCell(state, b);
  drag.cursor = state.path.length - 1;
  state.fx.stepAt = t;
  state.fx.stepCell = b;
  events.push({ kind: 'step', cell: b, length: state.path.length });
  markChanged(state, t);
  state.dirty = true;
  if (b === state.goalCell && state.path.length === state.N) {
    state.solved = true;
    state.solvedAt = t;
    events.push({ kind: 'solved' });
  }
  return true;
}

/** Начать трассировку от курсора: контекст canStep — клетка, длина дорожки, ожидаемое число. */
function beginTrace(state) {
  const cursor = state.drag.cursor;
  state.trace.cur = state.path[cursor];
  state.trace.len = cursor + 1;
  state.trace.expected = state.marksUpTo[cursor];
  state.rej.reason = '';
}

/**
 * Правило шага для трассировки (§4.2). Проверка точная: стены, порядок чисел, ранний вход в K
 * и терминальность K считаются по дорожке, какой она станет после шагов, уже принятых
 * трассировкой (state.trace), — иначе на углу промежуточной клеткой могла быть выбрана K или
 * число не по порядку, и легальная альтернатива терялась (ложный отказ). Отказ запоминается
 * в state.rej для события.
 */
function makeCanStep(state) {
  const trace = state.trace;
  const rej = state.rej;
  const deny = (a, b, reason) => {
    rej.a = a;
    rej.b = b;
    rej.reason = reason;
    return false;
  };
  return (a, b) => {
    if (a !== trace.cur) {
      // Трассировка приняла шаг в a: по клетке дорожки — курсор/укорочение до неё, иначе рост.
      trace.cur = a;
      const pa = state.posOf[a];
      if (pa >= 0) {
        trace.len = pa + 1;
        trace.expected = state.marksUpTo[pa];
      } else {
        trace.len++;
        const ma = state.markOf[a];
        if (ma !== 0) trace.expected = ma + 1;
      }
    }
    // Возврат на свою дорожку — всегда укорочение (как в applyStep): стена и терминальность K
    // этому не мешают, иначе шаг назад через стену давал бы ложный отказ и блокировку.
    if (state.posOf[b] >= 0) return true;
    if (hasWall(state, a, b)) return deny(a, b, 'wall');
    if (a === state.goalCell) return deny(a, b, 'terminal');
    const m = state.markOf[b];
    if (m === 0) return true;
    if (b === state.goalCell) {
      const remaining = state.N - trace.len - 1;
      if (remaining <= 0) return true;
      rej.remaining = remaining;
      return deny(a, b, 'early-finish');
    }
    if (m === trace.expected) return true;
    rej.expected = trace.expected;
    return deny(a, b, 'order');
  };
}

/** Событие отказа по причине, на которой остановилась трассировка (state.rej). */
function rejectFromTrace(state, events, t) {
  const rej = state.rej;
  if (rej.reason === 'wall') rejectWall(state, events, t, rej.a, rej.b);
  else if (rej.reason === 'order') rejectCell(state, events, t, 'order', rej.b, { expected: rej.expected });
  else if (rej.reason === 'early-finish') rejectCell(state, events, t, 'early-finish', rej.b, { remaining: rej.remaining });
}

function nextMarkCell(state) {
  if (state.nextMark > state.K) return -1;
  return state.marks[state.nextMark - 1][0];
}

/** Палитра поля WORDS с откатом на прежние поля темы (тесты и старые объекты theme). */
function boardColors(theme) {
  return {
    paper: theme.paper || theme.surface,
    tile: theme.tile || theme.surface2,
    ink: theme.ink || theme.text,
    hairline: theme.hairline || theme.grid,
  };
}

/** Плитка под числом: белый диск (бумага светлее поля) с тонкой обводкой, как плитки букв WORDS. */
function markTile(ctx, cx, cy, r, fill, ring, ringW) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = ring;
  ctx.lineWidth = ringW;
  ctx.stroke();
}

/**
 * Рисование статического слоя (WORDS, docs/DESIGN.md §5.6): поле — бумага со скруглением и тонкой
 * обводкой на холсте, сетка — волосяные линии, под числами — плитки, рамка и стены — чернила.
 */
function drawStatic(ctx, state, lay, theme) {
  const { x0, y0, cell, n } = lay;
  const size = cell * n;
  const radius = Math.min(20, Math.max(10, cell * 0.24));
  const col = boardColors(theme);

  ctx.fillStyle = col.paper;
  roundRect(ctx, x0 - BOARD_PAD + 0.5, y0 - BOARD_PAD + 0.5, size + 2 * BOARD_PAD - 1, size + 2 * BOARD_PAD - 1, radius);
  ctx.fill();
  ctx.strokeStyle = col.hairline;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < n; i++) {
    const x = x0 + i * cell;
    const y = y0 + i * cell;
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y0 + size);
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + size, y);
  }
  ctx.stroke();

  // Плитки под числами; пройденные дорожкой перекрываются «станциями» в render.
  for (let i = 0; i < state.marks.length; i++) {
    const c = state.marks[i][0];
    const cx = x0 + ((c % n) + 0.5) * cell;
    const cy = y0 + (((c / n) | 0) + 0.5) * cell;
    markTile(ctx, cx, cy, cell * MARK_R, col.tile, col.hairline, 1);
  }

  // Рамка — внешняя линия сетки (край поля задаёт сама карточка), стены — чернила с круглыми
  // концами: на поле читаются только они («иерархия контрастом, а не рамками»).
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0, y0, size, size);
  ctx.strokeStyle = theme.wall;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, cell * 0.12);
  ctx.beginPath();
  for (let i = 0; i < state.walls.length; i++) {
    wallPath(ctx, state.walls[i][0], state.walls[i][1], lay);
  }
  ctx.stroke();
}

/** Добавить в текущий path отрезок стены между соседними клетками a<b. */
function wallPath(ctx, a, b, lay) {
  const { x0, y0, cell, n } = lay;
  const ra = (a / n) | 0;
  const ca = a - ra * n;
  if (b === a + 1) {
    const x = x0 + (ca + 1) * cell;
    ctx.moveTo(x, y0 + ra * cell);
    ctx.lineTo(x, y0 + (ra + 1) * cell);
  } else {
    const y = y0 + (ra + 1) * cell;
    ctx.moveTo(x0 + ca * cell, y);
    ctx.lineTo(x0 + (ca + 1) * cell, y);
  }
}

/**
 * Кэш статического слоя: перерисовка при смене размера клетки, темы или масштаба. Масштаб
 * (getTransform — аллокация матрицы) читается только при промахе по дешёвым признакам: размер
 * клетки, тема и размер холста в пикселях (меняется вместе с DPR и размером).
 */
function ensureStatic(ctx, state, layout, theme) {
  const cache = state._cache;
  const canvasW = ctx.canvas ? ctx.canvas.width : 0;
  const canvasH = ctx.canvas ? ctx.canvas.height : 0;
  if (cache && cache.cell === layout.cell && cache.themeId === theme.id && cache.canvasW === canvasW && cache.canvasH === canvasH) {
    return cache;
  }
  const dpr = pixelRatio(ctx);
  if (cache && cache.cell === layout.cell && cache.themeId === theme.id && cache.dpr === dpr) {
    cache.canvasW = canvasW;
    cache.canvasH = canvasH;
    return cache;
  }
  const cssSize = layout.cell * layout.n + 2 * BOARD_PAD;
  const px = Math.max(1, Math.round(cssSize * dpr));
  const canvas = createOffscreen(px, px);
  if (!canvas || typeof canvas.getContext !== 'function') {
    state._cache = null;
    return null;
  }
  const c2 = canvas.getContext('2d');
  if (!c2) {
    state._cache = null;
    return null;
  }
  c2.setTransform(dpr, 0, 0, dpr, 0, 0);
  c2.clearRect(0, 0, cssSize, cssSize);
  drawStatic(c2, state, { x0: BOARD_PAD, y0: BOARD_PAD, cell: layout.cell, n: layout.n }, theme);
  state._cache = { canvas, cell: layout.cell, themeId: theme.id, dpr, cssSize, canvasW, canvasH };
  return state._cache;
}

/** Заливка клетки с альфой alpha поверх базовой альфы кадра base (анимация появления). */
function highlightCell(ctx, c, lay, color, alpha, inset, base = 1) {
  const { x0, y0, cell, n } = lay;
  const x = x0 + (c % n) * cell + inset;
  const y = y0 + ((c / n) | 0) * cell + inset;
  ctx.globalAlpha = alpha * base;
  ctx.fillStyle = color;
  roundRect(ctx, x, y, cell - 2 * inset, cell - 2 * inset, Math.max(3, cell * 0.16));
  ctx.fill();
  ctx.globalAlpha = base;
}

const mode = {
  id: 'zip',
  icon: 'route',
  name: { ru: 'Маршрут', en: 'Route' },
  tagline: { ru: 'Одна дорожка через все клетки', en: 'One route through every cell' },
  helpText: {
    ru: 'Проведи одну дорожку от 1 до последнего числа через все клетки, посещая числа по порядку. Сквозь толстые линии нельзя.',
    en: 'Draw one route from 1 to the last number through every cell, visiting numbers in order. Thick lines are walls.',
  },
  // WORDS: семейство шалфея (docs/DESIGN.md §5.3). Светлая — ≥ 4:1 к бумаге и белый текст ≥ 4.5:1,
  // тёмная — пастель ≥ 7:1 к тёмной бумаге. Цвет дорожки, кольца станций и следующего числа.
  color: '#9DBB98',
  colorLight: '#5E7D63',

  /**
   * create(levelData, saved) → state. Снимок (serialize) восстанавливает дорожку, возвраты и hintUsed.
   * Всплытие поля (§4.3) — только при появлении уровня: при восстановлении из снимка (undo,
   * продолжение партии) анимации нет, иначе каждый undo «мерцал» бы полем.
   */
  create(levelData, saved) {
    const restoring = !!saved && typeof saved === 'object';
    const st = buildStatic(levelData);
    const state = {
      level: levelData,
      n: st.n,
      N: st.N,
      K: st.K,
      markOf: st.markOf,
      startCell: st.startCell,
      goalCell: st.goalCell,
      wallBits: st.wallBits,
      walls: st.walls,
      marks: st.marks,
      path: [],
      posOf: new Int16Array(st.N).fill(-1),
      marksUpTo: new Uint8Array(st.N), // следующее ожидаемое число после i-й клетки пути
      nextMark: 1,
      backtracks: 0,
      hintUsed: false,
      hint: null,
      solved: false,
      solvedAt: -Infinity,
      changedAt: NaN, // NaN — пульс «следующего числа» стартует с первого кадра
      appearAt: restoring ? -Infinity : NaN, // NaN — всплытие стартует с первого кадра
      dirty: false,
      drag: { active: false, cursor: -1, ax: 0, ay: 0, blocked: false, blockedAt: -1 },
      fx: { stepAt: -Infinity, stepCell: -1, rejectAt: -Infinity, rejectCell: -1, rejectWallA: -1, rejectWallB: -1 },
      trace: { cur: -1, len: 0, expected: 1 },
      rej: { a: -1, b: -1, reason: '', expected: 0, remaining: 0 },
      canStep: null,
      prefer: null,
      _cache: null,
    };
    state.canStep = makeCanStep(state);
    // При ничьей на углу (точная диагональ) трассировка предпочитает непосещённую клетку:
    // иначе ведущая ось могла выбрать клетку дорожки, и шаг оборачивался укорочением.
    state.prefer = (a, b) => state.posOf[b] < 0;
    if (restoring) {
      if (validPrefix(state, saved.path)) for (const c of saved.path) pushCell(state, c);
      if (Number.isFinite(saved.backtracks) && saved.backtracks >= 0) state.backtracks = saved.backtracks | 0;
      state.hintUsed = saved.hintUsed === true;
    }
    state.solved = mode.isSolved(state);
    return state;
  },

  serialize(state) {
    return { path: state.path.slice(), backtracks: state.backtracks, hintUsed: state.hintUsed };
  },

  /** layout(state, rect, theme) → { x0, y0, cell, n, size }: квадрат по меньшей стороне с полями. */
  layout(state, rect) {
    const lay = makeLayout(rect, state.n, BOARD_PAD);
    lay.size = lay.cell * lay.n;
    return lay;
  },

  /** render(ctx, state, layout, theme, t, opts) → true, если нужен ещё кадр. shadowBlur не используется. */
  render(ctx, state, layout, theme, t, opts) {
    const reduced = !!(opts && opts.reducedMotion);
    const { x0, y0, cell, n } = layout;
    const size = cell * n;
    let animating = false;

    // Служебные метки времени первого кадра: старт всплытия и пульса ожидаемого числа.
    // Оболочка помечает состояние после undo/restore opts.appeared — всплытие не повторяется (§4.3).
    if (Number.isNaN(state.appearAt)) state.appearAt = opts && opts.appeared ? -Infinity : t;
    if (Number.isNaN(state.changedAt)) state.changedAt = t;
    // Базовая альфа кадра — альфа всплытия; все слои умножаются на неё, иначе дорожка и числа
    // проявлялись бы раньше сетки.
    const appear = reduced ? 1 : Math.min(1, (t - state.appearAt) / APPEAR_MS);
    if (appear < 1) {
      animating = true;
      const s = 0.96 + 0.04 * appear;
      const cx = x0 + size / 2;
      const cy = y0 + size / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      ctx.translate(-cx, -cy);
      ctx.globalAlpha = appear;
    }

    // 1. Статический слой.
    const cache = ensureStatic(ctx, state, layout, theme);
    if (cache) {
      ctx.drawImage(cache.canvas, x0 - BOARD_PAD, y0 - BOARD_PAD, cache.cssSize, cache.cssSize);
    } else {
      drawStatic(ctx, state, layout, theme);
    }

    // 2. Вспышка стены при отказе.
    const rejectAge = t - state.fx.rejectAt;
    const rejecting = rejectAge >= 0 && rejectAge < REJECT_MS;
    if (rejecting) animating = true;
    if (rejecting && state.fx.rejectWallA >= 0) {
      ctx.globalAlpha = (1 - rejectAge / REJECT_MS) * appear;
      ctx.strokeStyle = theme.danger;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(4, cell * 0.18);
      ctx.beginPath();
      const a = Math.min(state.fx.rejectWallA, state.fx.rejectWallB);
      const b = Math.max(state.fx.rejectWallA, state.fx.rejectWallB);
      wallPath(ctx, a, b, layout);
      ctx.stroke();
      ctx.globalAlpha = appear;
    }

    // 3. Подсказка.
    const hint = state.hint;
    if (hint && t < hint.until) {
      animating = true;
      const fade = Math.min(1, (hint.until - t) / 400);
      if (hint.kind === 'cells') {
        for (let i = 0; i < hint.cells.length; i++) {
          highlightCell(ctx, hint.cells[i], layout, theme.hint, 0.28 * fade, cell * 0.08, appear);
          // Контур в полную силу: заливка в светлой теме слишком бледна (§4.1 контраст ≥ 3:1);
          // тонкий — подсказка WORDS спокойная, не перекрикивает дорожку.
          ctx.globalAlpha = fade * appear;
          ctx.strokeStyle = theme.hint;
          ctx.lineWidth = Math.max(1.5, cell * 0.035);
          ctx.stroke();
          ctx.globalAlpha = appear;
        }
      } else if (hint.kind === 'rollback') {
        highlightCell(ctx, hint.cell, layout, theme.danger, 0.4 * fade, cell * 0.08, appear);
      }
    }

    // 4. Дорожка: свечение (широкая обводка с низкой альфой) и основная линия.
    const len = state.path.length;
    if (len > 0) {
      const winAge = t - state.solvedAt;
      let pulse = 0;
      if (state.solved && !reduced && winAge >= 0 && winAge < WIN_PULSE_MS) {
        animating = true;
        pulse = Math.sin((winAge / WIN_PULSE_MS) * Math.PI * 3) * 0.5 + 0.5;
      }
      const width = cell * (0.46 + 0.1 * pulse);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (len === 1) {
        const c = state.path[0];
        const cx = x0 + ((c % n) + 0.5) * cell;
        const cy = y0 + (((c / n) | 0) + 0.5) * cell;
        ctx.globalAlpha = 0.35 * appear;
        ctx.fillStyle = theme.lineGlow || theme.line;
        ctx.beginPath();
        ctx.arc(cx, cy, width * 0.68, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = appear;
        ctx.fillStyle = theme.line;
        ctx.beginPath();
        ctx.arc(cx, cy, width / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        for (let i = 0; i < len; i++) {
          const c = state.path[i];
          const cx = x0 + ((c % n) + 0.5) * cell;
          const cy = y0 + (((c / n) | 0) + 0.5) * cell;
          if (i === 0) ctx.moveTo(cx, cy);
          else ctx.lineTo(cx, cy);
        }
        // В тёмной теме светлый ореол на графите читается как серая кайма — он тише.
        ctx.globalAlpha = ((theme.id === 'dark' ? 0.22 : 0.35) + 0.25 * pulse) * appear;
        ctx.strokeStyle = theme.lineGlow || theme.line;
        ctx.lineWidth = width * 1.36;
        ctx.stroke();
        ctx.globalAlpha = appear;
        ctx.strokeStyle = theme.line;
        ctx.lineWidth = width;
        ctx.stroke();
      }
    }

    // 4б. «Станции»: пройденные числа — плитка поверх дорожки с кольцом цвета линии. Число всегда
    // стоит на плитке (чернила на белом ≥ 4.5:1 в обеих темах), а кольцо показывает «пройдено».
    const col = boardColors(theme);
    if (len > 0) {
      const ringW = Math.max(2, cell * 0.07);
      for (let i = 0; i < state.marks.length; i++) {
        const c = state.marks[i][0];
        if (state.posOf[c] < 0) continue;
        markTile(ctx, x0 + ((c % n) + 0.5) * cell, y0 + (((c / n) | 0) + 0.5) * cell, cell * MARK_R, col.tile, theme.line, ringW);
      }
    }

    // 5. Вспышка клетки при шаге.
    const stepAge = t - state.fx.stepAt;
    if (stepAge >= 0 && stepAge < STEP_FLASH_MS && state.fx.stepCell >= 0 && !reduced) {
      animating = true;
      const k = 1 - stepAge / STEP_FLASH_MS;
      const c = state.fx.stepCell;
      const cx = x0 + ((c % n) + 0.5) * cell;
      const cy = y0 + (((c / n) | 0) + 0.5) * cell;
      ctx.globalAlpha = 0.5 * k * appear;
      ctx.fillStyle = theme.lineGlow || theme.line;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * (0.3 + 0.25 * (1 - k)), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = appear;
    }

    // 6. Следующее ожидаемое число — мягкий пульс кольца (ограничен по времени, чтобы не крутить rAF вечно).
    const nextCell = state.solved ? -1 : nextMarkCell(state);
    if (nextCell >= 0) {
      const sinceChange = t - state.changedAt;
      const pulsing = !reduced && sinceChange < PULSE_ACTIVE_MS;
      if (pulsing) animating = true;
      const phase = pulsing ? 0.5 + 0.5 * Math.sin(t / 260) : 0.5;
      const cx = x0 + ((nextCell % n) + 0.5) * cell;
      const cy = y0 + (((nextCell / n) | 0) + 0.5) * cell;
      ctx.globalAlpha = (pulsing ? 0.35 + 0.35 * phase : 1) * appear; // без пульса (Reduce Motion) — в полную силу
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = Math.max(2, cell * 0.06);
      ctx.beginPath();
      ctx.arc(cx, cy, cell * (MARK_R + 0.05 + 0.05 * phase), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = appear;
    }

    // 7. Числа — чернилами на плитке (обводка цвета плитки отделяет цифру от кольца); тряска при
    // отказе. «Крупный текст» — +12 %, «Контрастные номера» — жирнее (docs/DESIGN.md §5.11).
    const fontSize = Math.max(16, Math.round(cell * (theme.large ? 0.47 : 0.42)));
    ctx.font = `${theme.contrast ? 800 : 600} ${fontSize}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2;
    ctx.strokeStyle = col.tile;
    ctx.fillStyle = col.ink;
    for (let i = 0; i < state.marks.length; i++) {
      const c = state.marks[i][0];
      let cx = x0 + ((c % n) + 0.5) * cell;
      const cy = y0 + (((c / n) | 0) + 0.5) * cell;
      if (rejecting && c === state.fx.rejectCell && !reduced) {
        cx += Math.sin(rejectAge / 22) * cell * 0.08 * (1 - rejectAge / REJECT_MS);
      }
      const label = String(state.marks[i][1]);
      ctx.strokeText(label, cx, cy + 1);
      ctx.fillText(label, cx, cy + 1);
    }
    if (rejecting && state.fx.rejectCell >= 0) {
      highlightCell(ctx, state.fx.rejectCell, layout, theme.danger, 0.3 * (1 - rejectAge / REJECT_MS), cell * 0.1, appear);
    }

    if (appear < 1) ctx.restore();
    else ctx.globalAlpha = 1;
    return animating;
  },

  /**
   * pointer(state, layout, ev) → events[]. ev = { type:'down'|'move'|'up'|'cancel', x, y, t }.
   * down на клетку 1 (пустая дорожка) или на клетку дорожки — начало росчерка; move — трассировка
   * от якоря до пальца (§4.2), возврат по дорожке укорачивает, шаг вперёд наращивает от курсора;
   * отказы (стена, порядок, ранний финиш) блокируют рост до возвращения пальца к голове.
   */
  pointer(state, layout, ev) {
    const events = [];
    const drag = state.drag;
    const t = ev.t || 0;
    if (ev.type === 'up' || ev.type === 'cancel') {
      drag.active = false;
      drag.blocked = false;
      return events;
    }
    if (state.solved) return events;

    if (ev.type === 'down') {
      const c = cellAt(ev.x, ev.y, layout);
      if (c < 0) return events;
      if (state.path.length === 0) {
        if (c !== state.startCell) return events;
        pushCell(state, c);
        state.fx.stepAt = t;
        state.fx.stepCell = c;
        markChanged(state, t);
        events.push({ kind: 'step', cell: c, length: 1 });
        events.push({ kind: 'changed' });
      } else if (state.posOf[c] < 0) {
        return events;
      }
      drag.active = true;
      drag.cursor = state.posOf[c];
      drag.ax = ev.x;
      drag.ay = ev.y;
      drag.blocked = false;
      return events;
    }

    if (ev.type !== 'move' || !drag.active) return events;
    const f = cellAt(ev.x, ev.y, layout, HYSTERESIS);
    if (f < 0) return events;
    const cursorCell = state.path[drag.cursor];
    if (drag.blocked) {
      // После отказа дорожка не растёт, пока палец не вернётся на дорожку или в клетку, соседнюю
      // с головой (§2.2, §4.2). Пока палец стоит в клетке отказа — ничего.
      if (f === drag.blockedAt) return events;
      const pf = state.posOf[f];
      if (pf >= 0) {
        // Палец на клетке дорожки: укорачиваем до неё напрямую. Трассировать прямую голова→палец
        // нельзя — она прошла бы по клеткам, которых палец не касался (телепортация).
        if (pf < drag.cursor) {
          truncateTo(state, pf + 1);
          state.solved = false;
          markChanged(state, t);
          events.push({ kind: 'changed' });
        }
        drag.cursor = pf;
        drag.ax = ev.x;
        drag.ay = ev.y;
        drag.blocked = false;
        return events;
      }
      if (!areAdjacent(f, cursorCell, state.n)) return events;
      const cc = cellCenter(cursorCell, layout);
      drag.ax = cc.x;
      drag.ay = cc.y;
      drag.blocked = false;
    }
    if (f === cursorCell) {
      drag.ax = ev.x;
      drag.ay = ev.y;
      return events;
    }

    state.dirty = false;
    beginTrace(state);
    let cells = traceCells({ x: drag.ax, y: drag.ay }, { x: ev.x, y: ev.y }, layout, state.n, state.canStep, state.prefer);
    if (cells.length === 0 || cells[0] !== cursorCell) {
      // Якорь разошёлся с курсором (например, после смены layout) — трассируем от центра головы.
      const cc = cellCenter(cursorCell, layout);
      drag.ax = cc.x;
      drag.ay = cc.y;
      beginTrace(state);
      cells = traceCells({ x: cc.x, y: cc.y }, { x: ev.x, y: ev.y }, layout, state.n, state.canStep, state.prefer);
    }
    let blocked = false;
    for (let i = 1; i < cells.length && !state.solved; i++) {
      if (!applyStep(state, cells[i], events, t)) {
        blocked = true;
        break;
      }
    }
    if (!blocked && !state.solved && cells[cells.length - 1] !== f) {
      // Трассировка остановилась на нелегальном шаге — событие отказа из canStep.
      blocked = true;
      rejectFromTrace(state, events, t);
    }
    if (blocked) {
      drag.blocked = true;
      drag.blockedAt = f;
    } else {
      drag.ax = ev.x;
      drag.ay = ev.y;
    }
    if (state.dirty) {
      state.dirty = false;
      events.push({ kind: 'changed' });
    }
    return events;
  },

  isSolved(state) {
    return state.path.length === state.N && state.path[state.N - 1] === state.goalCell;
  },

  /** Очищает поле; hintUsed и возвраты (статистика попытки) не трогаются. */
  reset(state) {
    const removed = state.path.length;
    truncateTo(state, 0);
    state.backtracks -= removed; // сброс — не возврат
    state.solved = false;
    state.solvedAt = -Infinity;
    state.hint = null;
    state.drag.active = false;
    state.drag.blocked = false;
    state.changedAt = NaN; // пульс «следующего числа» — заново с ближайшего кадра
  },

  /**
   * hint(state, t): дорожка — префикс решения → следующие 3 клетки ({kind:'cells'}); иначе первая
   * расходящаяся клетка ({kind:'rollback', cell, keep}) и кнопка «Укоротить до неё» — оболочка
   * вызывает truncate(state, hint, t). Ставит state.hint = {…, until: t+2500}, state.hintUsed = true;
   * на решённом уровне — {kind:'none'} без hintUsed.
   */
  hint(state, t) {
    if (state.solved) {
      state.hint = null;
      return { kind: 'none' };
    }
    state.hintUsed = true;
    const sol = state.level.path;
    const len = state.path.length;
    let i = 0;
    while (i < len && state.path[i] === sol[i]) i++;
    let h;
    if (i === len) {
      h = { kind: 'cells', cells: sol.slice(len, Math.min(sol.length, len + 3)), until: t + HINT_MS };
    } else {
      h = {
        kind: 'rollback',
        cell: state.path[i],
        keep: i,
        label: { ru: 'Укоротить до неё', en: 'Cut back to it' },
        until: t + HINT_MS,
      };
    }
    state.hint = h;
    return h;
  },

  /**
   * truncate(state, hint, t) → boolean: кнопка «Укоротить до неё» оболочки после подсказки
   * kind:'rollback' — укорачивает дорожку до совпадающего с решением префикса (hint.keep клеток).
   * Подсказка действует, только если расходящаяся клетка всё ещё стоит на том же месте дорожки:
   * если игрок за время тоста сам перерисовал дорожку, кнопка ничего не режет.
   */
  truncate(state, hint, t = 0) {
    if (!hint || hint.kind !== 'rollback' || !Number.isInteger(hint.keep) || hint.keep < 0) return false;
    if (state.path.length <= hint.keep || state.path[hint.keep] !== hint.cell) return false;
    truncateTo(state, hint.keep);
    state.solved = false;
    state.hint = null;
    state.drag.active = false;
    state.drag.blocked = false;
    markChanged(state, t);
    return true;
  },

  /** rollbackTo(state, cell) → events[]: убирает клетку cell и всё после неё из дорожки. */
  rollbackTo(state, cell, t = 0) {
    const events = [];
    const p = state.posOf[cell];
    if (p < 0) return events;
    truncateTo(state, p);
    state.solved = false;
    state.hint = null;
    state.drag.active = false;
    markChanged(state, t);
    events.push({ kind: 'changed' });
    return events;
  },

  stats(state) {
    return { lines: [{ ru: `Возвратов: ${state.backtracks}`, en: `Backtracks: ${state.backtracks}` }] };
  },

  perfect() {
    return true;
  },

  /**
   * ghost(levelData, layout?) → первые 4 клетки решения. С layout — центры клеток в координатах
   * холста; без него — {x: столбец+0.5, y: строка+0.5, cell} в единицах сетки.
   */
  ghost(levelData, layout) {
    const n = levelData.n;
    const cells = levelData.path.slice(0, 4);
    return cells.map((c) => {
      if (layout) {
        const p = cellCenter(c, layout);
        return { x: p.x, y: p.y, cell: c };
      }
      return { x: (c % n) + 0.5, y: ((c / n) | 0) + 0.5, cell: c };
    });
  },

  nextLabel(state) {
    if (state.solved || state.nextMark > state.K) return null;
    return `следующая: ${state.nextMark}`;
  },

  footer() {
    return null;
  },
};

export default mode;
