// Тест сборки (§4.7, §7 п.5): после build dist/index.html существует, ≤ 1 МБ, содержит
// <script id="levels"> и apple-touch-icon; contentHash подставлен в sw.js и index.html.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, contentHashOf, iconPartOf } from '../tools/build.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
let report;

before(async () => {
  assert.ok(existsSync(resolve(ROOT, 'src/data/levels.json')), 'нет src/data/levels.json — выполните npm run gen');
  // Иконки растеризуются отдельно (npm run build); здесь — только HTML, sw и манифест.
  report = await build({ icons: false, log() {} });
});

test('dist/index.html существует и ≤ 1 МБ', () => {
  const path = resolve(DIST, 'index.html');
  assert.ok(existsSync(path));
  const size = statSync(path).size;
  assert.ok(size <= 1024 * 1024, `index.html ${size} байт > 1 МБ`);
  assert.equal(size, report.htmlBytes);
});

test('index.html содержит уровни, apple-touch-icon и мета iOS', () => {
  const html = readFileSync(resolve(DIST, 'index.html'), 'utf8');
  assert.match(html, /<script type="application\/json" id="levels">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\.\/icon-180\.png">/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /<html lang="ru" style="background:#121412">/);
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest">/);
  assert.ok(!html.includes('__CONTENT_HASH__'), 'плейсхолдер хэша не подставлен');
  assert.ok(!html.includes('__CSS__') && !html.includes('__JS__') && !html.includes('__LEVELS__'));
  assert.ok(html.includes(`content="${report.contentHash}"`));
});

test('вшитый levels.json разбирается и содержит meta', () => {
  const html = readFileSync(resolve(DIST, 'index.html'), 'utf8');
  const m = html.match(/<script type="application\/json" id="levels">([\s\S]*?)<\/script>/);
  assert.ok(m, 'блок уровней не найден');
  const data = JSON.parse(m[1].replace(/<\\\/script/g, '</script'));
  assert.ok(data.meta && typeof data.meta.masterSeed === 'number');
  const modes = Object.keys(data).filter((k) => k !== 'meta');
  assert.ok(modes.length >= 1);
  for (const id of modes) assert.ok(Array.isArray(data[id].campaign) && data[id].campaign.length > 0, `${id}: нет кампании`);
});

test('уровни «Слов» (§2.5) вшиты отдельным <script id="words"> и разбираются так же, как в рантайме', async () => {
  const html = readFileSync(resolve(DIST, 'index.html'), 'utf8');
  assert.ok(!html.includes('__WORDS__'), 'плейсхолдер слов не подставлен');
  const m = html.match(/<script type="application\/json" id="words">([\s\S]*?)<\/script>/);
  assert.ok(m, 'блок слов не найден');
  const raw = m[1];
  const { readEmbeddedLevels } = await import('../src/core/levels.js');
  const levelsBlock = html.match(/<script type="application\/json" id="levels">([\s\S]*?)<\/script>/)[1];
  const fakeDoc = { getElementById: (id) => (id === 'levels' ? { textContent: levelsBlock } : id === 'words' ? { textContent: raw } : null) };
  const levels = readEmbeddedLevels(fakeDoc);
  assert.ok(levels.zip && levels.flow && levels.stroke, 'головоломки на месте');
  if (existsSync(resolve(ROOT, 'src/data/words.json'))) {
    assert.ok(Array.isArray(levels.words.campaign) && levels.words.campaign.length > 0, 'кампания «Слов»');
  }
});

test('уровни «Карандаша» (§2.6) вшиты <script id="draw">, без «</script>» внутри, и разбираются рантаймом', async () => {
  const html = readFileSync(resolve(DIST, 'index.html'), 'utf8');
  assert.ok(!html.includes('__DRAW__'), 'плейсхолдер «Карандаша» не подставлен');
  const m = html.match(/<script type="application\/json" id="draw">([\s\S]*?)<\/script>/);
  assert.ok(m, 'блок «Карандаша» не найден');
  const { readEmbeddedLevels } = await import('../src/core/levels.js');
  const levelsBlock = html.match(/<script type="application\/json" id="levels">([\s\S]*?)<\/script>/)[1];
  const fakeDoc = { getElementById: (id) => (id === 'levels' ? { textContent: levelsBlock } : id === 'draw' ? { textContent: m[1] } : null) };
  const levels = readEmbeddedLevels(fakeDoc);
  if (existsSync(resolve(ROOT, 'src/data/draw.json'))) {
    const src = JSON.parse(readFileSync(resolve(ROOT, 'src/data/draw.json'), 'utf8'));
    assert.equal(levels.draw.campaign.length, src.draw.campaign.length, 'все уровни «Карандаша» в сборке');
    assert.deepEqual(levels.draw.campaign[0], src.draw.campaign[0]);
  }
});

test('sw.js и манифест записаны, хэш подставлен', () => {
  const sw = readFileSync(resolve(DIST, 'sw.js'), 'utf8');
  assert.ok(sw.includes(`'roscherk-' + CONTENT_HASH`) || sw.includes('roscherk-'));
  assert.ok(sw.includes(report.contentHash));
  assert.ok(!sw.includes('__CONTENT_HASH__'));
  const manifest = JSON.parse(readFileSync(resolve(DIST, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'Росчерк');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.orientation, 'portrait');
  assert.deepEqual(manifest.icons.map((i) => i.sizes).sort(), ['180x180', '512x512']);
});

test('contentHash учитывает всё содержимое поставки: уровни, CSS, HTML, sw, манифест, а не только JS', () => {
  const base = { js: 'var a=1;', css: '.a{color:red}', levels: '{"zip":{}}', html: '<html>', sw: 'self;', manifest: '{}' };
  const h0 = contentHashOf(base);
  assert.match(h0, /^[0-9a-f]{12}$/);
  assert.equal(contentHashOf({ ...base }), h0, 'детерминирован');
  for (const key of Object.keys(base)) {
    const changed = { ...base, [key]: `${base[key]} ` };
    assert.notEqual(contentHashOf(changed), h0, `изменение ${key} должно менять хэш`);
  }
  // Перенос байтов между частями (та же конкатенация) — тоже другой хэш.
  assert.notEqual(contentHashOf({ ...base, js: 'var a=1;.', css: 'a{color:red}' }), h0);
  // Хэш сборки совпадает с хэшем её входов и подставлен во все три места.
  const html = readFileSync(resolve(DIST, 'index.html'), 'utf8');
  const sw = readFileSync(resolve(DIST, 'sw.js'), 'utf8');
  assert.ok(html.includes(`content="${report.contentHash}"`));
  assert.ok(sw.includes(`'${report.contentHash}'`));
  assert.ok(html.includes(`"${report.contentHash}"`), 'версия в бандле (настройки)');
});

test('в бандле нет shadowBlur и внешних ссылок на CDN', () => {
  const html = readFileSync(resolve(DIST, 'index.html'), 'utf8');
  assert.ok(!/shadowBlur\s*=/.test(html), 'shadowBlur запрещён');
  assert.ok(!/https?:\/\/(cdn|unpkg|fonts\.googleapis)/.test(html), 'внешние ресурсы запрещены');
});

test('contentHash учитывает иконки: assets/icon.png или .svg, иначе готовые dist/icon-*.png (они в PRECACHE sw.js)', () => {
  // Исходник svg — приоритетный источник, png при нём не влияют.
  const svg = '<svg viewBox="0 0 1 1"/>';
  const pngs = [
    { name: 'icon-512.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]) },
    { name: 'icon-180.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 2]) },
  ];
  const fromSvg = iconPartOf({ svg });
  assert.ok(fromSvg.length > 0);
  assert.equal(iconPartOf({ svg, pngs }), fromSvg, 'при наличии svg png не учитываются');
  assert.notEqual(iconPartOf({ svg: `${svg} ` }), fromSvg, 'правка svg меняет часть хэша');
  // Без svg — байты png, порядок файлов не важен, содержимое — важно.
  const fromPng = iconPartOf({ pngs });
  assert.ok(fromPng.length > 0);
  assert.equal(iconPartOf({ pngs: [pngs[1], pngs[0]] }), fromPng, 'порядок png не влияет');
  const changed = [pngs[0], { name: 'icon-180.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 3]) }];
  assert.notEqual(iconPartOf({ pngs: changed }), fromPng, 'другой байт png меняет часть хэша');
  assert.notEqual(fromPng, fromSvg);
  assert.equal(iconPartOf({}), '', 'без иконок — пустая часть');
  assert.equal(iconPartOf({ pngs: [{ name: 'icon-180.png', data: Buffer.alloc(0) }] }), '');
  // Часть icon входит в contentHash сборки.
  const base = { js: 'var a=1;', css: '.a{}', levels: '{}', html: '<html>', sw: 'self;', manifest: '{}', icon: fromSvg };
  assert.notEqual(contentHashOf({ ...base, icon: fromPng }), contentHashOf(base));
  assert.notEqual(contentHashOf({ ...base, icon: '' }), contentHashOf(base));
  // Реальная сборка: источник иконок назван в отчёте — мастер assets/icon.png, иначе assets/icon.svg.
  assert.equal(typeof report.iconSource, 'string');
  const expected = existsSync(resolve(ROOT, 'assets/icon.png')) ? 'assets/icon.png' : existsSync(resolve(ROOT, 'assets/icon.svg')) ? 'assets/icon.svg' : null;
  assert.ok(expected ? report.iconSource === expected : report.iconSource.length > 0, report.iconSource);
});
