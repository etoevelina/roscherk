// Регрессии оболочки без DOM (§3.1, §4.1): стили нижней панели и карточек главного экрана, связь
// экрана игры с хелперами положения поля и бюджета кадра. Проверяются исходники, а не рендер:
// браузера в node:test нет, а именно эти правила ломались переносами строк на 375pt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(resolve(ROOT, 'src/styles.css'), 'utf8');
const game = readFileSync(resolve(ROOT, 'src/ui/game.js'), 'utf8');

/** Тело первого CSS-правила с данным селектором (до закрывающей скобки). */
function rule(selector) {
  const i = css.indexOf(`${selector} {`);
  const j = css.indexOf(`${selector}{`);
  const start = i >= 0 ? i : j;
  assert.ok(start >= 0, `нет правила ${selector}`);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

test('footer режима («ходов N · P %») — одной строкой: nowrap, min-width, не раздувается', () => {
  const body = rule('.footer-text');
  assert.match(body, /white-space:\s*nowrap/);
  const mw = body.match(/min-width:\s*(\d+)px/);
  assert.ok(mw && Number(mw[1]) >= 90 && Number(mw[1]) <= 120, 'разумный min-width 90–120px');
  assert.match(body, /overflow:\s*hidden/, 'при нехватке места — обрезка, а не перенос');
  assert.match(body, /text-overflow:\s*ellipsis/);
  // 375pt с «Пропустить»: 4 кнопки × 56 + зазоры + footer ≤ 375 − поля панели.
  const bar = rule('.bottombar');
  const gap = Number(bar.match(/gap:\s*(\d+)px/)[1]);
  const padX = Number(bar.match(/padding:\s*\d+px\s+(\d+)px/)[1]);
  const btnMin = Number(rule('.bar-btn').match(/min-width:\s*(\d+)px/)[1]);
  const footerText = 'ходов 12 · 83 %';
  const fontPx = Number(body.match(/font-size:\s*(\d+)px/)[1]);
  const footerPx = Math.ceil(footerText.length * fontPx * 0.58); // оценка ширины системного шрифта
  assert.ok(4 * btnMin + 4 * gap + Math.max(footerPx, Number(mw[1])) <= 375 - 2 * padX, 'панель влезает в 375pt одной строкой');
});

test('карточка режима: подпись «пройдено 2/100» не переносится, кнопка не сжимается, шрифт подписи уменьшается', () => {
  const muted = rule('.card .row .grow .muted');
  assert.match(muted, /white-space:\s*nowrap/);
  assert.match(rule('.card .row > .btn'), /flex:\s*0 0 auto/, 'кнопка «Продолжить» не растягивается и не сжимается');
  assert.match(rule('.card .row .grow'), /container-type:\s*inline-size/, 'ширина .grow — контейнер для запроса');
  const containers = [...css.matchAll(/@container\s*\(max-width:\s*(\d+)px\)\s*\{\s*\.card \.row \.grow \.muted\s*\{\s*font-size:\s*(\d+)px/g)];
  assert.ok(containers.length >= 1, 'при нехватке места шрифт подписи уменьшается');
  for (const m of containers) assert.ok(Number(m[2]) < 14, 'меньше базовых 14px');
  assert.ok(!/\.card \.row > \.btn\s*\{[^}]*font-size/.test(css), 'шрифт кнопки не трогаем');
});

test('экран игры: layout режима получает rect из boardRect; бюджет кадра сбрасывается при смене размера и темы', () => {
  assert.match(game, /mode\.layout\(gameState,\s*boardRect\(rect\),\s*theme\)/);
  assert.match(game, /createFrameBudget\(FRAME_BUDGET_MS,\s*FRAME_WARMUP\)/);
  assert.match(game, /const FRAME_WARMUP = 3/);
  assert.match(game, /frameBudget\.check\(dt\)/);
  // reset: в onResize холста и в подписке на смену темы.
  assert.match(game, /createCanvas\(board,\s*\(rect\)\s*=>\s*\{\s*frameBudget\.reset\(\);/);
  assert.match(game, /onThemeChange\(\(\)\s*=>\s*\{[^}]*frameBudget\.reset\(\);/);
  assert.ok(!/if \(dt > FRAME_BUDGET_MS\)/.test(game), 'прямое сравнение заменено бюджетом с прогревом');
});
