// Симуляция режима «Карандаш» (§2.6): мир matter-js, терраин, штрихи-тела, шарик и цель, банка
// мёда и рой (осы летают, жуки ползут), шары, ящики, качели, ветер, шипы. Детерминирована: шаг
// фиксированный, случайность — mulberry32 от seed уровня. Работает и в браузере, и в Node
// (tools/draw.mjs проверяет уровни повтором эталона). DOM и холст здесь не используются.
import Matter from 'matter-js';
import { mulberry32, hash32 } from '../core/rng.js';

const { Engine, Bodies, Body, Composite, Constraint, Vertices } = Matter;

export const W = 360;
export const H = 520;
export const STEP_MS = 1000 / 120;
export const STEPS_PER_SEC = 120;
export const INK_W = 6; // толщина штриха (единицы мира)
export const MIN_SEG = 4; // минимальный отрезок после упрощения
export const RDP_EPS = 1.5;
export const MAX_REPLAY_STEPS = 36000; // 5 мин: дольше повтор обрезается (штрихи переносятся на край, не теряются)
export const HUMAN_DELAY = 120; // шагов (1 с) между последним штрихом эталона и «Пуск» — темп человека
export const SETTLE_CAP = 600; // ждать, пока нарисованное уляжется, не дольше 5 с
export const GOAL_STEPS = 30; // шарик в цели столько шагов подряд — победа
const G = 0.001; // гравитация matter: сила = масса × g (на единицу gravity.y)
const FALL_Y = H + 60;
const OUT_Y = H + 200;

export const BALL_R = 12;
export const JAR_W = 30;
export const JAR_H = 36;
export const WASP_R = 5;
export const BEETLE_R = 6;
export const BALLOON_R = 9;

// --- Геометрия ---------------------------------------------------------------------------

export function strokeLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return len;
}

function pointSegDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Рамер–Дуглас–Пекер + слияние коротких отрезков (§2.6). */
export function simplifyStroke(points, eps = RDP_EPS, minSeg = MIN_SEG) {
  const pts = (Array.isArray(points) ? points : [])
    .filter(Array.isArray)
    .map((p) => [Number(p[0]), Number(p[1])])
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length < 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1;
    let bestD = eps;
    for (let i = a + 1; i < b; i++) {
      const d = pointSegDist(pts[i], pts[a], pts[b]);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    if (!keep[i]) continue;
    const prev = out[out.length - 1];
    if (prev && Math.hypot(pts[i][0] - prev[0], pts[i][1] - prev[1]) < minSeg && i !== pts.length - 1) continue;
    out.push(pts[i]);
  }
  if (out.length >= 2) {
    const a = out[out.length - 2];
    const b = out[out.length - 1];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < minSeg && out.length > 2) out.splice(out.length - 2, 1);
  }
  return out;
}

/** Обрезать штрих по оставшимся чернилам: возвращает префикс длиной ≤ budget (с частичным отрезком). */
export function trimToBudget(pts, budget) {
  if (budget <= 0 || pts.length < 2) return [];
  const out = [pts[0]];
  let used = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (used + seg <= budget) {
      out.push(b);
      used += seg;
    } else {
      const k = (budget - used) / seg;
      if (k * seg >= MIN_SEG) out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
      break;
    }
  }
  return out.length >= 2 ? out : [];
}

/** Триангуляция простого полигона (ear clipping) → массив треугольников [[x,y]×3]. */
export function triangulate(poly) {
  // Повторяющиеся подряд вершины (и замыкающая, равная первой) ломают отсечение ушей — убираем.
  const pts = [];
  for (const p of Array.isArray(poly) ? poly : []) {
    const q = [Number(p[0]), Number(p[1])];
    const l = pts[pts.length - 1];
    if (!l || Math.hypot(l[0] - q[0], l[1] - q[1]) > 1e-6) pts.push(q);
  }
  while (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 1e-6) pts.pop();
  if (pts.length < 3) return [];
  // Ориентация — по часовой (экранные координаты, y вниз): area < 0 → переворачиваем.
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const idx = pts.map((_, i) => i);
  if (area > 0) idx.reverse();
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inside = (p, a, b, c) => cross(a, b, p) <= 0 && cross(b, c, p) <= 0 && cross(c, a, p) <= 0;
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 1000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      const a = pts[i0];
      const b = pts[i1];
      const c = pts[i2];
      if (cross(a, b, c) >= 0) continue; // не выпуклая вершина (для обхода по часовой)
      let ear = true;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (inside(pts[j], a, b, c)) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      tris.push([a, b, c]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // вырожденный полигон — остаток как есть
  }
  if (idx.length === 3) tris.push([pts[idx[0]], pts[idx[1]], pts[idx[2]]]);
  return tris;
}

// --- Тела -----------------------------------------------------------------------------------

function triBody(tri, opts) {
  const c = Vertices.centre(tri.map(([x, y]) => ({ x, y })));
  return Bodies.fromVertices(c.x, c.y, [tri.map(([x, y]) => ({ x, y }))], opts);
}

/** Тело штриха: прямоугольники-отрезки + круги в вершинах. */
export function strokeBody(pts, { isStatic = false } = {}) {
  const partOpts = { density: 0.0025, friction: 0.7, restitution: 0.05, label: 'ink' };
  const parts = [];
  for (let i = 0; i < pts.length; i++) parts.push(Bodies.circle(pts[i][0], pts[i][1], INK_W / 2, partOpts));
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.5) continue;
    parts.push(Bodies.rectangle((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, len, INK_W, { ...partOpts, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) }));
  }
  const body = Body.create({ parts, isStatic, friction: 0.7, restitution: 0.05, label: 'ink', sleepThreshold: 60 });
  return body;
}

const insideRect = (p, z) => p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h;

// --- Симуляция ------------------------------------------------------------------------------

/**
 * createSim(level) → sim. level — данные уровня §2.6. Методы: addStroke(pts) → { len, body } | null,
 * launch(), step(), events (накопленные события для оболочки), serializable поля: steps, launched.
 */
export function createSim(level) {
  const engine = Engine.create({ enableSleeping: true });
  engine.gravity.y = 1;
  const world = engine.world;
  const rng = mulberry32(hash32(level.seed ?? 1, 'draw'));
  const items = Array.isArray(level.items) ? level.items : [];
  const inkCfg = level.ink || {};
  const sim = {
    level,
    engine,
    world,
    type: level.type === 'swarm' ? 'swarm' : 'ball',
    phase: 'play', // 'play' | 'prep' | 'attack' | 'won' | 'lost'
    steps: 0,
    launched: null,
    strokes: [], // { t, pts, len, body }
    inkTotal: Number(inkCfg.total) > 0 ? Number(inkCfg.total) : 600,
    inkPar: Number(inkCfg.par) > 0 ? Number(inkCfg.par) : 600,
    inkStatic: inkCfg.static === true,
    inkUsed: 0,
    attackSteps: Math.round((Number(level.time) > 0 ? Number(level.time) : 20) * STEPS_PER_SEC),
    ball: null,
    goal: null,
    jar: null,
    jarHp: 0,
    nests: [],
    insects: [],
    balloons: [],
    fans: [],
    spikes: [],
    seesaws: [],
    statics: [],
    dynamics: [],
    goalCounter: 0,
    lostReason: null,
    events: [],
    alive: true, // есть движение или атака — рендеру нужен ещё кадр
    bites: 0,
    killed: 0,
  };

  // Стены по бокам: шарик и насекомые не улетают за край.
  const wallOpts = { isStatic: true, label: 'wall', friction: 0.3 };
  Composite.add(world, [Bodies.rectangle(-25, H / 2, 50, H * 3, wallOpts), Bodies.rectangle(W + 25, H / 2, 50, H * 3, wallOpts)]);

  const bodiesByItem = [];
  items.forEach((it, index) => {
    let body = null;
    switch (it.kind) {
      case 'ground': {
        const tris = triangulate(it.poly || []);
        const parts = tris.map((tri) => triBody(tri, { isStatic: true, friction: it.ice ? 0.02 : 0.6, label: 'ground' }));
        if (parts.length) {
          body = Body.create({ parts, isStatic: true, friction: it.ice ? 0.02 : 0.6, label: it.ice ? 'ice' : 'ground' });
          body.plugin = { poly: it.poly, ice: !!it.ice };
          sim.statics.push(body);
        }
        break;
      }
      case 'block': {
        body = Bodies.rectangle(it.x + it.w / 2, it.y + it.h / 2, it.w, it.h, { isStatic: true, angle: it.angle || 0, friction: it.ice ? 0.02 : 0.6, label: it.ice ? 'ice' : 'ground' });
        sim.statics.push(body);
        break;
      }
      case 'ball': {
        // Шарик живой: малое сопротивление воздуха (иначе он останавливается на ровном месте).
        body = Bodies.circle(it.x, it.y, it.r || BALL_R, { density: 0.001, friction: 0.03, restitution: 0.2, frictionAir: 0.002, label: 'ball' });
        sim.ball = body;
        sim.dynamics.push(body);
        break;
      }
      case 'goal': {
        body = Bodies.circle(it.x, it.y, it.r || 18, { isStatic: true, isSensor: true, label: 'goal' });
        sim.goal = body;
        break;
      }
      case 'jar': {
        body = Bodies.rectangle(it.x, it.y, JAR_W, JAR_H, { isStatic: !it.dynamic, density: 0.003, friction: 0.8, label: 'jar' });
        sim.jar = body;
        sim.jarHp = Number(it.hp) > 0 ? Number(it.hp) : 1;
        if (it.dynamic) sim.dynamics.push(body);
        break;
      }
      case 'nest':
        sim.nests.push({
          x: it.x,
          y: it.y,
          kind: it.insect === 'beetle' ? 'beetle' : 'wasp',
          count: Number.isInteger(it.count) && it.count >= 0 ? it.count : 6,
          every: Number(it.every) > 0 ? Number(it.every) : 400,
          delay: Number(it.delay) >= 0 ? Number(it.delay) : 0,
          spawned: 0,
        });
        break;
      case 'balloon': {
        // Шар засыпает, когда повис неподвижно (иначе сим «жив» вечно); столкновение будит его.
        body = Bodies.circle(it.x, it.y, it.r || BALLOON_R, { density: 0.0003, frictionAir: 0.03, restitution: 0.3, label: 'balloon', sleepThreshold: 60 });
        const b = { body, lift: Number(it.lift) > 0 ? Number(it.lift) : 1.6, to: Number.isInteger(it.to) ? it.to : null, len: it.len || 60, constraint: null };
        sim.balloons.push(b);
        sim.dynamics.push(body);
        break;
      }
      case 'crate': {
        body = Bodies.rectangle(it.x, it.y, it.w || 30, it.h || 30, { density: it.density || 0.001, friction: 0.6, label: 'crate', angle: it.angle || 0 });
        sim.dynamics.push(body);
        break;
      }
      case 'plank': {
        body = Bodies.rectangle(it.x, it.y, it.w || 80, it.h || 6, { density: it.density || 0.0015, friction: 0.6, label: 'plank', angle: it.angle || 0 });
        sim.dynamics.push(body);
        break;
      }
      case 'seesaw': {
        body = Bodies.rectangle(it.x, it.y, it.w || 120, 6, { density: 0.0015, friction: 0.6, label: 'seesaw' });
        const pin = Constraint.create({ pointA: { x: it.x, y: it.y }, bodyB: body, pointB: { x: 0, y: 0 }, length: 0, stiffness: 1 });
        Composite.add(world, pin);
        sim.seesaws.push({ body, x: it.x, y: it.y });
        sim.dynamics.push(body);
        break;
      }
      case 'fan': {
        const d = Array.isArray(it.dir) ? it.dir : [1, 0];
        const n = Math.hypot(d[0], d[1]) || 1;
        sim.fans.push({ x: it.x, y: it.y, w: it.w, h: it.h, dx: d[0] / n, dy: d[1] / n, force: Number(it.force) > 0 ? Number(it.force) : 0.8 });
        break;
      }
      case 'spikes': {
        const dir = it.dir || 'up';
        const vertical = dir === 'left' || dir === 'right';
        const w = vertical ? 10 : it.w || 40;
        const h = vertical ? it.w || 40 : 10;
        body = Bodies.rectangle(it.x + w / 2, it.y + h / 2, w, h, { isStatic: true, isSensor: true, label: 'spikes' });
        body.plugin = { dir, x: it.x, y: it.y, w, h };
        sim.spikes.push(body);
        break;
      }
      default:
        break;
    }
    bodiesByItem[index] = body;
    if (body) Composite.add(world, body);
  });
  // Нити шаров — после создания всех тел.
  for (const b of sim.balloons) {
    if (b.to === null) continue;
    const target = bodiesByItem[b.to];
    if (!target) continue;
    b.constraint = Constraint.create({ bodyA: b.body, bodyB: target, length: b.len, stiffness: 0.6, damping: 0.05 });
    Composite.add(world, b.constraint);
  }
  // Подготовка (§2.6): шарик заморожен, насекомые в гнёздах; штрихи падают и укладываются.
  // «Пуск» / «Выпустить рой» (launch) отпускает шарик и начинает атаку. autoStart — сразу в игру.
  if (level.autoStart === true) {
    sim.phase = sim.jar && sim.nests.length ? 'attack' : 'play';
    sim.launched = 0;
  } else {
    sim.phase = 'prep';
    if (sim.ball) Body.setStatic(sim.ball, true);
  }

  // --- Действия ---
  /**
   * addStroke(points, t, exact) → stroke | null. exact — точки уже упрощены и обрезаны (повтор
   * снимка): берутся как есть, иначе повтор разошёлся бы с живой партией.
   */
  sim.addStroke = (points, t = sim.steps, exact = false) => {
    if (sim.phase === 'won' || sim.phase === 'lost') return null;
    let pts = exact
      ? (Array.isArray(points) ? points : []).filter(Array.isArray).map((p) => [Number(p[0]), Number(p[1])]).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
      : simplifyStroke(points);
    if (pts.length < 2) return null;
    let trimmed = false;
    if (!exact) {
      const budget = sim.inkTotal - sim.inkUsed;
      if (strokeLength(pts) > budget + 1e-6) {
        pts = trimToBudget(pts, budget);
        trimmed = true;
      }
    }
    const len = strokeLength(pts);
    if (pts.length < 2 || len < MIN_SEG * 1.5) {
      if (trimmed) sim.events.push({ kind: 'notice', reason: 'ink', message: MSG_NO_INK });
      return null;
    }
    const body = strokeBody(pts, { isStatic: sim.inkStatic });
    Composite.add(world, body);
    const stroke = { t, pts, len, body, origin: { x: body.position.x, y: body.position.y }, gone: false };
    sim.strokes.push(stroke);
    sim.inkUsed += len;
    sim.alive = true;
    if (trimmed) sim.events.push({ kind: 'notice', reason: 'ink', message: MSG_NO_INK });
    return stroke;
  };

  sim.launch = () => {
    if (sim.phase !== 'prep') return false;
    if (sim.ball && sim.ball.isStatic) {
      Body.setStatic(sim.ball, false);
      Matter.Sleeping.set(sim.ball, false); // замороженный шарик успел «уснуть» — иначе «Пуск» его не отпустит
    }
    sim.phase = sim.jar && sim.nests.length ? 'attack' : 'play';
    sim.launched = sim.steps;
    sim.alive = true;
    return true;
  };

  // --- Насекомые ---
  function spawn(nest) {
    const kind = nest.kind === 'beetle' ? 'beetle' : 'wasp';
    const r = kind === 'beetle' ? BEETLE_R : WASP_R;
    const body =
      kind === 'beetle'
        ? Bodies.circle(nest.x, nest.y, r, { density: 0.0008, friction: 0.9, frictionAir: 0.01, restitution: 0.05, label: 'beetle', sleepThreshold: Infinity })
        : Bodies.circle(nest.x, nest.y, r, { density: 0.0004, friction: 0.1, frictionAir: 0.08, restitution: 0.3, label: 'wasp', sleepThreshold: Infinity });
    Body.setVelocity(body, { x: (rng.next() - 0.5) * 2, y: (rng.next() - 0.5) * 2 });
    const insect = { body, kind, stuck: 0, slide: 0, slideSign: 1, jitter: 0, jumpCool: 0, touching: false, wing: rng.next() * Math.PI * 2 };
    sim.insects.push(insect);
    Composite.add(world, body);
  }

  function target() {
    if (sim.jar) return sim.jar.position;
    if (sim.ball) return sim.ball.position;
    return { x: W / 2, y: H / 2 };
  }

  function driveInsects() {
    const tgt = target();
    for (const ins of sim.insects) {
      const b = ins.body;
      const m = b.mass;
      const dx = tgt.x - b.position.x;
      const dy = tgt.y - b.position.y;
      const dist = Math.hypot(dx, dy) || 1;
      const ux = dx / dist;
      const uy = dy / dist;
      const v = b.velocity;
      const speed = Math.hypot(v.x, v.y);
      if (ins.kind === 'wasp') {
        // Антигравитация + тяга к цели с шумом; застряла — скользит вдоль преграды.
        let fx = 0;
        let fy = -m * G;
        if (ins.slide > 0) {
          ins.slide--;
          fx += (-uy * ins.slideSign * 0.9 + ux * 0.3) * m * G;
          fy += (ux * ins.slideSign * 0.9 + uy * 0.3) * m * G;
        } else {
          if (sim.steps % 12 === 0) ins.jitter = (rng.next() - 0.5) * 1.2;
          const ca = Math.cos(ins.jitter);
          const sa = Math.sin(ins.jitter);
          const jx = ux * ca - uy * sa;
          const jy = ux * sa + uy * ca;
          fx += jx * 0.9 * m * G;
          fy += jy * 0.9 * m * G;
          if (speed < 0.35 && dist > 24) ins.stuck++;
          else ins.stuck = Math.max(0, ins.stuck - 1);
          if (ins.stuck > 40) {
            ins.stuck = 0;
            ins.slide = 84;
            ins.slideSign = rng.next() < 0.5 ? -1 : 1;
          }
        }
        Body.applyForce(b, b.position, { x: fx, y: fy });
        if (speed > 3) Body.setVelocity(b, { x: (v.x / speed) * 3, y: (v.y / speed) * 3 });
      } else {
        // Жук: ползёт по горизонтали, упёрся — прыгает.
        const sgn = dx > 0 ? 1 : -1;
        if (ins.touching) Body.applyForce(b, b.position, { x: sgn * 0.6 * m * G, y: 0 });
        if (Math.abs(v.x) < 0.2 && ins.touching && Math.abs(dx) > 14) ins.stuck++;
        else ins.stuck = Math.max(0, ins.stuck - 1);
        if (ins.jumpCool > 0) ins.jumpCool--;
        if (ins.stuck > 48 && ins.touching && ins.jumpCool === 0) {
          Body.setVelocity(b, { x: sgn * 1.5, y: -7 });
          ins.stuck = 0;
          ins.jumpCool = 96;
        }
        if (Math.abs(v.x) > 2) Body.setVelocity(b, { x: sgn * 2, y: v.y });
      }
      ins.touching = false;
    }
  }

  function driveBalloons() {
    const ballMass = Math.PI * BALL_R * BALL_R * 0.001;
    for (const b of sim.balloons) {
      if (b.body.isSleeping) continue;
      Body.applyForce(b.body, b.body.position, { x: 0, y: -b.lift * ballMass * G });
    }
  }

  function driveFans() {
    if (!sim.fans.length) return;
    for (const body of Composite.allBodies(world)) {
      if (body.isStatic || body.isSensor) continue;
      for (const f of sim.fans) {
        if (!insideRect(body.position, f)) continue;
        Body.applyForce(body, body.position, { x: f.dx * f.force * body.mass * G, y: f.dy * f.force * body.mass * G });
        if (body.isSleeping) Matter.Sleeping.set(body, false);
      }
    }
  }

  function removeInsect(ins) {
    Composite.remove(world, ins.body);
    const i = sim.insects.indexOf(ins);
    if (i >= 0) sim.insects.splice(i, 1);
  }

  function popBalloon(b) {
    if (b.constraint) Composite.remove(world, b.constraint);
    Composite.remove(world, b.body);
    const i = sim.balloons.indexOf(b);
    if (i >= 0) sim.balloons.splice(i, 1);
    sim.events.push({ kind: 'pop' });
  }

  function handlePairs() {
    const insectsByBody = new Map(sim.insects.map((ins) => [ins.body, ins]));
    const balloonsByBody = new Map(sim.balloons.map((b) => [b.body, b]));
    const toRemove = new Set();
    const toPop = new Set();
    for (const pair of engine.pairs.list) {
      if (!pair.isActive) continue;
      const a = pair.bodyA.parent || pair.bodyA;
      const b = pair.bodyB.parent || pair.bodyB;
      for (const [x, y] of [[a, b], [b, a]]) {
        const ins = insectsByBody.get(x);
        if (ins) {
          ins.touching = true;
          if (y.label === 'jar') {
            toRemove.add(ins);
            sim.jarHp--;
            sim.bites++;
            sim.events.push({ kind: 'bite', hp: sim.jarHp });
          } else if (y.label === 'spikes') {
            toRemove.add(ins);
            sim.killed++;
          }
        }
        if (y.label === 'spikes') {
          if (x === sim.ball) sim.lose('spikes');
          const bal = balloonsByBody.get(x);
          if (bal) toPop.add(bal);
        }
      }
    }
    for (const ins of toRemove) removeInsect(ins);
    for (const b of toPop) popBalloon(b);
  }

  sim.lose = (reason) => {
    if (sim.phase === 'won' || sim.phase === 'lost') return;
    sim.phase = 'lost';
    sim.lostReason = reason;
    sim.alive = false;
    sim.events.push({ kind: 'lost', reason, message: LOST_MSG[reason] || LOST_MSG.fell });
  };

  function checkWin() {
    if (sim.type === 'ball') {
      if (!sim.ball || !sim.goal || sim.phase === 'prep') return;
      const d = Math.hypot(sim.ball.position.x - sim.goal.position.x, sim.ball.position.y - sim.goal.position.y);
      if (d <= Math.max(4, sim.goal.circleRadius - sim.ball.circleRadius * 0.4)) sim.goalCounter++;
      else sim.goalCounter = 0;
      if (sim.goalCounter >= GOAL_STEPS) {
        sim.phase = 'won';
        sim.alive = false;
        sim.events.push({ kind: 'solved' });
      }
    } else if (sim.phase === 'attack') {
      if (sim.jarHp <= 0) {
        sim.lose('eaten');
        return;
      }
      if (sim.steps - sim.launched >= sim.attackSteps) {
        sim.phase = 'won';
        sim.alive = false;
        sim.events.push({ kind: 'solved' });
      }
    }
  }

  /** Один фиксированный шаг (§2.6). */
  sim.step = () => {
    if (sim.phase === 'won' || sim.phase === 'lost') return;
    if (sim.launched !== null && (sim.phase === 'attack' || sim.phase === 'play')) {
      // Гнёзда выпускают насекомых после запуска — и в «Рое», и на смешанных уровнях с шариком.
      const since = sim.steps - sim.launched;
      for (const nest of sim.nests) {
        while (nest.spawned < nest.count && since >= Math.round((nest.delay + nest.spawned * nest.every) / STEP_MS)) {
          spawn(nest);
          nest.spawned++;
        }
      }
    }
    driveInsects();
    driveBalloons();
    driveFans();
    Engine.update(engine, STEP_MS);
    sim.steps++;
    handlePairs();
    // Выпавшие за мир: шарик — проигрыш, прочее — убираем.
    if (sim.ball && sim.ball.position.y > FALL_Y) sim.lose('fell');
    for (const ins of sim.insects.slice()) if (ins.body.position.y > OUT_Y) removeInsect(ins);
    for (const b of sim.balloons.slice()) if (b.body.position.y < -300) popBalloon(b);
    // Упавшие в пропасть штрихи и ящики убираем из мира (чернила потрачены, запись штриха остаётся).
    for (const s of sim.strokes) {
      if (s.body && !s.body.isStatic && s.body.position.y > OUT_Y) {
        Composite.remove(world, s.body);
        s.body = null;
        s.gone = true;
      }
    }
    for (const b of sim.dynamics.slice()) {
      if (b !== sim.ball && b !== sim.jar && (b.label === 'crate' || b.label === 'plank') && b.position.y > OUT_Y) {
        Composite.remove(world, b);
        sim.dynamics.splice(sim.dynamics.indexOf(b), 1);
      }
    }
    checkWin();
    if (sim.phase === 'play' || sim.phase === 'prep') {
      // Живо, пока что-то движется (есть неспящие динамические тела) или идёт атака.
      // Шар с подъёмной силой не засыпает никогда (сила будит его каждый шаг): упёршийся в навес
      // или повисший шар считается неподвижным по фактическому смещению за шаг, а не по скорости.
      const resting = new Set();
      for (const b of sim.balloons) {
        const p = b.body.position;
        const lp = b.lastPos;
        b.lastPos = { x: p.x, y: p.y };
        if (lp && Math.abs(p.x - lp.x) + Math.abs(p.y - lp.y) <= 0.02) resting.add(b.body);
      }
      let moving = false;
      for (const body of Composite.allBodies(world)) {
        if (body.isStatic || body.isSleeping || resting.has(body)) continue;
        const v = body.velocity;
        if (Math.abs(v.x) + Math.abs(v.y) > 0.02) {
          moving = true;
          break;
        }
      }
      sim.alive = moving;
    } else if (sim.phase === 'attack') sim.alive = true;
  };

  sim.drain = () => {
    const ev = sim.events;
    sim.events = [];
    return ev;
  };

  /** Положение всех тел — для теста детерминизма. */
  sim.snapshotPositions = () => Composite.allBodies(world).map((b) => [b.label, Math.round(b.position.x * 100) / 100, Math.round(b.position.y * 100) / 100]);

  return sim;
}

export const MSG_NO_INK = { ru: 'Чернила кончились', en: 'Out of ink' };
export const LOST_MSG = {
  fell: { ru: 'Шарик упал', en: 'The ball fell' },
  spikes: { ru: 'Шарик на шипах', en: 'The ball hit the spikes' },
  eaten: { ru: 'Мёд съеден', en: 'The honey is gone' },
};

/**
 * replay(level, strokes, steps, launched) → sim: мир заново, штрихи ставятся на своих шагах,
 * «Выпустить рой» — на шаге launched, затем прогоняется steps шагов (≤ MAX_REPLAY_STEPS).
 */
export function replay(level, strokes = [], steps = 0, launched = null) {
  const sim = createSim(level);
  const total = Math.min(Math.max(0, steps | 0), MAX_REPLAY_STEPS);
  // Штрихи за пределом повтора не теряются: ставятся на последнем шаге.
  const list = (Array.isArray(strokes) ? strokes : [])
    .filter((s) => s && typeof s === 'object' && Array.isArray(s.pts))
    .map((s) => ({ t: Math.min(Math.max(0, s.t | 0), total), pts: s.pts }))
    .sort((a, b) => a.t - b.t);
  const launchAt = Number.isInteger(launched) && launched >= 0 ? Math.min(launched, total) : null;
  let k = 0;
  const addDue = (step) => {
    while (k < list.length && list[k].t <= step) {
      sim.addStroke(list[k].pts, list[k].t, true);
      k++;
    }
  };
  for (let i = 0; i < total; i++) {
    addDue(i);
    if (launchAt !== null && launchAt === i) sim.launch();
    sim.step();
    if (sim.phase === 'won' || sim.phase === 'lost') break;
  }
  while (k < list.length) {
    sim.addStroke(list[k].pts, list[k].t, true);
    k++;
  }
  if (launchAt !== null && launchAt >= total && sim.phase === 'prep') sim.launch();
  sim.events = []; // события повтора оболочке не нужны
  return sim;
}

/**
 * runSolution(level, solution, launch, limitSteps) → { won, lost, steps, reason } — прогон эталона
 * (tools/draw.mjs): штрихи на своих шагах, запуск роя на шаге launch, до победы/проигрыша/лимита.
 */
export function runSolution(level, solution = [], launch = null, limitSteps = 60 * STEPS_PER_SEC, { shift = 0 } = {}) {
  const sim = createSim(level);
  const list = (Array.isArray(solution) ? solution : [])
    .filter((s) => s && typeof s === 'object' && Array.isArray(s.pts))
    .map((s) => ({ t: Math.max(0, s.t | 0) + shift, pts: s.pts }))
    .sort((a, b) => a.t - b.t);
  const launchAt = launch === null ? null : launch + shift;
  let k = 0;
  let inkOk = true;
  let lastStrokeAt = -1;
  let launchedAt = null;
  for (let i = 0; i < limitSteps; i++) {
    while (k < list.length && list[k].t <= i) {
      const st = sim.addStroke(list[k].pts, i);
      if (!st || Math.abs(st.len - strokeLength(simplifyStroke(list[k].pts))) > 1e-6) inkOk = false;
      lastStrokeAt = i;
      k++;
    }
    if (launchAt !== null && launchAt === i) sim.launch();
    // Без явного launch: «Пуск» в темпе человека — через HUMAN_DELAY после последнего штриха, когда
    // нарисованное улеглось (или через SETTLE_CAP), а не на том же шаге.
    if (launchAt === null && k >= list.length && sim.phase === 'prep') {
      const since = i - lastStrokeAt;
      if (since >= HUMAN_DELAY && (!sim.alive || since >= SETTLE_CAP)) sim.launch();
    }
    if (sim.launched !== null && launchedAt === null) launchedAt = sim.launched;
    sim.step();
    if (sim.phase === 'won' || sim.phase === 'lost') break;
  }
  return { launchedAt, won: sim.phase === 'won', lost: sim.phase === 'lost', reason: sim.lostReason, steps: sim.steps, inkUsed: sim.inkUsed, inkOk, sim };
}
