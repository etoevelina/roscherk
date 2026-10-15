// Режим «Карандаш» (draw) — физические головоломки с рисованием (§2.6), контракт §5.1 с
// расширениями: continuous (рендер продвигает симуляцию), worldRect (весь холст), actions/act
// (кнопки «Выпустить рой» / «Заново»), drainEvents (события, накопленные симуляцией во время
// кадра). Симуляция — draw.sim.js (matter-js); здесь только состояние, ввод и рисование.
import { createSim, replay, simplifyStroke, strokeLength, W, H, STEP_MS, INK_W, STEPS_PER_SEC, JAR_W, JAR_H, MAX_REPLAY_STEPS } from './draw.sim.js';
import { roundRect } from '../core/canvas.js';

const FONT = '-apple-system, system-ui, "Helvetica Neue", Arial, sans-serif';
const MAX_CATCHUP_MS = 4 * (1000 / 60);
const MAX_STEPS_PER_FRAME = 10;
const HINT_MS = 2500;
const BAR_H = 14; // полоса чернил над полем (CSS px)
const BAR_GAP = 8;
const POINT_HYST = 2; // новая точка штриха — не ближе 2 ед. к предыдущей
const APPEAR_MS = 200;

// Палитра предметов WORDS (docs/DESIGN.md §5.6): приглушённый мёд, лавандовый стеклянный шарик
// (как lavender-orb), лёд — голубое семейство (--w-blue-2), осы — графит с медовыми полосами.
// lavHi — блик стеклянного шарика; wing — крылья ос; ice — заливка льда.
const COLORS = {
  light: { honey: '#D4A24C', honeyDark: '#B08636', lav: '#C6C2DE', lavDark: '#8E89AE', lavHi: '#F4F2FA', wasp: '#2D302D', stripe: '#DDBD57', nest: '#B9A07A', wind: '#8E89AE', wing: '#AEB7C4', ice: '#DDE3EA' },
  dark: { honey: '#C49735', honeyDark: '#8E6A22', lav: '#9C96C4', lavDark: '#6E6896', lavHi: '#D9D5EE', wasp: '#E6E4DE', stripe: '#D2B04E', nest: '#7F7360', wind: '#B4ADDA', wing: '#5E625C', ice: '#252C34' },
};
const FIELD_R = 22; // скругление поля (карточка WORDS 24 при полном масштабе)

const CHAPTER_LABELS = {
  1: { ru: 'Разминка', en: 'Warm-up' },
  2: { ru: 'Шарик', en: 'Ball' },
  3: { ru: 'Рой', en: 'Swarm' },
  4: { ru: 'Буря', en: 'Storm' },
};

const MSG = {
  launch: { ru: 'Выпустить рой', en: 'Release the swarm' },
  go: { ru: 'Пуск', en: 'Go' },
  retry: { ru: 'Заново', en: 'Retry' },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Точки штриха в мировых координатах с учётом движения тела (полилиния вместо частей тела). */
function strokeWorldPoints(stroke) {
  const b = stroke.body;
  const cos = Math.cos(b.angle);
  const sin = Math.sin(b.angle);
  const ox = stroke.origin.x;
  const oy = stroke.origin.y;
  return stroke.pts.map(([x, y]) => {
    const lx = x - ox;
    const ly = y - oy;
    return [b.position.x + lx * cos - ly * sin, b.position.y + lx * sin + ly * cos];
  });
}

function newState(level, sim, saved) {
  const strokes = sim.strokes.map((s) => ({ t: s.t, pts: s.pts }));
  return {
    level,
    sim,
    strokes,
    drawing: null, // { pts } — штрих под пальцем (мировые координаты)
    lastNow: null,
    acc: 0,
    pending: [],
    hint: null,
    hintUsed: saved?.hintUsed === true,
    appearAt: saved ? -Infinity : NaN,
    launchedAt: -Infinity, // performance.now() запуска роя (вспышка гнёзд)
    _cache: null,
  };
}

const mode = {
  id: 'draw',
  icon: 'pencil',
  name: { ru: 'Карандаш', en: 'Pencil' },
  tagline: { ru: 'Нарисуй — и оно станет твёрдым', en: 'Draw it and it turns solid' },
  helpText: {
    ru: 'Нарисуй мостик или груз пальцем — линия станет твёрдой. Доведи шарик до цели или защити мёд от роя.',
    en: 'Draw a bridge or a weight with your finger — the line turns solid. Roll the ball home or shield the honey from the swarm.',
  },
  // WORDS: тёплая терракота (docs/DESIGN.md §5.3). Светлая — ≥ 4.5:1 к бумаге и белый текст ≥ 5:1,
  // тёмная — пастель ≥ 7:1. Само поле рисуется чернилами; акцент — оболочка, призрак, свечение.
  color: '#D4A08C',
  colorLight: '#9B5A44',
  continuous: true,
  worldRect: true,
  campaignOnly: true,

  /** Название главы для карты уровней (§2.6): 1 Разминка · 2 Шарик · 3 Рой · 4 Буря. */
  chapterLabel(n) {
    return CHAPTER_LABELS[n] || null;
  },

  /** create(levelData, saved) → state. Снимок восстанавливается повтором (§2.6). */
  create(levelData, saved) {
    const restoring = !!saved && typeof saved === 'object' && Array.isArray(saved.strokes);
    const sim = restoring ? replay(levelData, saved.strokes, saved.steps, Number.isInteger(saved.launched) ? saved.launched : null) : createSim(levelData);
    return newState(levelData, sim, restoring ? saved : null);
  },

  /** Снимок: точки штрихов как есть (они уже округлены при вводе) — повтор совпадает с живой партией. */
  serialize(state) {
    const sim = state.sim;
    return {
      strokes: sim.strokes.map((s) => ({ t: Math.min(s.t, MAX_REPLAY_STEPS), pts: s.pts })),
      steps: sim.steps,
      launched: sim.launched,
      hintUsed: state.hintUsed,
    };
  },

  /** layout(state, rect) → { scale, ox, oy, w, h, bar: {x,y,w,h} }: мир вписан под полосой чернил. */
  layout(state, rect) {
    const top = rect.y + BAR_H + BAR_GAP;
    const availH = Math.max(1, rect.h - BAR_H - BAR_GAP);
    const scale = Math.min(rect.w / W, availH / H);
    const w = W * scale;
    const h = H * scale;
    const ox = rect.x + (rect.w - w) / 2;
    const oy = top + (availH - h) / 2;
    return { scale, ox, oy, w, h, bar: { x: ox, y: rect.y + (oy - top) + 0, w, h: BAR_H } };
  },

  /** render(ctx, state, layout, theme, t, opts) → true, пока сим жив или идёт рисование/подсказка. */
  render(ctx, state, layout, theme, t, opts) {
    const sim = state.sim;
    const reduced = !!(opts && opts.reducedMotion);
    const C = COLORS[theme.id === 'dark' ? 'dark' : 'light'];
    // --- Симуляция: догоняем реальное время фиксированными шагами.
    const running = sim.phase !== 'won' && sim.phase !== 'lost';
    if (running) {
      if (state.lastNow === null) state.lastNow = t;
      const dt = Math.min(Math.max(0, t - state.lastNow), MAX_CATCHUP_MS);
      state.lastNow = t;
      if (sim.alive || state.drawing) {
        state.acc += dt;
        let n = 0;
        while (state.acc >= STEP_MS && n < MAX_STEPS_PER_FRAME) {
          sim.step();
          state.acc -= STEP_MS;
          n++;
          if (sim.phase === 'won' || sim.phase === 'lost') break;
        }
        if (n >= MAX_STEPS_PER_FRAME) state.acc = 0;
      } else state.acc = 0;
    } else state.lastNow = null;
    const ev = sim.drain();
    if (ev.length) state.pending.push(...ev);

    let animating = running && (sim.alive || !!state.drawing);
    if (Number.isNaN(state.appearAt)) state.appearAt = opts && opts.appeared ? -Infinity : t;
    let appear = 1;
    if (!reduced && t - state.appearAt < APPEAR_MS) {
      appear = clamp((t - state.appearAt) / APPEAR_MS, 0, 1);
      animating = true;
    }
    const { scale, ox, oy, w, h } = layout;
    const X = (x) => ox + x * scale;
    const Y = (y) => oy + y * scale;

    ctx.save();
    ctx.globalAlpha = appear;

    // --- Полоса чернил — прогресс WORDS: тонкая дорожка (волосяная), заливка чернилами (активный
    // прогресс; < 15 % — --w-danger), подпись «N %» справа тихим текстом на холсте (≥ 4.5:1).
    const bar = layout.bar;
    const frac = clamp(1 - sim.inkUsed / sim.inkTotal, 0, 1);
    const labelSize = theme.large ? 13 : 11;
    const labelW = labelSize * 3.6;
    const th = Math.min(bar.h, 6);
    const ty = bar.y + (bar.h - th) / 2;
    const tw = Math.max(th, bar.w - labelW);
    ctx.fillStyle = theme.hairline || theme.surface2;
    roundRect(ctx, bar.x, ty, tw, th, th / 2);
    ctx.fill();
    if (frac > 0) {
      ctx.fillStyle = frac < 0.15 ? theme.danger : theme.ink || theme.text;
      roundRect(ctx, bar.x, ty, Math.max(th, tw * frac), th, th / 2);
      ctx.fill();
    }
    ctx.font = `600 ${labelSize}px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.textMuted; // --w-danger на холсте < 4.5:1 — предупреждает заливка
    ctx.fillText(`${Math.round(frac * 100)} %`, bar.x + bar.w, bar.y + bar.h / 2 + 0.5);

    // --- Поле (бумага WORDS на холсте, волосяная обводка — после содержимого, поверх среза).
    const fieldR = FIELD_R * Math.min(1, scale * 1.2);
    ctx.fillStyle = theme.paper || theme.surface;
    roundRect(ctx, ox, oy, w, h, fieldR);
    ctx.fill();
    ctx.save();
    roundRect(ctx, ox, oy, w, h, fieldR);
    ctx.clip();

    // --- Вентиляторы (зоны ветра) — под всем.
    for (const f of sim.fans) {
      ctx.fillStyle = C.ice;
      ctx.globalAlpha = 0.6 * appear;
      ctx.fillRect(X(f.x), Y(f.y), f.w * scale, f.h * scale);
      ctx.globalAlpha = appear;
      ctx.strokeStyle = C.wind;
      ctx.lineWidth = Math.max(1, 1.5 * scale);
      ctx.lineCap = 'round';
      const lines = 5;
      const along = Math.max(f.w, f.h) * scale;
      const phase = reduced ? 0.3 : ((t / 900) % 1);
      for (let i = 0; i < lines; i++) {
        const u = (i + 0.5) / lines;
        const px = f.x + (Math.abs(f.dx) > 0.5 ? 0 : f.w * u);
        const py = f.y + (Math.abs(f.dx) > 0.5 ? f.h * u : 0);
        const len = along * 0.35;
        const off = ((phase + i * 0.2) % 1) * (along - len);
        const sx = X(px) + f.dx * off;
        const sy = Y(py) + f.dy * off;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + f.dx * len, sy + f.dy * len);
        ctx.stroke();
      }
      if (!reduced) animating = true;
    }

    // --- Статика: земля — фарфор холста с чернильным контуром, лёд — голубое семейство. Сначала
    // заливки, потом контуры в поле, ужатом на полтолщины линии: контур, лежащий на краю поля, не
    // спорит со скруглённым краем карточки (край задаёт волосяная обводка поля).
    const staticPath = (body) => {
      ctx.beginPath();
      if (body.plugin && body.plugin.poly) body.plugin.poly.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      else body.vertices.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
      ctx.closePath();
    };
    for (const body of sim.statics) {
      ctx.fillStyle = body.label === 'ice' ? C.ice : theme.canvas || theme.surface2;
      staticPath(body);
      ctx.fill();
    }
    const outlineW = Math.max(1.5, 2 * scale);
    const inset = outlineW / 2 + 0.5;
    ctx.save();
    roundRect(ctx, ox + inset, oy + inset, w - 2 * inset, h - 2 * inset, Math.max(0, fieldR - inset));
    ctx.clip();
    ctx.strokeStyle = theme.ink || theme.text;
    ctx.lineWidth = outlineW;
    ctx.lineJoin = 'round';
    for (const body of sim.statics) {
      staticPath(body);
      ctx.stroke();
    }
    ctx.restore();

    // --- Шипы.
    ctx.fillStyle = theme.ink || theme.text;
    for (const sp of sim.spikes) {
      const { dir, x, y, w: sw, h: sh } = sp.plugin;
      const n = Math.max(2, Math.round((dir === 'left' || dir === 'right' ? sh : sw) / 10));
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (dir === 'up' || dir === 'down') {
          const x0 = x + (sw / n) * i;
          const x1 = x + (sw / n) * (i + 1);
          const base = dir === 'up' ? y + sh : y;
          const tip = dir === 'up' ? y : y + sh;
          ctx.moveTo(X(x0), Y(base));
          ctx.lineTo(X((x0 + x1) / 2), Y(tip));
          ctx.lineTo(X(x1), Y(base));
        } else {
          const y0 = y + (sh / n) * i;
          const y1 = y + (sh / n) * (i + 1);
          const base = dir === 'left' ? x + sw : x;
          const tip = dir === 'left' ? x : x + sw;
          ctx.moveTo(X(base), Y(y0));
          ctx.lineTo(X(tip), Y((y0 + y1) / 2));
          ctx.lineTo(X(base), Y(y1));
        }
      }
      ctx.closePath();
      ctx.fill();
    }

    // --- Гнёзда.
    for (const nest of sim.nests) {
      const r = 11 * scale;
      const flash = !reduced && t - state.launchedAt < 500 ? 1 - (t - state.launchedAt) / 500 : 0;
      if (flash) animating = true;
      ctx.fillStyle = C.nest;
      ctx.strokeStyle = theme.ink || theme.text;
      ctx.lineWidth = Math.max(1, 1.5 * scale);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        const px = X(nest.x) + Math.cos(a) * r * (1 + 0.25 * flash);
        const py = Y(nest.y) + Math.sin(a) * r * (1 + 0.25 * flash);
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = theme.ink || theme.text;
      ctx.beginPath();
      ctx.arc(X(nest.x), Y(nest.y), 3 * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- Цель.
    if (sim.goal) {
      const g = sim.goal;
      const r = g.circleRadius * scale;
      ctx.strokeStyle = theme.ok;
      ctx.lineWidth = Math.max(1.5, 2 * scale);
      ctx.setLineDash([4 * scale, 4 * scale]);
      ctx.beginPath();
      ctx.arc(X(g.position.x), Y(g.position.y), r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = theme.ok;
      ctx.globalAlpha = 0.18 * appear;
      ctx.beginPath();
      ctx.arc(X(g.position.x), Y(g.position.y), r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = appear;
      star(ctx, X(g.position.x), Y(g.position.y), r * 0.45, theme.ok);
    }

    // --- Динамика: ящики, доски, качели.
    for (const body of sim.dynamics) {
      if (body === sim.ball || body === sim.jar || body.label === 'balloon') continue;
      const v = body.vertices;
      ctx.fillStyle = theme.tile || theme.surface;
      ctx.strokeStyle = theme.ink || theme.text;
      ctx.lineWidth = Math.max(1.5, 2 * scale);
      ctx.beginPath();
      v.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (body.label === 'crate') {
        ctx.beginPath();
        ctx.moveTo(X(v[0].x), Y(v[0].y));
        ctx.lineTo(X(v[2].x), Y(v[2].y));
        ctx.lineWidth = Math.max(1, 1 * scale);
        ctx.stroke();
      }
    }
    for (const s of sim.seesaws) {
      ctx.fillStyle = theme.ink || theme.text;
      ctx.beginPath();
      ctx.moveTo(X(s.x) - 8 * scale, Y(s.y) + 14 * scale);
      ctx.lineTo(X(s.x), Y(s.y));
      ctx.lineTo(X(s.x) + 8 * scale, Y(s.y) + 14 * scale);
      ctx.closePath();
      ctx.fill();
    }

    // --- Банка мёда.
    if (sim.jar) {
      const j = sim.jar;
      ctx.save();
      ctx.translate(X(j.position.x), Y(j.position.y));
      ctx.rotate(j.angle);
      const jw = JAR_W * scale;
      const jh = JAR_H * scale;
      ctx.fillStyle = C.honey;
      roundRect(ctx, -jw / 2, -jh / 2 + 6 * scale, jw, jh - 6 * scale, 5 * scale);
      ctx.fill();
      ctx.strokeStyle = theme.ink || theme.text;
      ctx.lineWidth = Math.max(1.5, 2 * scale);
      ctx.stroke();
      ctx.fillStyle = theme.ink || theme.text;
      roundRect(ctx, -jw / 2 + 3 * scale, -jh / 2, jw - 6 * scale, 8 * scale, 2 * scale);
      ctx.fill();
      ctx.fillStyle = C.honeyDark;
      ctx.globalAlpha = 0.35 * appear;
      ctx.fillRect(-jw / 2 + 4 * scale, 2 * scale, jw - 8 * scale, jh / 2 - 6 * scale);
      ctx.globalAlpha = appear;
      ctx.restore();
      if (sim.jarHp > 1) {
        ctx.fillStyle = theme.ink || theme.text;
        ctx.font = `600 ${Math.round((theme.large ? 12 : 10) * scale)}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(`♥${sim.jarHp}`, X(j.position.x), Y(j.position.y) - (JAR_H / 2 + 8) * scale);
      }
    }

    // --- Штрихи (чернила).
    ctx.strokeStyle = theme.ink || theme.text;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, INK_W * scale);
    for (const s of sim.strokes) {
      if (s.gone || !s.body) continue;
      const pts = strokeWorldPoints(s);
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      if (pts.length === 1) ctx.lineTo(X(pts[0][0]) + 0.1, Y(pts[0][1]));
      ctx.stroke();
    }
    if (state.drawing && state.drawing.pts.length) {
      const pts = state.drawing.pts;
      ctx.globalAlpha = 0.8 * appear;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      if (pts.length === 1) ctx.lineTo(X(pts[0][0]) + 0.1, Y(pts[0][1]));
      ctx.stroke();
      ctx.globalAlpha = appear;
    }

    // --- Шары (над штрихами, с нитью).
    for (const b of sim.balloons) {
      const body = b.body;
      if (b.constraint && b.constraint.bodyB) {
        const o = b.constraint.bodyB.position;
        ctx.strokeStyle = theme.textMuted;
        ctx.lineWidth = Math.max(1, 1 * scale);
        ctx.beginPath();
        ctx.moveTo(X(body.position.x), Y(body.position.y));
        ctx.lineTo(X(o.x), Y(o.y));
        ctx.stroke();
      }
      const r = body.circleRadius * scale;
      ctx.fillStyle = C.lav;
      ctx.strokeStyle = theme.ink || theme.text;
      ctx.lineWidth = Math.max(1, 1.5 * scale);
      ctx.beginPath();
      ctx.ellipse(X(body.position.x), Y(body.position.y), r, r * 1.12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (!reduced) {
        ctx.fillStyle = C.lavHi;
        ctx.globalAlpha = 0.6 * appear;
        ctx.beginPath();
        ctx.ellipse(X(body.position.x) - r * 0.35, Y(body.position.y) - r * 0.4, r * 0.22, r * 0.32, -0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = appear;
      }
    }

    // --- Шарик.
    if (sim.ball) {
      const b = sim.ball;
      const r = b.circleRadius * scale;
      const bx = X(b.position.x);
      const by = Y(b.position.y);
      // Стеклянный лавандовый шарик (lavender-orb WORDS): блик сверху слева, тень к краю.
      const glass = ctx.createRadialGradient ? ctx.createRadialGradient(bx - r * 0.35, by - r * 0.4, r * 0.08, bx, by, r) : null;
      if (glass && glass.addColorStop) {
        glass.addColorStop(0, C.lavHi);
        glass.addColorStop(0.55, C.lav);
        glass.addColorStop(1, C.lavDark);
        ctx.fillStyle = glass;
      } else ctx.fillStyle = C.lav;
      ctx.strokeStyle = theme.ink || theme.text;
      ctx.lineWidth = Math.max(1.5, 2 * scale);
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Метка вращения.
      ctx.fillStyle = theme.ink || theme.text;
      ctx.beginPath();
      ctx.arc(X(b.position.x) + Math.cos(b.angle) * r * 0.55, Y(b.position.y) + Math.sin(b.angle) * r * 0.55, Math.max(1.5, r * 0.16), 0, Math.PI * 2);
      ctx.fill();
    }

    // --- Насекомые.
    for (const ins of sim.insects) {
      const b = ins.body;
      const r = b.circleRadius * scale;
      const px = X(b.position.x);
      const py = Y(b.position.y);
      const v = b.velocity;
      const ang = Math.atan2(v.y, v.x);
      if (ins.kind === 'wasp') {
        const flap = reduced ? 0.6 : 0.4 + 0.6 * Math.abs(Math.sin(t / 40 + ins.wing));
        ctx.fillStyle = C.wing;
        ctx.globalAlpha = 0.55 * appear;
        ctx.beginPath();
        ctx.ellipse(px - Math.sin(ang) * r * 0.9, py + Math.cos(ang) * r * 0.9, r * 1.1 * flap, r * 0.5, ang, 0, Math.PI * 2);
        ctx.ellipse(px + Math.sin(ang) * r * 0.9, py - Math.cos(ang) * r * 0.9, r * 1.1 * flap, r * 0.5, ang, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = appear;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(ang);
        ctx.fillStyle = C.wasp;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.25, r * 0.85, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.stripe;
        ctx.fillRect(-r * 0.25, -r * 0.8, r * 0.3, r * 1.6);
        ctx.fillRect(r * 0.3, -r * 0.7, r * 0.25, r * 1.4);
        ctx.restore();
      } else {
        ctx.fillStyle = C.wasp;
        ctx.beginPath();
        ctx.ellipse(px, py, r * 1.15, r * 0.95, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = C.wasp;
        ctx.lineWidth = Math.max(1, 1.2 * scale);
        const wig = reduced ? 0 : Math.sin(t / 60 + ins.wing) * 0.4;
        for (const s of [-1, 1]) {
          for (const k of [-0.6, 0, 0.6]) {
            ctx.beginPath();
            ctx.moveTo(px + k * r, py);
            ctx.lineTo(px + k * r + s * r * 0.9, py + r * (0.9 + wig * 0.3));
            ctx.stroke();
          }
        }
      }
    }

    // --- Подсказка: призрак штриха эталона.
    if (state.hint && t < state.hint.until) {
      animating = true;
      const fade = Math.min(1, (state.hint.until - t) / 400);
      ctx.strokeStyle = theme.hint;
      ctx.lineWidth = Math.max(2, INK_W * scale);
      ctx.setLineDash([6 * scale, 6 * scale]);
      ctx.globalAlpha = 0.9 * fade * appear;
      ctx.beginPath();
      state.hint.pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = appear;
    }

    // --- Проигрыш: затемнение.
    if (sim.phase === 'lost') {
      ctx.fillStyle = theme.bg;
      ctx.globalAlpha = 0.4 * appear;
      ctx.fillRect(ox, oy, w, h);
      ctx.globalAlpha = appear;
    }
    ctx.restore(); // clip
    // Волосяная обводка поля — поверх срезанной земли, как край карточки WORDS.
    ctx.strokeStyle = theme.hairline || theme.grid;
    ctx.lineWidth = 1;
    roundRect(ctx, ox + 0.5, oy + 0.5, w - 1, h - 1, fieldR);
    ctx.stroke();
    ctx.restore();
    return animating;
  },

  /** pointer: down начинает штрих, move добавляет точки, up делает тело (§2.6). */
  pointer(state, layout, ev) {
    const sim = state.sim;
    if (!ev || !layout) return [];
    // Точки округляются до 0,1 ед. до симуляции: снимок хранит их как есть, повтор точен.
    const r1 = (v) => Math.round(v * 10) / 10;
    const toWorld = (x, y) => [r1(clamp((x - layout.ox) / layout.scale, 0, W)), r1(clamp((y - layout.oy) / layout.scale, -40, H))];
    if (ev.type === 'down') {
      if (sim.phase === 'won' || sim.phase === 'lost') return [];
      state.drawing = { pts: [toWorld(ev.x, ev.y)] };
      return [];
    }
    if (!state.drawing) return [];
    if (ev.type === 'move') {
      const p = toWorld(ev.x, ev.y);
      const last = state.drawing.pts[state.drawing.pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= POINT_HYST) state.drawing.pts.push(p);
      return [];
    }
    // up / cancel
    const pts = state.drawing.pts;
    state.drawing = null;
    const events = [];
    if (sim.phase === 'won' || sim.phase === 'lost') return events;
    const stroke = sim.addStroke(pts, sim.steps);
    const notices = sim.drain();
    if (stroke) {
      state.strokes.push({ t: stroke.t, pts: stroke.pts });
      events.push({ kind: 'step', index: state.strokes.length }, { kind: 'changed' });
    }
    events.push(...notices);
    return events;
  },

  /** События, накопленные симуляцией во время рендера (проигрыш, укусы, победа). */
  drainEvents(state) {
    const ev = state.pending;
    state.pending = [];
    return ev;
  },

  isSolved(state) {
    return state.sim.phase === 'won';
  },

  reset(state) {
    state.sim = createSim(state.level);
    state.strokes = [];
    state.drawing = null;
    state.lastNow = null;
    state.acc = 0;
    state.hint = null;
    state.pending = [];
  },

  /** Кнопки нижней панели: «Выпустить рой» в подготовке, «Заново» после проигрыша. */
  actions(state) {
    const sim = state.sim;
    // «Пуск» и «Заново» не попадают в историю отмены: «Отменить» всегда убирает последний штрих.
    if (sim.phase === 'prep') return [{ id: 'launch', label: sim.jar && sim.nests.length ? MSG.launch : MSG.go, primary: true, undoable: false }];
    if (sim.phase === 'lost') return [{ id: 'retry', label: MSG.retry, primary: true, undoable: false }];
    return [];
  },

  act(state, id, t = 0) {
    const sim = state.sim;
    if (id === 'launch') {
      if (!sim.launch()) return [];
      state.launchedAt = t;
      return [{ kind: 'changed' }, { kind: 'launch' }];
    }
    if (id === 'retry') {
      if (sim.phase !== 'lost') return [];
      // Те же штрихи — с нуля, все на шаге 0, снова подготовка (§2.6).
      const strokes = state.strokes.map((s) => ({ t: 0, pts: s.pts }));
      state.sim = replay(state.level, strokes, 0, null);
      state.strokes = state.sim.strokes.map((s) => ({ t: s.t, pts: s.pts }));
      state.lastNow = null;
      state.acc = 0;
      state.hint = null;
      return [{ kind: 'changed' }];
    }
    return [];
  },

  /**
   * Подсказка — призрак первого штриха эталона, которого ещё нет на поле (§2.6): штрих считается
   * нарисованным, если среди штрихов игрока есть похожий (длина в пределах ±50 %, все точки эталона
   * не дальше 15 ед. от его ломаной). Лишние штрихи игрока подсказке не мешают.
   */
  hint(state, t = 0) {
    const sol = Array.isArray(state.level.solution) ? state.level.solution : [];
    if (state.sim.phase === 'won') {
      state.hint = null;
      return { kind: 'none' };
    }
    const next = sol.find((s) => s && Array.isArray(s.pts) && s.pts.length >= 2 && !state.strokes.some((d) => strokeMatches(d.pts, s.pts)));
    if (!next) {
      state.hint = null;
      return { kind: 'none' };
    }
    state.hintUsed = true;
    state.hint = { kind: 'ghost', pts: next.pts, until: t + HINT_MS };
    return { kind: 'ghost', pts: next.pts };
  },

  stats(state) {
    const sim = state.sim;
    const pct = Math.round((100 * sim.inkUsed) / sim.inkTotal);
    const lines = [
      { ru: `Потрачено чернил: ${pct} %`, en: `Ink used: ${pct}%` },
      { ru: `Штрихов: ${sim.strokes.length}`, en: `Strokes: ${sim.strokes.length}` },
    ];
    if (sim.type === 'swarm') lines.push({ ru: `Выдержано: ${Math.round(sim.attackSteps / STEPS_PER_SEC)} с`, en: `Held out: ${Math.round(sim.attackSteps / STEPS_PER_SEC)} s` });
    if (sim.killed) lines.push({ ru: `На шипах: ${sim.killed}`, en: `On the spikes: ${sim.killed}` });
    return { lines };
  },

  /** Звезда — чернил не больше par. */
  perfect(state) {
    return state.sim.inkUsed <= state.sim.inkPar + 1e-6;
  },

  ghost() {
    return null;
  },

  /** Обратный отсчёт атаки: «держись 12 с». */
  nextLabel(state) {
    const sim = state.sim;
    if (sim.phase !== 'attack') return null;
    const left = Math.max(0, Math.ceil((sim.attackSteps - (sim.steps - sim.launched)) / STEPS_PER_SEC));
    return `держись ${left} с`;
  },

  footer(state) {
    const sim = state.sim;
    const pct = Math.round((100 * Math.max(0, sim.inkTotal - sim.inkUsed)) / sim.inkTotal);
    return { ru: `чернила ${pct} %`, en: `ink ${pct}%` };
  },
};

/** Расстояние от точки до ломаной. */
function distToPolyline(p, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    let u = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
    u = Math.max(0, Math.min(1, u));
    const d = Math.hypot(p[0] - (a[0] + u * dx), p[1] - (a[1] + u * dy));
    if (d < best) best = d;
  }
  return pts.length === 1 ? Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) : best;
}

/** Штрих игрока drawn «похож» на штрих эталона ref (см. hint). */
export function strokeMatches(drawn, ref, tol = 15) {
  if (!Array.isArray(drawn) || drawn.length < 2) return false;
  const ld = strokeLength(drawn);
  const lr = strokeLength(ref);
  if (ld < lr * 0.5 || ld > lr * 1.5) return false;
  return ref.every((p) => distToPolyline(p, drawn) <= tol);
}

function star(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = -Math.PI / 2 + (Math.PI / 5) * i;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

export { simplifyStroke, strokeLength };
export default mode;
