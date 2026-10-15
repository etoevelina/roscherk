// Растеризация иконок (§4.6): assets/icon.svg → dist/icon-180.png и dist/icon-512.png.
// Основной путь — qlmanage -t -s 1024 + sips (macOS); запасной — Pillow (python3), рисующий ту же
// композицию примитивами (фон + толстая линия), если qlmanage недоступен.
//   node tools/icon.mjs [--out dist]
import { existsSync, mkdirSync, copyFileSync, rmSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SVG = resolve(ROOT, 'assets/icon.svg');
export const SIZES = [180, 512];

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return r.status === 0;
}

function viaQuickLook(outDir) {
  if (!run('which', ['qlmanage']) || !run('which', ['sips'])) return false;
  const tmp = join(tmpdir(), `roscherk-icon-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  if (!run('qlmanage', ['-t', '-s', '1024', '-o', tmp, SVG])) return false;
  const produced = readdirSync(tmp).find((f) => f.endsWith('.png'));
  if (!produced) return false;
  const big = join(tmp, produced);
  for (const size of SIZES) {
    const out = resolve(outDir, `icon-${size}.png`);
    copyFileSync(big, out);
    // sips: сначала размер, затем убираем альфу (iOS требует непрозрачную иконку).
    if (!run('sips', ['-z', String(size), String(size), out])) return false;
    run('sips', ['-s', 'format', 'png', '-s', 'formatOptions', 'default', out]);
  }
  rmSync(tmp, { recursive: true, force: true });
  return true;
}

function viaPillow(outDir) {
  const script = `
import sys
try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit(3)
out_dir = sys.argv[1]
S = 1024
img = Image.new('RGB', (S, S), (15, 17, 23))
d = ImageDraw.Draw(img)
# Полилиния-росчерк, близкая к кривой из assets/icon.svg
pts = [(160,700),(200,470),(330,380),(400,420),(400,540),(330,650),(400,720),(500,740),(580,600),(560,420),(620,320),(760,320),(850,420),(820,600),(740,620),(760,500),(850,560),(864,620)]
for w, col in ((72, (37, 62, 110)), (44, (79, 140, 255))):
    d.line(pts, fill=col, width=w, joint='curve')
    for (x, y) in (pts[0], pts[-1]):
        d.ellipse((x-w/2, y-w/2, x+w/2, y+w/2), fill=col)
d.ellipse((120, 660, 200, 740), fill=(242, 244, 248))
for size in (${SIZES.join(', ')}):
    img.resize((size, size), Image.LANCZOS).save(f'{out_dir}/icon-{size}.png')
`;
  const r = spawnSync('python3', ['-I', '-c', script, outDir], { encoding: 'utf8' });
  return r.status === 0;
}

/** rasterizeIcons(outDir) → 'qlmanage' | 'pillow'; бросает, если оба пути недоступны. */
export function rasterizeIcons(outDir = resolve(ROOT, 'dist')) {
  if (!existsSync(SVG)) throw new Error(`нет ${SVG}`);
  mkdirSync(outDir, { recursive: true });
  if (viaQuickLook(outDir)) return 'qlmanage';
  if (viaPillow(outDir)) return 'pillow';
  throw new Error('не удалось растеризовать иконку: нет ни qlmanage+sips, ни Pillow');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const outDir = resolve(ROOT, i >= 0 ? process.argv[i + 1] : 'dist');
  const how = rasterizeIcons(outDir);
  console.log(`Иконки записаны в ${outDir} (${how})`);
}
