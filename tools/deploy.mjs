// Публикация на GitHub Pages (§0): содержимое dist/ — в ветку gh-pages удалённого origin.
//   node tools/deploy.mjs            (обычно через npm run deploy: сборка + публикация)
// Ветка gh-pages собирается во временной папке из одного коммита (история сайта не копится),
// автор коммита — тот же, что в git config репозитория. dist/artifact.html не публикуется;
// dist-extra/ (политика конфиденциальности и т. п.) добавляется к сайту.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const SKIP = new Set(['artifact.html']);

const git = (args, cwd = ROOT) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function main() {
  if (!existsSync(resolve(DIST, 'index.html'))) throw new Error('нет dist/index.html — сначала npm run build');
  const remote = git(['remote', 'get-url', 'origin']);
  const name = git(['config', 'user.name']);
  const email = git(['config', 'user.email']);
  const html = readFileSync(resolve(DIST, 'index.html'), 'utf8');
  const hash = (html.match(/<meta name="build" content="([0-9a-f]+)"/) || [])[1] || 'dev';
  const tmp = mkdtempSync(join(tmpdir(), 'roscherk-pages-'));
  try {
    for (const f of readdirSync(DIST)) if (!SKIP.has(f)) cpSync(resolve(DIST, f), resolve(tmp, f), { recursive: true });
    // Дополнительные страницы сайта (политика конфиденциальности для App Store): dist-extra/*.
    const extra = resolve(ROOT, 'dist-extra');
    if (existsSync(extra)) for (const f of readdirSync(extra)) cpSync(resolve(extra, f), resolve(tmp, f), { recursive: true });
    writeFileSync(resolve(tmp, '.nojekyll'), ''); // отдавать файлы как есть, без Jekyll
    git(['init', '-q', '-b', 'gh-pages'], tmp);
    git(['config', 'user.name', name], tmp);
    git(['config', 'user.email', email], tmp);
    git(['add', '-A'], tmp);
    git(['commit', '-q', '-m', `Сборка ${hash}`], tmp);
    git(['push', '-q', '-f', remote, 'gh-pages'], tmp);
    console.log(`Опубликовано: сборка ${hash} → ${remote} (ветка gh-pages)`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
