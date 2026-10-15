// Вариант сборки для страницы-артефакта claude.ai: хост оборачивает файл в свой скелет
// (doctype/html/head/body, viewport), поэтому отдаём только содержимое: <title>, <style>,
// разметку и скрипты — без собственных html/head/body и мета-тегов. Результат — dist/artifact.html.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve(new URL('.', import.meta.url).pathname, '..', 'dist');
let html = readFileSync(resolve(dist, 'index.html'), 'utf8');
html = html
  .replace(/^\s*<!doctype html>\s*/i, '')
  .replace(/<html[^>]*>/i, '')
  .replace(/<\/html>\s*$/i, '')
  .replace(/<head>\s*/i, '')
  .replace(/<\/head>\s*/i, '')
  .replace(/<body[^>]*>\s*/i, '')
  .replace(/<\/body>\s*/i, '')
  .replace(/^\s*<meta [^>]*>\s*$/gim, '')
  .replace(/^\s*<link [^>]*>\s*$/gim, '');
// Фон корня до загрузки стилей — вместо inline-атрибута на <html>.
html = html.replace('<title>', '<style>:root{background:#0f1117}</style>\n<title>');
writeFileSync(resolve(dist, 'artifact.html'), html.trim() + '\n');
console.log('dist/artifact.html:', Buffer.byteLength(html, 'utf8'), 'байт');
