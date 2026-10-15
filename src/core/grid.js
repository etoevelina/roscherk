// Геометрия квадратной сетки n×n и трассировка свайпа (§4.2, §5.6 спеки).
// Все функции чистые, без DOM. Клетка задаётся индексом idx = r*n + c.
//
// layout = { x0, y0, cell, n }: x0,y0 — левый верхний угол сетки в CSS-px холста,
// cell — размер клетки, n — число клеток по стороне.

/**
 * makeLayout(rect, n, padding) → { x0, y0, cell, n }.
 * rect — { x, y, w, h }; сетка — квадрат по меньшей стороне минус 2·padding, по центру rect.
 */
export function makeLayout(rect, n, padding = 0) {
  const size = Math.max(0, Math.min(rect.w, rect.h) - 2 * padding);
  return {
    x0: rect.x + (rect.w - size) / 2,
    y0: rect.y + (rect.h - size) / 2,
    cell: size / n,
    n,
  };
}

/** cellCenter(idx, layout) → { x, y } — центр клетки в координатах холста. */
export function cellCenter(idx, layout) {
  const { x0, y0, cell, n } = layout;
  const r = Math.floor(idx / n);
  const c = idx - r * n;
  return { x: x0 + (c + 0.5) * cell, y: y0 + (r + 0.5) * cell };
}

/**
 * cellAt(x, y, layout, hysteresis) → индекс клетки или -1.
 * hysteresis — доля центральной зоны клетки по каждой оси (по спеке 0.7); по умолчанию 1
 * (вся клетка). Указатель вне сетки или вне центральной зоны → -1.
 */
export function cellAt(x, y, layout, hysteresis = 1) {
  const { x0, y0, cell, n } = layout;
  const gx = (x - x0) / cell;
  const gy = (y - y0) / cell;
  if (gx < 0 || gy < 0 || gx >= n || gy >= n) return -1;
  const c = Math.floor(gx);
  const r = Math.floor(gy);
  if (hysteresis < 1) {
    const half = hysteresis / 2;
    if (Math.abs(gx - c - 0.5) > half || Math.abs(gy - r - 0.5) > half) return -1;
  }
  return r * n + c;
}

/** neighbors(idx, n) → индексы ортогональных соседей (вверх, вправо, вниз, влево) в пределах сетки. */
export function neighbors(idx, n) {
  const r = Math.floor(idx / n);
  const c = idx - r * n;
  const out = [];
  if (r > 0) out.push(idx - n);
  if (c < n - 1) out.push(idx + 1);
  if (r < n - 1) out.push(idx + n);
  if (c > 0) out.push(idx - 1);
  return out;
}

/** areAdjacent(a, b, n) → true, если клетки существуют и соседствуют по стороне. */
export function areAdjacent(a, b, n) {
  const total = n * n;
  if (a < 0 || b < 0 || a >= total || b >= total || a === b) return false;
  const ra = Math.floor(a / n);
  const rb = Math.floor(b / n);
  const ca = a - ra * n;
  const cb = b - rb * n;
  return Math.abs(ra - rb) + Math.abs(ca - cb) === 1;
}

/**
 * Расстояние от точки p до отрезка ab (в единицах сетки).
 * Нужно для правила «чей центр ближе к отрезку» при проходе через угол.
 */
export function distanceToSegment(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = a.x + t * abx - p.x;
  const qy = a.y + t * aby - p.y;
  return Math.hypot(qx, qy);
}

/**
 * Supercover (Amanatides–Woo) в координатах сетки: последовательность шагов по осям от клетки
 * (cx,cy) до клетки (ex,ey). Каждый шаг — { axis: 'x'|'y', sign: ±1 }. Шаги по одной оси
 * выдаются строго по числу клеток до цели, поэтому алгоритм всегда завершается и приходит
 * ровно в целевую клетку, несмотря на погрешности плавающей точки.
 */
function supercoverSteps(gx0, gy0, gx1, gy1) {
  const cx = Math.floor(gx0);
  const cy = Math.floor(gy0);
  const ex = Math.floor(gx1);
  const ey = Math.floor(gy1);
  const dx = gx1 - gx0;
  const dy = gy1 - gy0;
  const sx = dx > 0 ? 1 : -1;
  const sy = dy > 0 ? 1 : -1;
  let remX = Math.abs(ex - cx);
  let remY = Math.abs(ey - cy);

  // Параметр t, при котором луч пересекает ближайшую границу по каждой оси, и шаг t на клетку.
  const tDeltaX = dx === 0 ? Infinity : 1 / Math.abs(dx);
  const tDeltaY = dy === 0 ? Infinity : 1 / Math.abs(dy);
  let tMaxX = dx === 0 ? Infinity : dx > 0 ? (cx + 1 - gx0) / dx : (gx0 - cx) / -dx;
  let tMaxY = dy === 0 ? Infinity : dy > 0 ? (cy + 1 - gy0) / dy : (gy0 - cy) / -dy;

  const steps = [];
  while (remX > 0 || remY > 0) {
    let axis;
    if (remY === 0) axis = 'x';
    else if (remX === 0) axis = 'y';
    else if (tMaxX < tMaxY) axis = 'x';
    else if (tMaxY < tMaxX) axis = 'y';
    else axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'; // точный угол — ведущая ось первой

    if (axis === 'x') {
      steps.push({ axis: 'x', sign: sx });
      tMaxX += tDeltaX;
      remX--;
    } else {
      steps.push({ axis: 'y', sign: sy });
      tMaxY += tDeltaY;
      remY--;
    }
  }
  return { cx, cy, steps };
}

/**
 * traceCells(from, to, layout, n, canStep) → [cellIdx…].
 * from, to — { x, y } в координатах холста (предыдущая и текущая позиция указателя либо центр
 * головы дорожки и позиция пальца). Результат — 4-связная последовательность клеток, начиная
 * с клетки from (включительно) и до клетки to, построенная supercover-алгоритмом.
 *
 * canStep(a, b) → boolean — правила режима для шага из клетки a в соседнюю b. Шаг в клетку вне
 * сетки всегда нелегален. На первом нелегальном шаге трассировка останавливается и возвращается
 * только легальный префикс (без телепортации). Если клетка from вне сетки → [].
 *
 * Проход через угол (два подряд шага по разным осям): промежуточная клетка выбирается из двух
 * ортогональных — берётся легальная по canStep; если легальны обе — та, чей центр ближе к
 * отрезку from–to. При ничьей (точная диагональ, разница расстояний < 1e-6) решает необязательный
 * prefer(a, b) → boolean — «клетка b предпочтительна для шага из a»: берётся предпочтительная,
 * если предпочтительна ровно одна; иначе (или без prefer) — порядок supercover, ведущая ось первой.
 *
 * Гистерезис здесь не применяется: вызывающий сам решает по cellAt(…, 0.7), достигнута ли
 * клетка под пальцем, и только тогда трассирует.
 */
export function traceCells(from, to, layout, n, canStep = () => true, prefer = null) {
  const { x0, y0, cell } = layout;
  const gx0 = (from.x - x0) / cell;
  const gy0 = (from.y - y0) / cell;
  const gx1 = (to.x - x0) / cell;
  const gy1 = (to.y - y0) / cell;

  const { cx, cy, steps } = supercoverSteps(gx0, gy0, gx1, gy1);
  if (cx < 0 || cy < 0 || cx >= n || cy >= n) return [];

  const inBounds = (c, r) => c >= 0 && r >= 0 && c < n && r < n;
  const legal = (fromIdx, c, r) => inBounds(c, r) && canStep(fromIdx, r * n + c);
  const segA = { x: gx0, y: gy0 };
  const segB = { x: gx1, y: gy1 };

  const cells = [cy * n + cx];
  let c = cx;
  let r = cy;

  for (let i = 0; i < steps.length; i++) {
    const cur = r * n + c;
    const s = steps[i];
    const next = steps[i + 1];

    // Угол: следующий шаг по другой оси — есть выбор промежуточной клетки.
    if (next && next.axis !== s.axis) {
      const nc = c + (s.axis === 'x' ? s.sign : 0);
      const nr = r + (s.axis === 'y' ? s.sign : 0);
      const ac = c + (next.axis === 'x' ? next.sign : 0);
      const ar = r + (next.axis === 'y' ? next.sign : 0);
      const okNatural = legal(cur, nc, nr);
      const okAlt = legal(cur, ac, ar);
      let useAlt = false;
      if (okAlt && !okNatural) {
        useAlt = true;
      } else if (okAlt && okNatural) {
        const dNatural = distanceToSegment({ x: nc + 0.5, y: nr + 0.5 }, segA, segB);
        const dAlt = distanceToSegment({ x: ac + 0.5, y: ar + 0.5 }, segA, segB);
        if (prefer && Math.abs(dAlt - dNatural) < 1e-6) {
          // Ничья: ведущую ось перебивает предпочтение режима (например, непосещённая клетка).
          useAlt = prefer(cur, ar * n + ac) && !prefer(cur, nr * n + nc);
        } else {
          useAlt = dAlt < dNatural - 1e-9;
        }
      }
      if (useAlt) {
        // Меняем порядок двух шагов: сначала альтернативная ось, затем исходная.
        steps[i] = next;
        steps[i + 1] = s;
      }
    }

    const step = steps[i];
    const tc = c + (step.axis === 'x' ? step.sign : 0);
    const tr = r + (step.axis === 'y' ? step.sign : 0);
    if (!legal(cur, tc, tr)) break;
    c = tc;
    r = tr;
    cells.push(r * n + c);
  }
  return cells;
}
