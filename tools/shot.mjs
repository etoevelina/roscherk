// Скриншот экрана для проверки вёрстки (разработка): безголовый Chrome открывает собранный dist/
// с dev-параметрами (src/main.js: ?demo=1&screen=…&theme=…). Окно headless-Chrome не бывает
// уже ~500px, поэтому страница показывается в iframe ровно нужной ширины (как телефон).
//   node tools/shot.mjs <имя> "<query>" [--w 390] [--h 844] [--out DIR] [--wait 2000]
// Пример: node tools/shot.mjs stats-dark "screen=stats&demo=1&theme=dark"
// Пишет <out>/<имя>.png (по умолчанию $SHOTS_DIR или /tmp/roscherk-shots) — его можно открыть Read.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIST = resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const [name = 'shot', query = 'demo=1'] = positional;
const w = Number(opt('w', 390));
const hgt = Number(opt('h', 844));
const wait = Number(opt('wait', 2000));
const out = resolve(opt('out', process.env.SHOTS_DIR || join(tmpdir(), 'roscherk-shots')));
mkdirSync(out, { recursive: true });
if (!existsSync(CHROME)) throw new Error('нет Google Chrome');
if (!existsSync(join(DIST, 'index.html'))) throw new Error('нет dist/index.html — node tools/build.mjs --no-icons');

const wrapper = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000}iframe{display:block;border:0;width:${w}px;height:${hgt}px}</style></head><body><iframe src="/?${query.replace(/"/g, '&quot;')}"></iframe></body></html>`;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__shot') {
    res.writeHead(200, { 'content-type': TYPES['.html'] });
    return res.end(wrapper);
  }
  const rel = normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(DIST, rel);
  if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const profile = mkdtempSync(join(tmpdir(), 'roscherk-chrome-'));
const file = join(out, `${name}.png`);
try {
  await new Promise((res, rej) => {
    // execFileSync заблокировал бы цикл событий — и наш же сервер не ответил бы Chrome.
    import('node:child_process').then(({ execFile }) =>
      execFile(
        CHROME,
        [
          '--headless=new',
          '--disable-gpu',
          '--hide-scrollbars',
          '--no-first-run',
          '--no-default-browser-check',
          `--user-data-dir=${profile}`,
          `--window-size=${w},${hgt}`,
          '--force-device-scale-factor=2',
          `--virtual-time-budget=${wait}`,
          `--screenshot=${file}`,
          `http://127.0.0.1:${port}/__shot`,
        ],
        { timeout: 60000 },
        (err) => (err && !existsSync(file) ? rej(err) : res()),
      ),
    );
  });
  console.log(file);
} finally {
  server.close();
  rmSync(profile, { recursive: true, force: true });
}
void execFileSync;
