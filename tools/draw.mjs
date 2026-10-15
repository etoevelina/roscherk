// Сборка и проверка уровней «Карандаша» (§2.6): tools/draw/levels/*.json → src/data/draw.json.
//   node tools/draw.mjs [--out src/data/draw.json] [--only 12] [--quiet]
// Для каждого уровня в Node: (1) эталон побеждает не позже limit; (2) без штрихов победы нет;
// (3) эталон укладывается в чернила, par достижим; (4) два прогона совпадают. Любое расхождение —
// ошибка и код выхода 1. Сборщик дописывает id, chapter, difficulty и порядок (по номеру файла).
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as simApi from '../src/modes/draw.sim.js';

const { runSolution, strokeLength, simplifyStroke, W, H, STEPS_PER_SEC } = simApi;
import { contentId } from '../src/core/hash.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const LEVELS_DIR = resolve(ROOT, 'tools/draw/levels');
export const CHAPTERS = [
  { chapter: 1, from: 1, to: 8, ru: 'Разминка' },
  { chapter: 2, from: 9, to: 24, ru: 'Шарик' },
  { chapter: 3, from: 25, to: 44, ru: 'Рой' },
  { chapter: 4, from: 45, to: 60, ru: 'Буря' },
];
export const LEVELS_TOTAL = 60;
const SERVICE = ['id', 'chapter', 'difficulty', 'n', 'file'];
// В id не входят текстовые и сервисные поля: tip/hint/limit можно править после релиза, не теряя прогресс.
export const ID_EXCLUDED = [...SERVICE, 'tip', 'hint', 'limit'];
export const forId = (level) => Object.fromEntries(Object.entries(level).filter(([k]) => !ID_EXCLUDED.includes(k)));
export const HUMAN_SHIFT = simApi.HUMAN_DELAY;
const KINDS = new Set(['ground', 'block', 'ball', 'goal', 'jar', 'nest', 'balloon', 'crate', 'plank', 'seesaw', 'fan', 'spikes']);

export function chapterOf(n) {
  const c = CHAPTERS.find((ch) => n >= ch.from && n <= ch.to);
  return c ? c.chapter : CHAPTERS[CHAPTERS.length - 1].chapter;
}

function stripService(level) {
  const out = {};
  for (const [k, v] of Object.entries(level)) if (!SERVICE.includes(k)) out[k] = v;
  return out;
}

/** Статическая проверка формата (без симуляции). */
export function checkLevelFormat(level, where = 'level') {
  const errors = [];
  const err = (m) => errors.push(`${where}: ${m}`);
  if (!level || typeof level !== 'object') return [`${where}: не объект`];
  if (!['ball', 'swarm'].includes(level.type)) err(`type должен быть ball|swarm`);
  if (!Array.isArray(level.items) || !level.items.length) err('нет items');
  if (!level.ink || !(Number(level.ink.total) > 0)) err('нет ink.total');
  if (!(Number(level.ink?.par) > 0)) err('нет ink.par');
  if (Number(level.ink?.par) > Number(level.ink?.total)) err('ink.par больше ink.total');
  if (!Array.isArray(level.solution) || !level.solution.length) err('нет solution');
  if (!Number.isInteger(level.seed)) err('seed — целое');
  const items = Array.isArray(level.items) ? level.items : [];
  const has = (k) => items.some((it) => it.kind === k);
  items.forEach((it, i) => {
    if (!KINDS.has(it.kind)) err(`items[${i}]: неизвестный kind ${it.kind}`);
    const num = (f) => Number.isFinite(Number(it[f]));
    if (it.kind === 'ground') {
      if (!Array.isArray(it.poly) || it.poly.length < 3) err(`items[${i}] ground: poly ≥ 3 точек`);
      else {
        for (const p of it.poly) if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) err(`items[${i}] ground: точка ${JSON.stringify(p)}`);
        // Триангуляция должна покрыть весь полигон (иначе часть земли «дырявая», а рисуется целой).
        const tris = simApi.triangulate(it.poly);
        const triArea = tris.reduce((s, [a, b, c]) => s + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2, 0);
        const polyArea = Math.abs(it.poly.reduce((s, [x, y], k) => s + x * it.poly[(k + 1) % it.poly.length][1] - it.poly[(k + 1) % it.poly.length][0] * y, 0)) / 2;
        if (polyArea < 1) err(`items[${i}] ground: вырожденный полигон`);
        else if (Math.abs(triArea - polyArea) > polyArea * 0.01 + 1) err(`items[${i}] ground: полигон самопересекается или вырожден (триангуляция покрывает ${Math.round(triArea)} из ${Math.round(polyArea)})`);
      }
    } else if (!num('x') || !num('y')) err(`items[${i}] ${it.kind}: нет x/y`);
    if (it.kind === 'nest') {
      if (!(Number.isInteger(it.count) && it.count >= 1)) err(`items[${i}] nest: count — целое ≥ 1`);
      if (it.every !== undefined && !(Number(it.every) > 0)) err(`items[${i}] nest: every > 0`);
      if (it.delay !== undefined && !(Number(it.delay) >= 0)) err(`items[${i}] nest: delay ≥ 0`);
    }
    if (['block', 'crate', 'fan'].includes(it.kind) && (!num('w') || !num('h'))) err(`items[${i}] ${it.kind}: нет w/h`);
    if (it.kind === 'nest' && !['wasp', 'beetle', undefined].includes(it.insect)) err(`items[${i}] nest: insect wasp|beetle`);
    if (it.kind === 'balloon' && it.to !== undefined && !(Number.isInteger(it.to) && it.to >= 0 && it.to < items.length && it.to !== i)) err(`items[${i}] balloon: to — индекс другого элемента`);
    if (it.kind === 'spikes' && !num('w')) err(`items[${i}] spikes: нет w`);
    if (it.kind !== 'ground') {
      for (const f of ['x', 'y']) if (num(f) && (it[f] < -50 || it[f] > (f === 'x' ? W : H) + 50)) err(`items[${i}] ${it.kind}: ${f}=${it[f]} вне мира`);
    }
  });
  if (level.type === 'ball') {
    if (!has('ball')) err('ball: нет шарика');
    if (!has('goal')) err('ball: нет цели');
  } else {
    if (!has('jar')) err('swarm: нет банки');
    if (!has('nest')) err('swarm: нет гнезда');
    if (!(Number(level.time) > 0)) err('swarm: нет time (секунды атаки)');
  }
  let prevT = -Infinity;
  (level.solution || []).forEach((s, i) => {
    if (!s || !Array.isArray(s.pts) || s.pts.length < 2) err(`solution[${i}]: pts ≥ 2 точек`);
    if (s.t !== undefined && !(Number.isInteger(s.t) && s.t >= 0)) err(`solution[${i}]: t — шаг ≥ 0`);
    const t = s && Number.isInteger(s.t) ? s.t : 0;
    // На уровнях без подготовки (autoStart) человек не рисует мгновенно: первый штрих ≥ 0,5 с, между штрихами ≥ 0,75 с.
    if (level.autoStart === true) {
      if (t < 60) err(`solution[${i}]: на autoStart первый штрих не раньше шага 60 (0,5 с)`);
      if (prevT > -Infinity && t - prevT < 90) err(`solution[${i}]: между штрихами на autoStart ≥ 90 шагов`);
    }
    prevT = Math.max(prevT, t);
  });
  if (level.launch !== undefined && !(Number.isInteger(level.launch) && level.launch >= 0)) err('launch — шаг ≥ 0');
  if (level.tip && typeof level.tip.ru !== 'string') err('tip.ru — строка');
  return errors;
}

/** verifyLevel(level) → { errors: [], info } — симуляция эталона, бездействия, детерминизм. */
export function verifyLevel(level, where = 'level') {
  const errors = checkLevelFormat(level, where);
  if (errors.length) return { errors, info: null };
  const limit = Math.round((Number(level.limit) > 0 ? Number(level.limit) : 60) * STEPS_PER_SEC);
  const launch = Number.isInteger(level.launch) ? level.launch : null;
  // Эталон — в темпе человека: «Пуск» через секунду после последнего штриха, когда всё улеглось.
  const sol = runSolution(level, level.solution, launch, limit);
  // Тот же эталон на секунду позже (все штрихи и «Пуск» сдвинуты): решение не должно зависеть от точного шага.
  const shifted = runSolution(level, level.solution, launch, limit + HUMAN_SHIFT, { shift: HUMAN_SHIFT });
  // Бездействие — с запасом: на 25 % дольше (другой JS-движок на телефоне может чуть разойтись с Node).
  const slack = level.type === 'swarm' ? { ...level, time: Number(level.time) * 1.25 } : level;
  const idle = runSolution(slack, [], 0, Math.round(limit * 1.25));
  const solLen = level.solution.reduce((a, s) => a + strokeLength(simplifyStroke(s.pts)), 0);
  if (!sol.won) errors.push(`${where}: эталон не побеждает (${sol.lost ? `проигрыш: ${sol.reason}` : 'лимит времени'} на шаге ${sol.steps}; «Пуск» на шаге ${sol.launchedAt})`);
  else if (sol.steps > limit - 5 * STEPS_PER_SEC) errors.push(`${where}: эталон побеждает впритык к лимиту (шаг ${sol.steps} из ${limit}) — увеличь limit или ускорь решение`);
  if (!shifted.won) errors.push(`${where}: эталон, сдвинутый на 1 с, не побеждает (${shifted.lost ? `проигрыш: ${shifted.reason}` : 'лимит'} на шаге ${shifted.steps}) — решение хрупкое по времени`);
  if (!sol.inkOk) errors.push(`${where}: штрихи эталона обрезаются чернилами (длина ${solLen.toFixed(0)} > ink.total ${level.ink.total})`);
  if (idle.won) errors.push(`${where}: уровень решается бездействием (победа без штрихов на шаге ${idle.steps})`);
  if (level.type === 'swarm' && !idle.lost) errors.push(`${where}: без защиты рой не добирается до банки — атака слишком слабая`);
  if (level.ink.par < solLen * 0.8) errors.push(`${where}: ink.par ${level.ink.par} < 80 % длины эталона ${solLen.toFixed(0)} — звезда недостижима`);
  const again = runSolution(level, level.solution, launch, limit);
  if (JSON.stringify(again.sim.snapshotPositions()) !== JSON.stringify(sol.sim.snapshotPositions())) errors.push(`${where}: прогон не детерминирован`);
  return {
    errors,
    info: { steps: sol.steps, seconds: Math.round(sol.steps / STEPS_PER_SEC), ink: Math.round(sol.inkUsed), inkTotal: level.ink.total, strokes: level.solution.length, idle: idle.lost ? `проигрыш (${idle.reason})` : 'без победы' },
  };
}

export function difficultyOf(level, info) {
  return Math.round(level.solution.length * 10 + (10 * (info?.ink ?? 0)) / level.ink.total);
}

export function loadLevelFiles(dir = LEVELS_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{2}-.+\.json$/.test(f))
    .sort()
    .map((f) => ({ file: f, n: Number(f.slice(0, 2)), level: JSON.parse(readFileSync(resolve(dir, f), 'utf8')) }));
}

export function buildDraw(files, { log = console.log, version = '0.0.0', checkOrder = true } = {}) {
  const campaign = [];
  const errors = [];
  const stats = [];
  const seen = new Set();
  for (const { file, n, level } of files) {
    const where = file;
    if (seen.has(n)) errors.push(`${where}: номер ${n} повторяется`);
    seen.add(n);
    const { errors: errs, info } = verifyLevel(level, where);
    errors.push(...errs);
    if (errs.length) continue;
    const out = { id: '', chapter: chapterOf(n), difficulty: difficultyOf(level, info), ...stripService(level) };
    out.id = contentId(forId(out));
    campaign.push({ n, level: out });
    stats.push({ file, chapter: out.chapter, type: level.type, strokes: info.strokes, ink: `${info.ink}/${info.inkTotal}`, sec: info.seconds, idle: info.idle });
  }
  campaign.sort((a, b) => a.n - b.n);
  if (checkOrder) {
    for (let i = 1; i < campaign.length; i++) if (campaign[i].n !== campaign[i - 1].n + 1) errors.push(`пропуск номера между ${campaign[i - 1].n} и ${campaign[i].n}`);
    if (campaign.length && campaign[0].n !== 1) errors.push('нумерация должна начинаться с 01');
  }
  const data = { meta: { generatedAt: new Date().toISOString(), version, levels: campaign.length }, draw: { campaign: campaign.map((c) => c.level) } };
  return { data, errors, stats };
}

/**
 * trace(level) → строки: положение шарика/банки, число насекомых, фаза — каждые 0,5 с прогона
 * эталона (помощь автору уровня: --trace N).
 */
export function traceLevel(level, log = console.log) {
  const launch = Number.isInteger(level.launch) ? level.launch : null;
  const limit = Math.round((Number(level.limit) > 0 ? Number(level.limit) : 60) * STEPS_PER_SEC);
  const { createSim } = simApi;
  const sim = createSim(level);
  const list = level.solution.map((s) => ({ t: s.t | 0, pts: s.pts })).sort((a, b) => a.t - b.t);
  let k = 0;
  let lastAt = -1;
  for (let i = 0; i < limit; i++) {
    while (k < list.length && list[k].t <= i) {
      const st = sim.addStroke(list[k].pts, i);
      log(`шаг ${i}: штрих ${k} ${st ? `ок, длина ${st.len.toFixed(0)}` : 'ОТБРОШЕН'}`);
      lastAt = i;
      k++;
    }
    if (launch !== null && launch === i) sim.launch();
    if (launch === null && k >= list.length && sim.phase === 'prep') {
      const since = i - lastAt;
      if (since >= simApi.HUMAN_DELAY && (!sim.alive || since >= simApi.SETTLE_CAP)) {
        sim.launch();
        log(`шаг ${i}: Пуск`);
      }
    }
    sim.step();
    if (i % 60 === 0 || sim.phase === 'won' || sim.phase === 'lost') {
      const b = sim.ball ? `шарик (${sim.ball.position.x.toFixed(0)}, ${sim.ball.position.y.toFixed(0)}) v=${Math.hypot(sim.ball.velocity.x, sim.ball.velocity.y).toFixed(2)}${sim.ball.isSleeping ? ' спит' : ''}` : '';
      const j = sim.jar ? `банка hp ${sim.jarHp}` : '';
      log(`${(i / STEPS_PER_SEC).toFixed(1)} с  ${sim.phase}  ${b} ${j} насекомых ${sim.insects.length} чернил ${sim.inkUsed.toFixed(0)}`);
    }
    if (sim.phase === 'won' || sim.phase === 'lost') break;
  }
  return sim;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--trace')) {
    const n = Number(args[args.indexOf('--trace') + 1]);
    const f = loadLevelFiles().find((x) => x.n === n);
    if (!f) {
      console.error(`нет уровня ${n}`);
      process.exit(1);
    }
    const errs = checkLevelFormat(f.level, f.file);
    for (const e of errs) console.error(`✗ ${e}`);
    if (errs.length) process.exit(1);
    traceLevel(f.level);
    return;
  }
  const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'src/data/draw.json';
  const only = args.includes('--only') ? Number(args[args.indexOf('--only') + 1]) : 0;
  const quiet = args.includes('--quiet');
  let files = loadLevelFiles();
  if (only) files = files.filter((f) => f.n === only);
  const version = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version;
  const t0 = performance.now();
  const { data, errors, stats } = buildDraw(files, { version, checkOrder: !only });
  if (!quiet) console.table(stats);
  if (errors.length) {
    for (const e of errors) console.error(`✗ ${e}`);
    console.error(`Ошибок: ${errors.length}`);
    process.exit(1);
  }
  if (only) {
    console.log(`Уровень ${only}: ок (${Math.round(performance.now() - t0)} мс)`);
    return;
  }
  const outPath = resolve(ROOT, out);
  mkdirSync(dirname(outPath), { recursive: true });
  const json = JSON.stringify(data);
  writeFileSync(outPath, json);
  console.log(`Уровней: ${data.draw.campaign.length} из ${LEVELS_TOTAL}; записано ${outPath}: ${(json.length / 1024).toFixed(1)} КБ за ${Math.round(performance.now() - t0)} мс`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
