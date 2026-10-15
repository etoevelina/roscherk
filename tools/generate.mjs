// Офлайн-генерация уровней (§5.5). Работает с любым режимом по контрактам §5.2–5.3:
//   node tools/generate.mjs [--modes zip,flow,stroke] [--seed 20260101] [--out src/data/levels.json] [--limit N]
// --limit N — не больше N уровней на каждый chapter-спек (быстрая проверка сквозного пути, не для релиза).
// Для каждого режима и набора (campaign/pool/daily) и каждого chapter-спека: генерирует кандидатов
// (seed = hash32(masterSeed, mode, kind, chapter, attempt)) для слота levelIndex = firstIndex + attempt % need,
// решает солвером, отбрасывает difficulty < minDifficulty, невалидные и неуникальные, набирает ≥ 2×
// нужного числа и раздаёт кандидатов по слотам так, чтобы difficulty не убывал, а соседние
// отличались ≤ 2×; если такого набора нет — генерирует ещё кандидатов (§2.0). Кандидат годится
// только в слот с тем же профилем кривой: профиль даёт gen.profile(spec, levelIndex) (стены с
// 15-го, стрелки с 25-го и т. п.); без этого экспорта все слоты спека взаимозаменяемы.
// Присваивает id (sha1 содержимого) и tip. Пишет levels.json и печатает статистику.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hash32 } from '../src/core/rng.js';
import { contentId } from '../src/core/hash.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MODES = ['zip', 'flow', 'stroke'];
const DEFAULT_SEED = 20260101;
const CANDIDATE_FACTOR = 2;
export const MAX_ATTEMPT_FACTOR = 60; // потолок попыток на спек: need × MAX_ATTEMPT_FACTOR
const MAX_RATIO = 2;
const SERVICE_FIELDS = ['id', 'seed', 'chapter', 'difficulty', 'tip', 'unique'];

function parseArgs(argv) {
  const args = { modes: DEFAULT_MODES, seed: DEFAULT_SEED, out: 'src/data/levels.json', quiet: false, limit: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--modes') args.modes = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--modes=')) args.modes = a.slice(8).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--seed') args.seed = Number(next()) >>> 0;
    else if (a.startsWith('--seed=')) args.seed = Number(a.slice(7)) >>> 0;
    else if (a === '--out') args.out = next();
    else if (a.startsWith('--out=')) args.out = a.slice(6);
    else if (a === '--limit') args.limit = Number(next()) | 0;
    else if (a.startsWith('--limit=')) args.limit = Number(a.slice(8)) | 0;
    else if (a === '--quiet') args.quiet = true;
  }
  return args;
}

/** Данные уровня без служебных полей — для id. */
export function stripService(level) {
  const out = {};
  for (const [k, v] of Object.entries(level)) if (!SERVICE_FIELDS.includes(k)) out[k] = v;
  return out;
}

/**
 * Seed кандидата номер attempt (с 0) для спека: hash(masterSeed, mode, kind, chapter, attempt) (§2.0).
 * Кандидат генерируется для слота firstIndex + attempt % need (см. generateSpec), поэтому по seed
 * уровня в levels.json восстанавливается слот, под который он сгенерирован (проверяется тестами).
 */
export function candidateSeed(masterSeed, modeId, kind, chapter, attempt) {
  return hash32(masterSeed, modeId, kind, chapter, attempt);
}

/** Соседние по сложности: отличие ≤ 2× (ноль считается равным нулю и единице). */
function ratioOk(a, b) {
  const lo = Math.max(1, Math.min(a, b));
  const hi = Math.max(1, Math.max(a, b));
  return hi <= lo * MAX_RATIO;
}

/**
 * Профиль слота кривой: gen.profile(spec, levelIndex) → строка/число, если генератор его экспортирует
 * (фичи, включаемые по номеру уровня); иначе '*' — все слоты спека взаимозаменяемы.
 */
export function slotProfile(gen, spec, levelIndex) {
  if (typeof gen.profile === 'function') return String(gen.profile(spec, levelIndex));
  return '*';
}

/**
 * assignSlots(slots, candidates, { relaxed }) → по одному кандидату на слот (в порядке слотов) или null.
 * slots — [{ levelIndex, profile }], candidates — [{ difficulty, seed, profile, … }].
 * В слот идёт только кандидат его профиля; difficulty по слотам не убывает, соседние отличаются
 * ≤ 2×. Жадно: для первого слота перебираются стартовые кандидаты от медианы его профиля
 * (чтобы не брать всегда самые лёгкие), дальше — самый лёгкий неиспользованный кандидат нужного
 * профиля, подходящий к предыдущему. relaxed — запасной режим после потолка попыток: берётся
 * ближайший по сложности, монотонность не гарантируется (вызывающий предупреждает).
 */
export function assignSlots(slots, candidates, { relaxed = false } = {}) {
  if (slots.length === 0) return [];
  const groups = new Map();
  for (const c of candidates) {
    if (!groups.has(c.profile)) groups.set(c.profile, []);
    groups.get(c.profile).push(c);
  }
  for (const list of groups.values()) list.sort((a, b) => a.difficulty - b.difficulty || a.seed - b.seed);
  const first = groups.get(slots[0].profile);
  if (!first) return null;

  const greedy = (startIdx, relax) => {
    const used = new Set();
    const out = [];
    let prev = 0;
    for (let i = 0; i < slots.length; i++) {
      const list = groups.get(slots[i].profile) || [];
      let pick = null;
      if (i === 0) pick = list[startIdx];
      else {
        pick = list.find((c) => !used.has(c) && c.difficulty >= prev && ratioOk(prev, c.difficulty)) || null;
        if (!pick && relax) {
          let bestDist = Infinity;
          for (const c of list) {
            if (used.has(c)) continue;
            const dist = Math.abs(c.difficulty - prev);
            if (dist < bestDist) {
              bestDist = dist;
              pick = c;
            }
          }
        }
      }
      if (!pick) return null;
      used.add(pick);
      out.push(pick);
      prev = pick.difficulty;
    }
    return out;
  };

  // Стартовые кандидаты — от центра группы первого слота (как центральное окно из need кандидатов).
  const firstSlots = slots.filter((s) => s.profile === slots[0].profile).length;
  const center = Math.max(0, (first.length - firstSlots) / 2);
  const starts = first.map((_, i) => i).sort((a, b) => Math.abs(a - center) - Math.abs(b - center) || a - b);
  for (const startIdx of starts) {
    const res = greedy(startIdx, false);
    if (res) return res;
  }
  return relaxed ? greedy(starts[0], true) : null;
}

async function loadMode(id) {
  const genUrl = pathToFileURL(resolve(ROOT, `src/modes/${id}.gen.js`)).href;
  const solveUrl = pathToFileURL(resolve(ROOT, `src/modes/${id}.solve.js`)).href;
  const [gen, solver] = await Promise.all([import(genUrl), import(solveUrl)]);
  for (const name of ['CHAPTERS', 'POOL', 'DAILY', 'generate', 'tipFor']) {
    if (!(name in gen)) throw new Error(`${id}.gen.js: нет экспорта ${name}`);
  }
  for (const name of ['solve', 'validate', 'solutionOf']) {
    if (typeof solver[name] !== 'function') throw new Error(`${id}.solve.js: нет экспорта ${name}`);
  }
  return { id, gen, solver };
}

/**
 * Один chapter-спек: need слотов levelIndex = firstIndex … firstIndex + need − 1; кандидаты
 * генерируются для слотов по кругу (attempt % need) и помечаются профилем своего слота.
 */
function generateSpec(mode, kind, spec, need, firstIndex, masterSeed, log, seen) {
  const { gen, solver } = mode;
  const maxNodes = gen.MAX_NODES ?? 2e6;
  // Политика уникальности режима (§2.0, §2.2–2.4): по умолчанию обязательна (zip); allowNonUnique(spec) —
  // best effort с полем unique (flow 9×9); UNIQUE_REQUIRED = false — не требуется и не пишется (stroke).
  const uniqueRequired = gen.UNIQUE_REQUIRED !== false;
  const allowNonUnique = uniqueRequired && typeof gen.allowNonUnique === 'function' ? gen.allowNonUnique : null;
  const maxAttempts = need * MAX_ATTEMPT_FACTOR;
  const slots = Array.from({ length: need }, (_, i) => ({
    levelIndex: firstIndex + i,
    profile: slotProfile(gen, spec, firstIndex + i),
  }));
  const candidates = [];
  const localSeen = new Set();
  let attempts = 0;
  const rejected = { null: 0, invalid: 0, easy: 0, dup: 0, nonUnique: 0, incomplete: 0 };

  /** Одна затравка для очередного слота; кандидат добавляется в candidates, отказ — в rejected. */
  function tryOne() {
    const attempt = attempts++;
    const slot = slots[attempt % need];
    const seed = candidateSeed(masterSeed, mode.id, kind, spec.chapter, attempt);
    const data = gen.generate(seed, spec, slot.levelIndex);
    if (!data) {
      rejected.null++;
      return;
    }
    const id = contentId(stripService(data));
    // Дубликаты не допускаются ни внутри спека, ни между наборами режима (прогресс хранится по id).
    if (localSeen.has(id) || seen.has(id)) {
      rejected.dup++;
      return;
    }
    const solution = solver.solutionOf(data);
    if (!solver.validate(data, solution)) {
      rejected.invalid++;
      return;
    }
    const result = solver.solve(data, { maxNodes, maxSolutions: 2 });
    let unique;
    if (!uniqueRequired) {
      // Решений может быть много (stroke); нужен хотя бы эталон и полный пересчёт difficulty.
      if (!result.complete || result.solutions.length === 0) {
        rejected.incomplete++;
        return;
      }
    } else if (result.complete) {
      if (result.solutions.length !== 1) {
        if (!(allowNonUnique && allowNonUnique(spec))) {
          rejected.nonUnique++;
          return;
        }
        unique = false;
      } else unique = true;
    } else if (allowNonUnique && allowNonUnique(spec)) {
      unique = false;
    } else {
      rejected.incomplete++;
      return;
    }
    if (result.difficulty < (spec.minDifficulty ?? 0)) {
      rejected.easy++;
      return;
    }
    localSeen.add(id);
    // Служебные поля — первыми; unique генератора (flow) перекрывается результатом солвера.
    const level = { id, seed, chapter: spec.chapter, difficulty: result.difficulty, ...data };
    if (allowNonUnique) level.unique = unique;
    else delete level.unique;
    candidates.push({ level, difficulty: result.difficulty, seed, profile: slot.profile });
  }

  // ≥ 2× кандидатов, раздача по слотам; нет подходящего набора — ещё need кандидатов, и так до потолка.
  let target = need * CANDIDATE_FACTOR;
  let chosen = null;
  for (;;) {
    while (candidates.length < target && attempts < maxAttempts) tryOne();
    chosen = assignSlots(slots, candidates);
    if (chosen || attempts >= maxAttempts) break;
    target = candidates.length + need;
  }
  if (!chosen) {
    chosen = assignSlots(slots, candidates, { relaxed: true });
    if (!chosen) {
      throw new Error(
        `${mode.id}/${kind}/глава ${spec.chapter}: не набрано кандидатов на все слоты за ${attempts} попыток ` +
          `(кандидатов ${candidates.length} из ${need}, отказы: ${JSON.stringify(rejected)})`,
      );
    }
    log(`  ! ${mode.id}/${kind}/глава ${spec.chapter}: за ${attempts} попыток нет набора с неубывающей difficulty и соседями ≤ 2×, взят ближайший`);
  }
  const levels = chosen.map((c) => c.level);
  for (const level of levels) seen.add(level.id);
  return { levels, attempts, rejected, candidates: candidates.length };
}

function assignTips(mode, kind, levels) {
  if (kind !== 'campaign') return;
  for (let i = 0; i < levels.length; i++) {
    const tip = mode.gen.tipFor(levels[i], i + 1, levels.slice(0, i));
    if (tip) levels[i].tip = tip;
  }
}

export async function generateAll({ modes, seed: masterSeed, limit = 0, log = console.log }) {
  const cap = (need) => (limit > 0 ? Math.min(need, limit) : need);
  const started = performance.now();
  const version = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version;
  const out = { meta: { masterSeed, generatedAt: new Date().toISOString(), version } };
  const stats = [];

  for (const id of modes) {
    const mode = await loadMode(id);
    if (typeof mode.gen.profile !== 'function') {
      log(`  ! ${id}.gen.js не экспортирует profile(spec, levelIndex): слоты главы считаются взаимозаменяемыми`);
    }
    const sets = { campaign: [], pool: [], daily: [] };
    const seen = new Set(); // id уже выбранных уровней режима (все наборы)
    const plan = [
      ...mode.gen.CHAPTERS.map((spec) => ({ kind: 'campaign', spec, need: cap(spec.to - spec.from + 1), firstIndex: spec.from })),
      ...mode.gen.POOL.map((spec) => ({ kind: 'pool', spec, need: cap(spec.count), firstIndex: 1 })),
      { kind: 'daily', spec: mode.gen.DAILY, need: cap(mode.gen.DAILY.count), firstIndex: 1 },
    ];
    for (const { kind, spec, need, firstIndex } of plan) {
      const t0 = performance.now();
      const res = generateSpec(mode, kind, spec, need, firstIndex, masterSeed, log, seen);
      sets[kind].push(...res.levels);
      const diffs = res.levels.map((l) => l.difficulty);
      stats.push({
        mode: id,
        kind,
        chapter: spec.chapter,
        levels: res.levels.length,
        attempts: res.attempts,
        candidates: res.candidates,
        difficulty: `${Math.min(...diffs)}…${Math.max(...diffs)}`,
        ms: Math.round(performance.now() - t0),
      });
    }
    assignTips(mode, 'campaign', sets.campaign);
    out[id] = sets;
  }

  out.meta.elapsedMs = Math.round(performance.now() - started);
  return { data: out, stats };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = args.quiet ? () => {} : console.log;
  log(`Генерация: режимы ${args.modes.join(', ')}, masterSeed ${args.seed}`);
  if (args.limit > 0) log(`  ! --limit ${args.limit}: усечённый набор, не для релиза`);
  const { data, stats } = await generateAll({ modes: args.modes, seed: args.seed, limit: args.limit, log });
  const outPath = resolve(ROOT, args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  const json = JSON.stringify(data);
  writeFileSync(outPath, json);
  if (!args.quiet) {
    console.table(stats);
    for (const id of args.modes) {
      const s = data[id];
      log(`${id}: campaign ${s.campaign.length}, pool ${s.pool.length}, daily ${s.daily.length}`);
    }
    log(`Записано ${outPath}: ${(json.length / 1024).toFixed(1)} КБ за ${data.meta.elapsedMs} мс`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
