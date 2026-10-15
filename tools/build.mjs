// Сборка (§4.7): esbuild → один dist/index.html (CSS и бандл инлайн, levels.json в отдельном
// <script type="application/json" id="levels">), плюс sw.js, manifest.webmanifest и иконки.
// contentHash — sha1 всего содержимого поставки (бандл, CSS, уровни, шаблон index.html, sw.js,
// манифест, иконки): любое изменение релиза меняет имя кэша SW (§4.6), а не только правка JS.
// Иконки входят в PRECACHE sw.js, поэтому их источник (assets/icon.svg, иначе готовые
// dist/icon-*.png) тоже учитывается — иначе новая иконка не доехала бы до установленного PWA.
// Подставляется в sw.js, в бандл (версия в настройках) и в index.html.
// Проверки: dist/index.html ≤ 1 МБ; levels.json ≤ 400 КБ (иначе компактное кодирование путей).
//   node tools/build.mjs [--no-icons] [--native]
// --native — сборка для оболочки Capacitor (App Store): подключает src/native.js (плагины Haptics,
// StatusBar, SplashScreen), без Service Worker и манифеста она не нуждается, но они не мешают.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import esbuild from 'esbuild';
import { compactLevels } from '../src/core/levels.js';
import { rasterizeIcons, SIZES as ICON_SIZES } from './icon.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const HTML_LIMIT = 1024 * 1024;
const LEVELS_LIMIT = 400 * 1024;
const WORDS_LIMIT = 350 * 1024; // уровни «Слов» (§2.5) — отдельный <script id="words">
const DRAW_LIMIT = 250 * 1024; // уровни «Карандаша» (§2.6) — отдельный <script id="draw">
const HASH_PLACEHOLDER = '__CONTENT_HASH__';

const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

/**
 * 3D-графика дизайн-системы WORDS (docs/DESIGN.md): assets/art/*.webp → dist/art/ и прекэш SW.
 * Отдельными файлами, а не data URI: иначе index.html вышел бы за 1 МБ.
 */
export function artFiles() {
  const dir = resolve(ROOT, 'assets/art');
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.webp')).sort() : [];
}

/** CSS: оболочка, Lumin и стили экранов WORDS из src/styles/*.css (по имени: 00-tokens, 05-kit, …). */
export function cssSources() {
  const dir = resolve(ROOT, 'src/styles');
  const parts = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.css')).sort() : [];
  return parts.map((f) => `src/styles/${f}`);
}
const kb = (n) => `${(n / 1024).toFixed(1)} КБ`;

/** Безопасная вставка в HTML: закрывающий тег скрипта не должен встречаться внутри содержимого. */
function inlineSafe(text) {
  return text.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

/**
 * JSON внутри <script type="application/json">: «<» → \u003c. Это валидный JSON-экранированный
 * символ (JSON.parse вернёт «<»), и он исключает и </script, и <!-- — в отличие от inlineSafe,
 * чьё «<\!--» — недопустимая escape-последовательность JSON.
 */
export function jsonInlineSafe(json) {
  return json.replace(/</g, '\\u003c');
}

function fill(template, vars) {
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.split(k).join(v);
  return out;
}

/**
 * contentHashOf(parts) → 12 hex: sha1 по всем частям поставки (до подстановки хэша). Части
 * хэшируются с именем и длиной, чтобы перенос байтов между частями тоже менял хэш.
 */
export function contentHashOf(parts) {
  const hash = createHash('sha1');
  for (const name of Object.keys(parts).sort()) {
    const text = String(parts[name] ?? '');
    hash.update(`${name}:${Buffer.byteLength(text)}\n`, 'utf8');
    hash.update(text, 'utf8');
  }
  return hash.digest('hex').slice(0, 12);
}

/**
 * iconPartOf({ svg, pngs }) → строка для contentHashOf: исходник assets/icon.svg, если он есть,
 * иначе байты готовых dist/icon-*.png (base64, в порядке имён); без иконок — ''.
 */
export function iconPartOf({ svg = null, pngs = [] } = {}) {
  if (typeof svg === 'string' && svg.length > 0) return `svg\n${svg}`;
  const list = (pngs || []).filter((p) => p && p.data && p.data.length > 0);
  if (list.length === 0) return '';
  return list
    .slice()
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((p) => `${p.name}:${Buffer.from(p.data).toString('base64')}`)
    .join('\n');
}

/** Источник иконок для хэша: assets/icon.png (мастер), assets/icon.svg, иначе dist/icon-*.png. */
function readIconPart() {
  const pngPath = resolve(ROOT, 'assets/icon.png');
  if (existsSync(pngPath)) return { part: `png\n${readFileSync(pngPath).toString('base64')}`, how: 'assets/icon.png' };
  const svgPath = resolve(ROOT, 'assets/icon.svg');
  if (existsSync(svgPath)) return { part: iconPartOf({ svg: readFileSync(svgPath, 'utf8') }), how: 'assets/icon.svg' };
  const pngs = ICON_SIZES.map((size) => `icon-${size}.png`)
    .filter((name) => existsSync(resolve(DIST, name)))
    .map((name) => ({ name, data: readFileSync(resolve(DIST, name)) }));
  return { part: iconPartOf({ pngs }), how: pngs.length ? `dist/${pngs.map((p) => p.name).join(', dist/')}` : 'нет' };
}

/**
 * luminAssets(css) → css с подставленными формами Lumin: __LUMIN_SAGE_FORM__ → "data:image/svg+xml,…"
 * из assets/lumin/sage-form.svg (имя — нижний регистр, «_» → «-»). Нет файла — ошибка сборки.
 */
export function luminAssets(css) {
  return css.replace(/__LUMIN_([A-Z_]+)__/g, (_, name) => {
    const file = resolve(ROOT, 'assets/lumin', `${name.toLowerCase().replace(/_/g, '-')}.svg`);
    if (!existsSync(file)) throw new Error(`нет ${file} для __LUMIN_${name}__`);
    const svg = readFileSync(file, 'utf8').trim().replace(/\s+/g, ' ');
    return `"data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}"`;
  });
}

export async function build({ icons = true, native = false, log = console.log } = {}) {
  const t0 = performance.now();
  mkdirSync(DIST, { recursive: true });

  const levelsPath = resolve(ROOT, 'src/data/levels.json');
  if (!existsSync(levelsPath)) throw new Error('нет src/data/levels.json — сначала npm run gen');

  // Бандл.
  const bundle = await esbuild.build({
    entryPoints: [resolve(ROOT, 'src/main.js')],
    bundle: true,
    // Нативный модуль — только в сборке --native; в вебе импорт указывает на пустую заглушку.
    alias: { __NATIVE_MODULE__: resolve(ROOT, native ? 'src/native.js' : 'src/native-web.js') },
    write: false,
    format: 'iife',
    target: ['safari15'],
    minify: true,
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'warning',
  });
  const jsRaw = bundle.outputFiles[0].text;

  // CSS: оболочка + стили «Слов» по Lumin (§2.5); формы assets/lumin/*.svg — data:image/svg+xml.
  const cssSource = [read('src/styles.css'), luminAssets(read('src/styles.lumin.css')), ...cssSources().map(read)].join('\n');
  const css = (await esbuild.transform(cssSource, { loader: 'css', minify: true, target: ['safari15'] })).code;

  // Уровни: компактное кодирование при превышении лимита.
  let levelsJson = readFileSync(levelsPath, 'utf8');
  let levelsData = JSON.parse(levelsJson);
  levelsJson = JSON.stringify(levelsData);
  let compact = false;
  if (Buffer.byteLength(levelsJson) > LEVELS_LIMIT) {
    levelsData = compactLevels(levelsData);
    levelsJson = JSON.stringify(levelsData);
    compact = true;
    if (Buffer.byteLength(levelsJson) > LEVELS_LIMIT) {
      throw new Error(`levels.json ${kb(Buffer.byteLength(levelsJson))} > 400 КБ даже после компактного кодирования`);
    }
  }

  // Уровни «Слов» (§2.5): src/data/words.json, если собран (npm run words); иначе пусто.
  const wordsPath = resolve(ROOT, 'src/data/words.json');
  const wordsJson = existsSync(wordsPath) ? JSON.stringify(JSON.parse(readFileSync(wordsPath, 'utf8'))) : '{}';
  if (Buffer.byteLength(wordsJson) > WORDS_LIMIT) throw new Error(`words.json ${kb(Buffer.byteLength(wordsJson))} > 350 КБ`);

  // Уровни «Карандаша» (§2.6): src/data/draw.json, если собран (npm run draw); иначе пусто.
  const drawPath = resolve(ROOT, 'src/data/draw.json');
  const drawJson = existsSync(drawPath) ? JSON.stringify(JSON.parse(readFileSync(drawPath, 'utf8'))) : '{}';
  if (Buffer.byteLength(drawJson) > DRAW_LIMIT) throw new Error(`draw.json ${kb(Buffer.byteLength(drawJson))} > 250 КБ`);

  const htmlTemplate = read('src/index.html');
  const swTemplate = read('src/sw.js');
  const manifest = read('src/manifest.webmanifest');
  const icon = readIconPart();
  const arts = artFiles();
  const artHash = createHash('sha1');
  for (const f of arts) artHash.update(f).update(readFileSync(resolve(ROOT, 'assets/art', f)));
  const contentHash = contentHashOf({ js: jsRaw, css, levels: levelsJson, words: wordsJson, draw: drawJson, html: htmlTemplate, sw: swTemplate, manifest, icon: icon.part, art: artHash.digest('hex') });
  const js = fill(jsRaw, { [HASH_PLACEHOLDER]: contentHash });

  // index.html.
  const html = fill(htmlTemplate, {
    __CSS__: css.trim(),
    __LEVELS__: jsonInlineSafe(levelsJson),
    __WORDS__: jsonInlineSafe(wordsJson),
    __DRAW__: jsonInlineSafe(drawJson),
    __JS__: inlineSafe(js),
    [HASH_PLACEHOLDER]: contentHash,
  });
  const htmlBytes = Buffer.byteLength(html);
  if (htmlBytes > HTML_LIMIT) throw new Error(`dist/index.html ${kb(htmlBytes)} > 1 МБ`);
  writeFileSync(resolve(DIST, 'index.html'), html);

  // 3D-графика → dist/art/.
  mkdirSync(resolve(DIST, 'art'), { recursive: true });
  for (const f of arts) copyFileSync(resolve(ROOT, 'assets/art', f), resolve(DIST, 'art', f));

  // sw.js (прекэш с графикой) и манифест.
  const artList = arts.map((f) => `'./art/${f}'`).join(', ');
  writeFileSync(resolve(DIST, 'sw.js'), fill(swTemplate, { [HASH_PLACEHOLDER]: contentHash, "'__ART_FILES__'": artList }));
  writeFileSync(resolve(DIST, 'manifest.webmanifest'), manifest);

  // Иконки (при неудаче — предупреждение, если старые иконки уже лежат в dist).
  let iconsHow = 'пропущено';
  if (icons) {
    try {
      iconsHow = rasterizeIcons(DIST);
    } catch (err) {
      const have = existsSync(resolve(DIST, 'icon-180.png')) && existsSync(resolve(DIST, 'icon-512.png'));
      if (!have) throw err;
      iconsHow = `оставлены прежние (${err.message})`;
    }
  }

  const report = {
    contentHash,
    htmlBytes,
    jsBytes: Buffer.byteLength(js),
    cssBytes: Buffer.byteLength(css),
    levelsBytes: Buffer.byteLength(levelsJson),
    wordsBytes: Buffer.byteLength(wordsJson),
    drawBytes: Buffer.byteLength(drawJson),
    compact,
    icons: iconsHow,
    iconSource: icon.how,
    ms: Math.round(performance.now() - t0),
  };
  log(
    `Сборка ${contentHash}: index.html ${kb(htmlBytes)} (js ${kb(report.jsBytes)}, css ${kb(report.cssBytes)}, ` +
      `levels ${kb(report.levelsBytes)}${compact ? ', компактно' : ''}, words ${kb(report.wordsBytes)}, draw ${kb(report.drawBytes)}), иконки: ${iconsHow}, ${report.ms} мс`,
  );
  for (const w of bundle.warnings) log(`  предупреждение esbuild: ${w.text}`);
  if (statSync(resolve(DIST, 'index.html')).size !== htmlBytes) throw new Error('размер записанного index.html не совпал');
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build({ icons: !process.argv.includes('--no-icons'), native: process.argv.includes('--native') }).catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
