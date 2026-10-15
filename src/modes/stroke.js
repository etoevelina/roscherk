// Режим «Один штрих» (§2.4, контракт §5.1 спеки): обвести фигуру одним непрерывным росчерком,
// пройдя каждый отрезок ровно один раз. Модуль не трогает DOM, звук и хранилище.
//
// state (сериализуемая часть — только path, hintUsed, deadEnds):
//   level     — levelData (§5.4), path — индексы узлов, edgeIds — индексы отрезков по шагам,
//   used      — Uint8Array по отрезкам, hint — текущая подсказка {kind, …, until} или null,
//   _graph    — CSR-граф солвера, _drag — состояние указателя, _fx — таймстемпы анимаций,
//   _pass/_passT/_passD — буферы узлов, пройденных отрезком указателя, _startMatters — важен ли
//   выбор старта (для тоста тупика), _cache — статический слой (offscreen-canvas), не сериализуется.

import { buildGraph, canComplete, edgeBetween, findCompletion, canTraverse } from './stroke.solve.js';
import { createOffscreen, pixelRatio } from '../core/canvas.js';

const HINT_BUDGET = 200_000; // лимит узлов солвера на одну подсказку
const HINT_MS = 2500;
const MARGIN = 0.6; // поле вокруг фигуры в единицах шага (джиттер + радиус узла + стрелки)
// Гистерезис захвата: у узла, расстояние до которого от головы пути меньше capture / CAPTURE_SHRINK,
// радиус захвата сжимается до CAPTURE_SHRINK·расстояния. Окружности головы и узла тогда не
// перекрываются, между зоной шага и зоной отмены остаётся зазор в 20 % ребра, и палец, стоящий
// между близкими узлами (рёбра 38px на 6×5 при 375pt), не переключает шаг/отмену туда-обратно.
const CAPTURE_SHRINK = 0.4;
const APPEAR_MS = 200;
const STEP_FLASH_MS = 250;
const REJECT_MS = 320;
const SOLVED_MS = 1200;
const DEADEND_PULSE_MS = 4000;

const EMPTY = Object.freeze([]);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Ближайший узел в радиусе захвата или -1. */
function nodeAt(layout, x, y) {
  const { px, py, capture } = layout;
  let best = -1;
  let bestD = capture * capture;
  for (let i = 0; i < px.length; i++) {
    const dx = px[i] - x;
    const dy = py[i] - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Есть ли из вершины v непройденный отрезок, по которому можно пойти. */
function hasExit(g, used, v) {
  for (let i = g.adjStart[v], end = g.adjStart[v + 1]; i < end; i++) {
    const e = g.adjEdge[i];
    if (!used[e] && canTraverse(g, e, v)) return true;
  }
  return false;
}

/** Любой отрезок между a и b (включая пройденные и против стрелки) — для причины отказа. */
function anyEdgeBetween(g, a, b) {
  for (let i = g.adjStart[a], end = g.adjStart[a + 1]; i < end; i++) {
    if (g.adjTo[i] === b) return g.adjEdge[i];
  }
  return -1;
}

function isSolvedState(state) {
  const E = state.level.edges.length;
  const p = state.path;
  return E > 0 && p.length === E + 1 && (!state.level.closed || p[0] === p[E]);
}

/** Применить сохранённый путь, если он легален для этого уровня; иначе остаться с пустым. */
function restorePath(state, savedPath) {
  if (!Array.isArray(savedPath) || savedPath.length === 0) return;
  const { level, _graph: g, used, path, edgeIds } = state;
  const first = savedPath[0];
  if (!Number.isInteger(first) || first < 0 || first >= g.n) return;
  if (level.start != null && first !== level.start) return;
  path.push(first);
  for (let i = 1; i < savedPath.length; i++) {
    const e = edgeBetween(g, used, path[path.length - 1], savedPath[i]);
    if (e < 0) break;
    used[e] = 1;
    path.push(savedPath[i]);
    edgeIds.push(e);
  }
}

/**
 * Собрать узлы, которые отрезок указателя (x0,y0)→(x1,y1) «прошёл» (расстояние до отрезка меньше
 * capture), в порядке прохождения: state._pass — узлы, state._passD — квадрат расстояния до отрезка
 * (processPassed сверяет его со сжатым радиусом у головы).
 */
function collectPassed(state, layout, x0, y0, x1, y1) {
  const { px, py, capture } = layout;
  const pass = state._pass;
  const passT = state._passT;
  const passD = state._passD;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const r2 = capture * capture;
  let count = 0;
  for (let i = 0; i < px.length; i++) {
    let t = len2 === 0 ? 0 : ((px[i] - x0) * dx + (py[i] - y0) * dy) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const qx = x0 + t * dx - px[i];
    const qy = y0 + t * dy - py[i];
    const d2 = qx * qx + qy * qy;
    if (d2 >= r2) continue;
    // Сортировка вставками по t — узлов на отрезке единицы.
    let k = count++;
    while (k > 0 && passT[k - 1] > t) {
      pass[k] = pass[k - 1];
      passT[k] = passT[k - 1];
      passD[k] = passD[k - 1];
      k--;
    }
    pass[k] = i;
    passT[k] = t;
    passD[k] = d2;
  }
  return count;
}

/**
 * Срезанный угол: указатель между двумя сэмплами проскочил промежуточный узел. Если ровно один
 * узел m смежен и с головой, и с node по непройденным легальным отрезкам — вернуть его (шаг идёт
 * через m), иначе -1 (неоднозначно или такого нет). Зеркало правила угла §4.2 для сеток.
 */
function cornerVia(g, used, head, node) {
  let via = -1;
  for (let i = g.adjStart[head], end = g.adjStart[head + 1]; i < end; i++) {
    const m = g.adjTo[i];
    const e = g.adjEdge[i];
    if (m === node || used[e] || !canTraverse(g, e, head)) continue;
    if (edgeBetween(g, used, m, node) < 0) continue;
    if (via >= 0) return -1;
    via = m;
  }
  return via;
}

/** Любые стрелки в фигуре (тогда часть вершин не годится в старт даже при чётных степенях). */
function hasArrows(g) {
  for (let e = 0; e < g.E; e++) if (g.ed[e]) return true;
  return false;
}

export default {
  id: 'stroke',
  icon: 'stroke',
  name: { ru: 'Один штрих', en: 'One Stroke' },
  tagline: { ru: 'Обведи фигуру, не отрывая пальца', en: 'Trace the figure in one stroke' },
  helpText: {
    ru: 'Проведи по каждому отрезку ровно один раз, не отрывая пальца. Через точки можно проходить несколько раз.',
    en: 'Trace every segment exactly once without lifting your finger. Dots may be visited many times.',
  },
  color: '#D3A57E', // Lumin (§4.4): приглушённый оттенок режима для тёмной темы
  colorLight: '#9A6B45',

  create(levelData, saved) {
    const g = buildGraph(levelData);
    const odd = [];
    for (let v = 0; v < g.n; v++) if ((g.adjStart[v + 1] - g.adjStart[v]) & 1) odd.push(v);
    const state = {
      level: levelData,
      path: [],
      edgeIds: [],
      used: new Uint8Array(g.E),
      hintUsed: !!(saved && saved.hintUsed),
      deadEnds: saved && Number.isInteger(saved.deadEnds) ? saved.deadEnds : 0,
      hint: null,
      _graph: g,
      _odd: odd,
      // Для тоста тупика: важен ли выбор старта (две нечётные точки или стрелки без отмеченного
      // старта) или дело в порядке обхода (цикл — старт где угодно; фиксированный старт менять нельзя).
      _startMatters: levelData.start == null && (odd.length > 0 || hasArrows(g)),
      _solvedEmitted: false,
      _drag: { active: false, x: 0, y: 0, rejectNode: -1 },
      _pass: new Int32Array(g.n),
      _passT: new Float64Array(g.n),
      _passD: new Float64Array(g.n),
      _fx: {
        // -1 — появление уровня ещё не началось (первый кадр запустит всплытие 200 мс);
        // -Infinity — состояние восстановлено (undo, партия после перезагрузки): без всплытия.
        bornAt: saved ? -Infinity : -1,
        stepNode: -1,
        stepAt: -Infinity,
        rejectEdge: -1,
        rejectNode: -1,
        rejectAt: -Infinity,
        solvedAt: -Infinity,
        deadEndAt: -Infinity,
      },
      _cache: null,
    };
    if (saved) restorePath(state, saved.path);
    state._solvedEmitted = isSolvedState(state);
    return state;
  },

  serialize(state) {
    return { path: state.path.slice(), hintUsed: state.hintUsed, deadEnds: state.deadEnds };
  },

  /**
   * Вписать и центрировать в rect ограничивающий прямоугольник реальных узлов (с джиттером), а не
   * всю решётку w×h: фигура, занимающая часть решётки, иначе уезжает от центра на величину до шага
   * и рисуется мельче возможного. x0/y0 — пиксели точки (0,0) решётки, могут лежать вне rect.
   */
  layout(state, rect) {
    const { w, h, nodes } = state.level;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of nodes) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (nodes.length === 0) minX = maxX = minY = maxY = 0;
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const step = Math.max(1, Math.min(rect.w / (spanX + 2 * MARGIN), rect.h / (spanY + 2 * MARGIN)));
    const gw = spanX * step;
    const gh = spanY * step;
    const x0 = rect.x + (rect.w - gw) / 2 - minX * step;
    const y0 = rect.y + (rect.h - gh) / 2 - minY * step;
    const px = new Float64Array(nodes.length);
    const py = new Float64Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      px[i] = x0 + nodes[i][0] * step;
      py[i] = y0 + nodes[i][1] * step;
    }
    return {
      x0,
      y0,
      step,
      w,
      h,
      px,
      py,
      capture: Math.max(22, 0.35 * step),
      nodeR: clamp(0.11 * step, 4, 10),
      lineW: clamp(0.1 * step, 3, 9),
      // Рамка статического слоя — bbox фигуры с полями.
      bx: x0 + minX * step - MARGIN * step,
      by: y0 + minY * step - MARGIN * step,
      bw: gw + 2 * MARGIN * step,
      bh: gh + 2 * MARGIN * step,
    };
  },

  pointer(state, layout, ev) {
    const d = state._drag;
    const { level, path, used, _graph: g, _fx: fx } = state;

    if (ev.type === 'up' || ev.type === 'cancel') {
      d.active = false;
      d.rejectNode = -1;
      return EMPTY;
    }

    if (ev.type === 'down') {
      d.active = false;
      d.rejectNode = -1;
      const node = nodeAt(layout, ev.x, ev.y);
      if (node < 0) return EMPTY;
      const head = path.length > 0 ? path[path.length - 1] : -1;
      if (path.length <= 1 && node !== head) {
        // Ни одного отрезка ещё нет: выбор (или смена) стартовой точки. После тупика на старте
        // («попробуй другую точку старта») касание другой точки должно именно это и делать.
        if (level.start != null && node !== level.start) {
          fx.rejectNode = node;
          fx.rejectEdge = -1;
          fx.rejectAt = ev.t;
          return [{ kind: 'reject', reason: 'start', node }];
        }
        path.length = 0;
        path.push(node);
        d.active = true;
        d.x = ev.x;
        d.y = ev.y;
        fx.stepNode = node;
        fx.stepAt = ev.t;
        const events = [{ kind: 'changed' }];
        if (!hasExit(g, used, node) && g.E > 0) {
          state.deadEnds++;
          fx.deadEndAt = ev.t;
          events.push({ kind: 'deadend', startMatters: state._startMatters });
        }
        return events;
      }
      if (node !== head) {
        // Продолжать можно только с конца пути — подсвечиваем голову.
        fx.rejectNode = head;
        fx.rejectEdge = -1;
        fx.rejectAt = ev.t;
        return [{ kind: 'reject', reason: 'not-head', node }];
      }
      d.active = true;
      d.x = ev.x;
      d.y = ev.y;
      return EMPTY;
    }

    if (ev.type !== 'move' || !d.active) return EMPTY;

    const count = collectPassed(state, layout, d.x, d.y, ev.x, ev.y);
    d.x = ev.x;
    d.y = ev.y;
    const events = count > 0 ? processPassed(state, layout, count, ev.t) : null;
    // Отказ по узлу повторяется только после того, как палец ушёл из радиуса захвата.
    if (d.rejectNode >= 0) {
      const dx = layout.px[d.rejectNode] - ev.x;
      const dy = layout.py[d.rejectNode] - ev.y;
      if (dx * dx + dy * dy > layout.capture * layout.capture) d.rejectNode = -1;
    }
    return events || EMPTY;
  },

  isSolved(state) {
    return isSolvedState(state);
  },

  reset(state) {
    state.path.length = 0;
    state.edgeIds.length = 0;
    state.used.fill(0);
    state.hint = null;
    state._solvedEmitted = false;
    const d = state._drag;
    d.active = false;
    d.rejectNode = -1;
    const fx = state._fx;
    fx.stepAt = fx.rejectAt = fx.solvedAt = -Infinity;
    fx.stepNode = fx.rejectNode = fx.rejectEdge = -1;
  },

  hint(state, t) {
    const none = { kind: 'none' };
    if (isSolvedState(state)) return none;
    const { level, path, edgeIds, _graph: g } = state;
    const E = g.E;
    if (E === 0) return none;
    const budget = { nodes: 0, maxNodes: HINT_BUDGET };
    const used = new Uint8Array(E);
    let result = null;

    if (path.length > 0) {
      for (const e of edgeIds) used[e] = 1;
      const end = level.closed ? path[0] : -1;
      // Самый длинный префикс пути (k узлов), из которого есть завершение.
      for (let k = path.length; k >= 1 && !result; k--) {
        const v = path[k - 1];
        const remaining = E - (k - 1);
        const res = canComplete(g, used, v, end, remaining, budget);
        if (res === undefined) return none; // лимит узлов — подсказки нет, звезда не снимается
        if (res === true) {
          if (k === path.length) {
            const completion = findCompletion(g, used, v, end, remaining, budget);
            if (!completion) return none;
            const e = completion[0];
            const to = g.ea[e] === v ? g.eb[e] : g.ea[e];
            result = { kind: 'edge', edge: e, from: v, to };
          } else {
            result = { kind: 'rollback', node: v, index: k - 1 };
          }
        } else if (k >= 2) {
          used[edgeIds[k - 2]] = 0;
        }
      }
    }

    if (!result) {
      // Префикс пуст: любая допустимая стартовая вершина (нечётные — первыми).
      used.fill(0);
      const order = state._odd.length > 0 ? state._odd.concat(Array.from({ length: g.n }, (_, i) => i)) : Array.from({ length: g.n }, (_, i) => i);
      const candidates = level.start != null ? [level.start] : order;
      for (const s of candidates) {
        const res = canComplete(g, used, s, level.closed ? s : -1, E, budget);
        if (res === undefined) return none;
        if (res === true) {
          result = { kind: 'start', node: s };
          break;
        }
      }
    }
    if (!result) return none;
    result.until = t + HINT_MS;
    state.hint = result;
    state.hintUsed = true;
    return result;
  },

  stats() {
    return { lines: [] };
  },

  perfect() {
    return true;
  },

  /**
   * ghost(levelData, layout?) → точки первых 4 узлов решения. С layout — в CSS-px холста,
   * без него — в единицах решётки (координаты узлов из данных).
   */
  ghost(levelData, layout) {
    const sol = levelData.solution;
    if (!Array.isArray(sol) || sol.length < 2) return null;
    const pts = [];
    for (let i = 0; i < Math.min(4, sol.length); i++) {
      const v = sol[i];
      pts.push(layout ? { x: layout.px[v], y: layout.py[v] } : { x: levelData.nodes[v][0], y: levelData.nodes[v][1] });
    }
    return pts;
  },

  nextLabel() {
    return null;
  },

  footer() {
    return null;
  },

  render(ctx, state, layout, theme, t, opts) {
    const reduced = !!(opts && opts.reducedMotion);
    const fx = state._fx;
    // Всплытие только при появлении уровня (§4.3): состояние после undo/restore оболочка помечает
    // opts.appeared, а create с сохранённым снимком — bornAt = -Infinity.
    if (fx.bornAt === -1) fx.bornAt = opts && opts.appeared ? -Infinity : t;
    let animating = false;

    let alpha = 1;
    if (!reduced && t - fx.bornAt < APPEAR_MS) {
      alpha = clamp((t - fx.bornAt) / APPEAR_MS, 0, 1);
      animating = true;
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Статический слой: отрезки, стрелки, узлы, отметка старта.
    const cache = ensureStatic(ctx, state, layout, theme);
    if (cache.canvas) ctx.drawImage(cache.canvas, cache.bx, cache.by, cache.bw, cache.bh);
    else drawStatic(ctx, state, layout, theme);

    const { px, py, lineW, nodeR } = layout;
    const { path, level, hint } = state;

    // Пульс нечётных точек после второго тупика.
    if (state.deadEnds >= 2 && state._odd.length > 0 && !isSolvedState(state)) {
      const age = t - fx.deadEndAt;
      let pulse = 1;
      if (!reduced && age < DEADEND_PULSE_MS) {
        pulse = 1 + 0.35 * Math.sin((age / 320) * Math.PI);
        animating = true;
      }
      ctx.strokeStyle = theme.hint;
      ctx.lineWidth = 2;
      for (let i = 0; i < state._odd.length; i++) {
        const v = state._odd[i];
        ctx.beginPath();
        ctx.arc(px[v], py[v], nodeR * 1.9 * pulse, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Линия пути: свечение (широкая обводка с низкой альфой) + основная.
    if (path.length >= 2) {
      let widthScale = 1;
      const solvedAge = t - fx.solvedAt;
      if (!reduced && solvedAge >= 0 && solvedAge < SOLVED_MS) {
        widthScale = 1 + 0.3 * Math.sin((solvedAge / SOLVED_MS) * Math.PI * 3) * (1 - solvedAge / SOLVED_MS);
        animating = true;
      }
      ctx.beginPath();
      ctx.moveTo(px[path[0]], py[path[0]]);
      for (let i = 1; i < path.length; i++) ctx.lineTo(px[path[i]], py[path[i]]);
      ctx.globalAlpha = alpha * 0.45;
      ctx.strokeStyle = theme.lineGlow;
      ctx.lineWidth = lineW * 2.6 * widthScale;
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = isSolvedState(state) ? theme.ok : theme.line;
      ctx.lineWidth = lineW * widthScale;
      ctx.stroke();
    }

    // Голова пути.
    if (path.length > 0) {
      const head = path[path.length - 1];
      ctx.fillStyle = theme.line;
      ctx.beginPath();
      ctx.arc(px[head], py[head], nodeR * 1.35, 0, Math.PI * 2);
      ctx.fill();
    }

    // Вспышка узла при шаге.
    const stepAge = t - fx.stepAt;
    if (!reduced && fx.stepNode >= 0 && stepAge >= 0 && stepAge < STEP_FLASH_MS) {
      const p = stepAge / STEP_FLASH_MS;
      ctx.globalAlpha = alpha * (1 - p);
      ctx.strokeStyle = theme.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px[fx.stepNode], py[fx.stepNode], nodeR * (1 + 1.4 * p), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = alpha;
      animating = true;
    }

    // Отказ: вспышка отрезка (с тряской) либо узла.
    const rejectAge = t - fx.rejectAt;
    if (rejectAge >= 0 && rejectAge < REJECT_MS) {
      const p = rejectAge / REJECT_MS;
      const shake = reduced ? 0 : Math.sin(rejectAge * 0.09) * 3 * (1 - p);
      ctx.globalAlpha = alpha * (1 - p * p);
      ctx.strokeStyle = theme.danger;
      if (fx.rejectEdge >= 0) {
        const [a, b] = level.edges[fx.rejectEdge];
        ctx.lineWidth = lineW;
        ctx.beginPath();
        ctx.moveTo(px[a] + shake, py[a]);
        ctx.lineTo(px[b] + shake, py[b]);
        ctx.stroke();
      } else if (fx.rejectNode >= 0) {
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(px[fx.rejectNode] + shake, py[fx.rejectNode], nodeR * 1.8, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = alpha;
      animating = true;
    }

    // Подсказка.
    if (hint && hint.until > t) {
      const blink = reduced ? 1 : 0.65 + 0.35 * Math.sin(t / 160);
      ctx.globalAlpha = alpha * blink;
      ctx.strokeStyle = theme.hint;
      if (hint.kind === 'edge') {
        ctx.lineWidth = lineW;
        ctx.beginPath();
        ctx.moveTo(px[hint.from], py[hint.from]);
        ctx.lineTo(px[hint.to], py[hint.to]);
        ctx.stroke();
        drawArrowHead(ctx, px[hint.from], py[hint.from], px[hint.to], py[hint.to], nodeR * 1.6, nodeR * 1.5, theme.hint);
      } else if (hint.kind === 'rollback' || hint.kind === 'start') {
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(px[hint.node], py[hint.node], nodeR * 2.2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = alpha;
      animating = true;
    }

    ctx.restore();
    return animating;
  },
};

/** Статический слой: все отрезки (приглушённо), стрелки, узлы, отметка фиксированного старта. */
function drawStatic(ctx, state, layout, theme) {
  const { px, py, lineW, nodeR } = layout;
  const { edges, start } = state.level;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = theme.textMuted;
  ctx.lineWidth = Math.max(2, lineW * 0.45);
  ctx.beginPath();
  for (let e = 0; e < edges.length; e++) {
    const [a, b] = edges[e];
    ctx.moveTo(px[a], py[a]);
    ctx.lineTo(px[b], py[b]);
  }
  ctx.stroke();
  for (let e = 0; e < edges.length; e++) {
    const [a, b, dir] = edges[e];
    if (dir !== 1) continue;
    const mx = (px[a] + px[b]) / 2;
    const my = (py[a] + py[b]) / 2;
    drawArrowHead(ctx, px[a], py[a], mx, my, nodeR * 1.5, nodeR * 1.4, theme.textMuted, true);
  }
  ctx.fillStyle = theme.textMuted;
  for (let i = 0; i < px.length; i++) {
    ctx.beginPath();
    ctx.arc(px[i], py[i], nodeR, 0, Math.PI * 2);
    ctx.fill();
  }
  if (start != null) {
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(px[start], py[start], nodeR * 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(px[start], py[start], nodeR, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Треугольная стрелка с вершиной в (tx,ty), направленная от (fx,fy). centered — центр на (tx,ty). */
function drawArrowHead(ctx, fx, fy, tx, ty, len, width, color, centered = false) {
  const dx = tx - fx;
  const dy = ty - fy;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  const tipX = centered ? tx + (ux * len) / 2 : tx;
  const tipY = centered ? ty + (uy * len) / 2 : ty;
  const bx = tipX - ux * len;
  const by = tipY - uy * len;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(bx - (uy * width) / 2, by + (ux * width) / 2);
  ctx.lineTo(bx + (uy * width) / 2, by - (ux * width) / 2);
  ctx.closePath();
  ctx.fill();
}

/**
 * Статический слой кэшируется в state._cache и перерисовывается при смене размеров layout,
 * темы или DPR (масштаб — pixelRatio(ctx) из core/canvas.js, как у холста оболочки). Внеэкранный
 * холст — createOffscreen; если его нет (Node), слой рисуется прямо на ctx каждый кадр.
 */
function ensureStatic(ctx, state, layout, theme) {
  const dpr = pixelRatio(ctx);
  const c = state._cache;
  if (
    c &&
    c.x0 === layout.x0 &&
    c.y0 === layout.y0 &&
    c.step === layout.step &&
    c.themeId === theme.id &&
    c.dpr === dpr
  ) {
    return c;
  }
  const pw = Math.max(1, Math.ceil(layout.bw * dpr));
  const ph = Math.max(1, Math.ceil(layout.bh * dpr));
  let canvas = createOffscreen(pw, ph);
  if (canvas) {
    const sctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (sctx) {
      sctx.scale(dpr, dpr);
      sctx.translate(-layout.bx, -layout.by);
      drawStatic(sctx, state, layout, theme);
    } else {
      canvas = null;
    }
  }
  const next = {
    x0: layout.x0,
    y0: layout.y0,
    step: layout.step,
    themeId: theme.id,
    dpr,
    canvas,
    bx: layout.bx,
    by: layout.by,
    bw: layout.bw,
    bh: layout.bh,
  };
  state._cache = next;
  return next;
}

/**
 * Обработать узлы, пройденные отрезком указателя (state._pass[0..count)), в порядке прохождения:
 * шаг по непройденному отрезку (через единственный промежуточный узел, если угол срезан), отмена
 * при возврате на предыдущую точку, отказ — и остановка на первом нелегальном шаге. Узел ближе
 * capture / CAPTURE_SHRINK к голове учитывается только внутри сжатого радиуса (гистерезис).
 * Возвращает массив событий или null, если ничего не произошло.
 */
function processPassed(state, layout, count, t) {
  const { path, edgeIds, used, _graph: g, _fx: fx, _drag: d, _pass: pass, _passD: passD } = state;
  const { px, py, capture } = layout;
  let events = null;
  let changed = false;
  const push = (ev) => (events || (events = [])).push(ev);

  /** Шаг по отрезку e в node; true — фигура завершена (обработку остановить). */
  const step = (node, e) => {
    used[e] = 1;
    path.push(node);
    edgeIds.push(e);
    changed = true;
    fx.stepNode = node;
    fx.stepAt = t;
    push({ kind: 'step', edge: e, node });
    if (isSolvedState(state)) {
      if (!state._solvedEmitted) {
        state._solvedEmitted = true;
        fx.solvedAt = t;
        push({ kind: 'solved' });
      }
      return true;
    }
    if (!hasExit(g, used, node)) {
      state.deadEnds++;
      fx.deadEndAt = t;
      push({ kind: 'deadend', startMatters: state._startMatters });
    }
    return false;
  };

  for (let k = 0; k < count; k++) {
    const node = pass[k];
    const head = path[path.length - 1];
    if (node === head) continue;

    const r = Math.min(capture, CAPTURE_SHRINK * Math.hypot(px[node] - px[head], py[node] - py[head]));
    if (passD[k] >= r * r) continue; // в зазоре между близкими узлами — ни шага, ни отмены, ни отказа

    if (path.length >= 2 && node === path[path.length - 2]) {
      // Возврат на предыдущую точку — отмена последнего отрезка.
      used[edgeIds.pop()] = 0;
      path.pop();
      state._solvedEmitted = false;
      changed = true;
      continue;
    }

    let e = edgeBetween(g, used, head, node);
    if (e < 0 && anyEdgeBetween(g, head, node) < 0) {
      // Узел вообще не смежен с головой — палец срезал угол, а не пошёл по пройденному/против стрелки.
      const via = cornerVia(g, used, head, node);
      if (via >= 0) {
        step(via, edgeBetween(g, used, head, via));
        e = edgeBetween(g, used, via, node);
      }
    }
    if (e >= 0) {
      if (step(node, e)) break;
      continue;
    }

    if (node === d.rejectNode) continue; // тот же отказ уже показан
    const any = anyEdgeBetween(g, head, node);
    let reason = 'not-adjacent';
    if (any >= 0) reason = used[any] ? 'used' : 'arrow';
    d.rejectNode = node;
    fx.rejectNode = node;
    fx.rejectEdge = any;
    fx.rejectAt = t;
    const rej = { kind: 'reject', reason, node };
    if (any >= 0) rej.edge = any;
    push(rej);
    break; // на первом нелегальном шаге обработка останавливается
  }
  if (changed) push({ kind: 'changed' });
  return events;
}
