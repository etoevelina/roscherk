// Перепроверка levels.json (§5.5): валидность решения, уникальность (если уровень помечен или
// должен быть уникальным), пересчёт difficulty. Любое расхождение — ошибка и код выхода 1.
//   node tools/verify.mjs [--modes zip,flow] [--in src/data/levels.json]
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { contentId } from '../src/core/hash.js';
import { decodeLevels } from '../src/core/levels.js';
import { stripService } from './generate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { modes: null, in: 'src/data/levels.json' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--modes') args.modes = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--modes=')) args.modes = a.slice(8).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--in') args.in = argv[++i];
    else if (a.startsWith('--in=')) args.in = a.slice(5);
  }
  return args;
}

async function loadMode(id) {
  const gen = await import(pathToFileURL(resolve(ROOT, `src/modes/${id}.gen.js`)).href);
  const solver = await import(pathToFileURL(resolve(ROOT, `src/modes/${id}.solve.js`)).href);
  return { id, gen, solver };
}

export async function verifyAll(data, modes, log = console.log) {
  const errors = [];
  let checked = 0;
  for (const id of modes) {
    const mode = await loadMode(id);
    const maxNodes = mode.gen.MAX_NODES ?? 2e6;
    const uniqueRequired = mode.gen.UNIQUE_REQUIRED !== false; // stroke: любой эйлеров путь — победа
    const sets = data[id] || {};
    for (const kind of ['campaign', 'pool', 'daily']) {
      const list = sets[kind] || [];
      let prevDifficulty = -Infinity;
      let prevChapter = null;
      for (let i = 0; i < list.length; i++) {
        const level = list[i];
        const where = `${id}/${kind}#${i + 1} (${level.id})`;
        checked++;
        const expectedId = contentId(stripService(level));
        if (level.id !== expectedId) errors.push(`${where}: id ${level.id} ≠ ${expectedId}`);
        const solution = mode.solver.solutionOf(level);
        if (!mode.solver.validate(level, solution)) errors.push(`${where}: эталонное решение невалидно`);
        const result = mode.solver.solve(level, { maxNodes, maxSolutions: 2 });
        const expectUnique = uniqueRequired && (level.unique === undefined ? true : level.unique === true);
        if (!uniqueRequired && level.unique !== undefined) errors.push(`${where}: поле unique не ожидается для этого режима`);
        if (result.complete) {
          if (result.solutions.length === 0) errors.push(`${where}: солвер не нашёл решений`);
          else if (expectUnique && result.solutions.length !== 1) errors.push(`${where}: решений ${result.solutions.length}, ожидалось 1`);
          if (result.difficulty !== level.difficulty) {
            errors.push(`${where}: difficulty ${level.difficulty} ≠ пересчитанной ${result.difficulty}`);
          }
        } else if (expectUnique) {
          errors.push(`${where}: солвер не завершился за ${maxNodes} узлов, уникальность не доказана`);
        } else if (!uniqueRequired) {
          errors.push(`${where}: солвер не завершился за ${maxNodes} узлов, difficulty не пересчитана`);
        }
        // Монотонность внутри главы (campaign и pool отсортированы по главам).
        if (kind !== 'daily') {
          if (level.chapter === prevChapter && level.difficulty < prevDifficulty) {
            errors.push(`${where}: difficulty убывает внутри главы ${level.chapter}`);
          }
          prevChapter = level.chapter;
          prevDifficulty = level.difficulty;
        }
      }
    }
    log(`${id}: проверено campaign ${sets.campaign?.length ?? 0}, pool ${sets.pool?.length ?? 0}, daily ${sets.daily?.length ?? 0}`);
  }
  return { checked, errors };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const path = resolve(ROOT, args.in);
  const data = decodeLevels(JSON.parse(readFileSync(path, 'utf8')));
  const modes = args.modes || Object.keys(data).filter((k) => k !== 'meta');
  const t0 = performance.now();
  const { checked, errors } = await verifyAll(data, modes);
  console.log(`Проверено уровней: ${checked} за ${Math.round(performance.now() - t0)} мс`);
  if (errors.length) {
    for (const e of errors) console.error('✗ ' + e);
    console.error(`Расхождений: ${errors.length}`);
    process.exit(1);
  }
  console.log('Расхождений нет');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
