// Симуляция «Карандаша» (§2.6): упрощение штриха, бюджет чернил, триангуляция, мир и фазы,
// рой, повтор = живой прогон, детерминизм, эталон побеждает, бездействие — нет.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, replay, runSolution, simplifyStroke, trimToBudget, strokeLength, triangulate, W, H, STEPS_PER_SEC } from '../src/modes/draw.sim.js';

const BALL = {
  type: 'ball', seed: 101, ink: { total: 260, par: 160, static: true },
  items: [
    { kind: 'ground', poly: [[0, 230], [130, 290], [130, 520], [0, 520]] },
    { kind: 'ground', poly: [[230, 300], [360, 300], [360, 520], [230, 520]] },
    { kind: 'ball', x: 30, y: 230 },
    { kind: 'goal', x: 320, y: 282 },
  ],
  solution: [{ t: 0, pts: [[120, 292], [160, 296], [200, 300], [240, 304]] }],
};
const SWARM = {
  type: 'swarm', seed: 3, ink: { total: 400, par: 300 }, time: 10,
  items: [
    { kind: 'block', x: 0, y: 480, w: 360, h: 40 },
    { kind: 'jar', x: 180, y: 462 },
    { kind: 'nest', x: 40, y: 60, insect: 'wasp', count: 8, every: 300 },
    { kind: 'nest', x: 320, y: 420, insect: 'beetle', count: 4, every: 600, delay: 1000 },
  ],
  solution: [{ t: 0, pts: [[130, 480], [130, 400], [180, 380], [230, 400], [230, 480]] }],
};

test('simplifyStroke: убирает промежуточные точки на прямой и слишком короткие отрезки', () => {
  const pts = Array.from({ length: 30 }, (_, i) => [i * 3, 100 + (i % 2) * 0.3]);
  const s = simplifyStroke(pts);
  assert.ok(s.length <= 3, `осталось ${s.length}`);
  assert.deepEqual(s[0], [0, 100]);
  assert.deepEqual(s[s.length - 1], pts[pts.length - 1]);
  assert.deepEqual(simplifyStroke([[1, 1]]), [[1, 1]]);
  assert.equal(simplifyStroke([[0, 0], [1, 0], [2, 0], [3, 0]]).length, 2);
});

test('trimToBudget: префикс нужной длины, пустой при нулевом бюджете', () => {
  const pts = [[0, 0], [100, 0], [200, 0]];
  assert.equal(Math.round(strokeLength(trimToBudget(pts, 150))), 150);
  assert.deepEqual(trimToBudget(pts, 0), []);
  assert.equal(strokeLength(trimToBudget(pts, 1000)), 200);
});

test('triangulate: выпуклый и вогнутый полигоны дают треугольники с той же площадью', () => {
  const area = (p) => Math.abs(p.reduce((a, [x, y], i) => a + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0)) / 2;
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const L = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
  for (const poly of [sq, L, [...L].reverse()]) {
    const tris = triangulate(poly);
    assert.equal(tris.length, poly.length - 2);
    assert.ok(Math.abs(tris.reduce((a, t) => a + area(t), 0) - area(poly)) < 1e-6);
  }
});

test('мир: подготовка → Пуск; без штрихов шарик падает; с мостиком — побеждает', () => {
  const sim = createSim(BALL);
  assert.equal(sim.phase, 'prep');
  assert.equal(sim.ball.isStatic, true);
  for (let i = 0; i < 120; i++) sim.step();
  assert.equal(sim.ball.position.y, 230, 'в подготовке шарик стоит');
  const idle = runSolution(BALL, [], 0);
  assert.ok(idle.lost && idle.reason === 'fell');
  const sol = runSolution(BALL, BALL.solution);
  assert.ok(sol.won, `победа, шаг ${sol.steps}`);
  assert.ok(sol.steps < 10 * STEPS_PER_SEC);
  assert.ok(sol.inkUsed > 100 && sol.inkUsed <= 260);
});

test('чернила: штрих обрезается по бюджету с событием notice; слишком короткий — отброшен', () => {
  const sim = createSim({ ...BALL, ink: { total: 50, par: 50 } });
  const st = sim.addStroke([[0, 100], [200, 100]]);
  assert.ok(st && Math.abs(st.len - 50) < 1e-6);
  assert.ok(sim.drain().some((e) => e.kind === 'notice'));
  assert.equal(sim.addStroke([[0, 120], [3, 120]]), null);
  assert.equal(sim.addStroke([[0, 130], [100, 130]]), null, 'бюджет исчерпан');
});

test('рой: без защиты банку съедают; с куполом — выдерживает атаку; события bite/lost', () => {
  const idle = runSolution(SWARM, [], 0);
  assert.ok(idle.lost && idle.reason === 'eaten');
  assert.ok(idle.sim.bites >= 1);
  const sol = runSolution(SWARM, SWARM.solution);
  assert.ok(sol.won, `победа на шаге ${sol.steps}`);
  assert.equal(sol.sim.bites, 0);
  assert.ok(sol.sim.insects.length >= 8, 'осы живы и летают');
  const s = createSim(SWARM);
  s.launch();
  for (let i = 0; i < 400 && s.phase === 'attack'; i++) s.step();
  const ev = s.drain();
  assert.ok(ev.some((e) => e.kind === 'bite') && ev.some((e) => e.kind === 'lost'));
});

test('повтор = живой прогон; детерминизм', () => {
  const live = createSim(SWARM);
  live.addStroke(SWARM.solution[0].pts, 0);
  for (let i = 0; i < 100; i++) live.step();
  live.launch();
  for (let i = 0; i < 500; i++) live.step();
  const rp = replay(SWARM, [{ t: 0, pts: SWARM.solution[0].pts }], 600, 100);
  assert.deepEqual(rp.snapshotPositions(), live.snapshotPositions());
  assert.equal(rp.phase, live.phase);
  assert.equal(rp.insects.length, live.insects.length);
  const a = runSolution(BALL, BALL.solution).sim.snapshotPositions();
  const b = runSolution(BALL, BALL.solution).sim.snapshotPositions();
  assert.deepEqual(a, b);
});

test('элементы: шар поднимает ящик, вентилятор сдувает, шипы убивают насекомых и лопают шар', () => {
  const lvl = {
    type: 'ball', seed: 5, ink: { total: 100, par: 100 }, autoStart: true,
    items: [
      { kind: 'block', x: 0, y: 500, w: 360, h: 20 },
      { kind: 'crate', x: 60, y: 480, w: 24, h: 24 },
      { kind: 'balloon', x: 60, y: 400, lift: 3, to: 1, len: 60 },
      { kind: 'ball', x: 300, y: 300 },
      { kind: 'goal', x: 180, y: 100 },
      { kind: 'fan', x: 240, y: 380, w: 120, h: 120, dir: [-1, 0], force: 1.5 },
      { kind: 'spikes', x: 100, y: 490, w: 40, dir: 'up' },
      { kind: 'nest', x: 120, y: 300, insect: 'beetle', count: 1 },
    ],
    solution: [],
  };
  const sim = createSim(lvl);
  const crate = sim.dynamics.find((b) => b.label === 'crate');
  const y0 = crate.position.y;
  const bx0 = sim.ball.position.x;
  for (let i = 0; i < 240; i++) sim.step();
  assert.ok(crate.position.y < y0 - 20, `шар поднял ящик: ${crate.position.y.toFixed(0)} < ${y0}`);
  assert.ok(sim.ball.position.x < bx0 - 20, 'ветер сдул шарик влево');
  const lvl2 = { ...lvl, items: [lvl.items[0], { kind: 'balloon', x: 120, y: 470, lift: 0.01 }, { kind: 'spikes', x: 100, y: 490, w: 40, dir: 'up' }, { kind: 'ball', x: 300, y: 300 }, { kind: 'goal', x: 180, y: 100 }] };
  const s2 = createSim(lvl2);
  for (let i = 0; i < 240; i++) s2.step();
  assert.equal(s2.balloons.length, 0, 'шар лопнул на шипах');
  assert.ok(s2.drain().some((e) => e.kind === 'pop'));
});

test('мир по размеру: W×H, шарик не вылетает за боковые стены', () => {
  assert.equal(W, 360);
  assert.equal(H, 520);
  const lvl = { type: 'ball', seed: 1, ink: { total: 10, par: 10 }, autoStart: true, items: [{ kind: 'block', x: 0, y: 500, w: 360, h: 20 }, { kind: 'ball', x: 20, y: 480 }, { kind: 'goal', x: 300, y: 100 }, { kind: 'fan', x: 0, y: 0, w: 360, h: 520, dir: [-1, 0], force: 2 }], solution: [] };
  const sim = createSim(lvl);
  for (let i = 0; i < 300; i++) sim.step();
  assert.ok(sim.ball.position.x > 0, `шарик у стены: ${sim.ball.position.x.toFixed(1)}`);
});

test('замороженный шарик засыпает в подготовке, но «Пуск» его будит', () => {
  const sim = createSim(BALL);
  for (let i = 0; i < 400; i++) sim.step();
  sim.addStroke(BALL.solution[0].pts);
  sim.launch();
  for (let i = 0; i < 1200 && sim.phase === 'play'; i++) sim.step();
  assert.equal(sim.phase, 'won');
});

test('повтор не теряет штрихи за пределом MAX_REPLAY_STEPS и не повторно упрощает их', () => {
  const sim = replay(BALL, [{ t: 0, pts: [[120, 292], [160, 296]] }, { t: 99999, pts: [[200, 300], [240, 304]] }], 50, null);
  assert.equal(sim.strokes.length, 2);
  const pts = [[10, 10], [10.5, 10.02], [11, 10.01], [30, 10]];
  const r = replay(BALL, [{ t: 0, pts }], 0, null);
  assert.deepEqual(r.strokes[0].pts, pts, 'точки снимка берутся как есть');
});

test('упавший в пропасть штрих убирается из мира, сим засыпает', () => {
  const lvl = { ...BALL, ink: { total: 260, par: 160 } };
  const sim = createSim(lvl);
  sim.addStroke([[160, 200], [200, 200]]);
  let i = 0;
  for (; i < 2400 && sim.alive; i++) sim.step();
  assert.equal(sim.strokes[0].gone, true);
  assert.equal(sim.alive, false, `сим уснул на шаге ${i}`);
});

test('нехватка чернил на короткий хвост — notice, а не тишина; повторы вершин в полигоне', () => {
  const sim = createSim({ ...BALL, ink: { total: 105, par: 100 } });
  assert.ok(sim.addStroke([[0, 100], [100, 100]]));
  sim.drain();
  assert.equal(sim.addStroke([[0, 130], [100, 130]]), null);
  assert.ok(sim.drain().some((e) => e.kind === 'notice'));
  assert.equal(triangulate([[0, 0], [10, 0], [10, 0], [10, 10], [0, 10], [0, 0]]).length, 2);
});
