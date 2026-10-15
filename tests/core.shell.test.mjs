// Регрессии оболочки без DOM (§3.1, §4.1; WORDS — docs/DESIGN.md §5.6–5.7): стили нижней панели
// игры и карточек, связь экрана игры с хелперами положения поля и бюджета кадра, звёзды и активность
// при победе, шторка подсказок. Проверяются исходники, а не рендер: браузера в node:test нет, а именно
// эти правила ломались переносами строк на 375pt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(resolve(ROOT, 'src/styles.css'), 'utf8');
// Экран игры, клавиатура, итог и шторки — в src/styles/60-game.css (WORDS).
const gameCss = readFileSync(resolve(ROOT, 'src/styles/60-game.css'), 'utf8');
const game = readFileSync(resolve(ROOT, 'src/ui/game.js'), 'utf8');
const win = readFileSync(resolve(ROOT, 'src/ui/win.js'), 'utf8');

/** Тело первого CSS-правила с данным селектором (до закрывающей скобки). */
function rule(selector, source = css) {
  const i = source.indexOf(`${selector} {`);
  const j = source.indexOf(`${selector}{`);
  const start = i >= 0 ? i : j;
  assert.ok(start >= 0, `нет правила ${selector}`);
  const open = source.indexOf('{', start);
  return source.slice(open + 1, source.indexOf('}', open));
}

test('footer режима («ходов N · P %») — одной строкой: nowrap, min-width, не раздувается', () => {
  const body = rule('.footer-text', gameCss);
  assert.match(body, /white-space:\s*nowrap/);
  const mw = body.match(/min-width:\s*(\d+)px/);
  assert.ok(mw && Number(mw[1]) >= 90 && Number(mw[1]) <= 120, 'разумный min-width 90–120px');
  assert.match(body, /overflow:\s*hidden/, 'при нехватке места — обрезка, а не перенос');
  assert.match(body, /text-overflow:\s*ellipsis/);
  // 375pt с «Пропустить»: 3 кнопки (Отменить, Сбросить, Пропустить; подсказка — в шапке) × min-width
  // + зазоры + footer ≤ 375 − поля панели.
  const bar = rule('.bottombar', gameCss);
  const gap = Number(bar.match(/gap:\s*(\d+)px/)[1]);
  const padX = Number(bar.match(/padding:\s*\d+px\s+(\d+)px/)[1]);
  const btnMin = Number(rule('.bar-btn', gameCss).match(/min-width:\s*(\d+)px/)[1]);
  assert.ok(btnMin >= 44, 'кнопки панели ≥ 44pt');
  const footerText = 'ходов 12 · 83 %';
  const fontPx = Number(body.match(/font-size:\s*(\d+)px/)[1]);
  const footerPx = Math.ceil(footerText.length * fontPx * 0.58); // оценка ширины системного шрифта
  assert.ok(3 * btnMin + 3 * gap + Math.max(footerPx, Number(mw[1])) <= 375 - 2 * padX, 'панель влезает в 375pt одной строкой');
  assert.ok(!/barButton\('hint'/.test(game), 'подсказки нет в нижней панели — она в шапке (пилюля) и на клавиатуре «Слов»');
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
  assert.match(game, /mode\.layout\(gameState,\s*mode\.worldRect \? rect : boardRect\(rect(,\s*\{[^}]*\})?\),\s*theme\)/);
  assert.match(game, /createFrameBudget\(mode\.continuous \? FRAME_BUDGET_CONTINUOUS_MS : FRAME_BUDGET_MS,\s*FRAME_WARMUP\)/);
  assert.match(game, /const FRAME_WARMUP = 3/);
  assert.match(game, /frameBudget\.check\(dt\)/);
  // reset: в onResize холста и в подписке на смену темы.
  assert.match(game, /createCanvas\(board,\s*\(rect\)\s*=>\s*\{\s*frameBudget\.reset\(\);/);
  assert.match(game, /onThemeChange\(\(\)\s*=>\s*\{[^}]*frameBudget\.reset\(\);/);
  assert.ok(!/if \(dt > FRAME_BUDGET_MS\)/.test(game), 'прямое сравнение заменено бюджетом с прогревом');
});

test('победа: 1–3 звезды (starsFor) пишутся в прогресс, активность дня — для кампании, ежедневной и бесконечности', () => {
  assert.match(game, /import \{[^}]*\bstarsFor\b[^}]*\} from '\.\.\/core\/progress\.js'/);
  assert.match(game, /import \{ recordActivity \} from '\.\.\/core\/stats\.js'/);
  assert.match(game, /const stars = starsFor\(attempt, perfect\)/);
  assert.match(game, /recordWin\(progress, level\.id, star, elapsedMs, stars, !attempt\.hintUsed\)/);
  // Активность пишется один раз, после веток кампании/ежедневной/бесконечности, до сохранения.
  const solved = game.slice(game.indexOf('function onSolved()'));
  const act = solved.indexOf('state.activity = recordActivity(state.activity, app.today())');
  assert.ok(act > 0, 'активность пишется в onSolved');
  assert.ok(act > solved.indexOf('} else if (isEndless) {') && act < solved.indexOf('app.save()'), 'для всех видов партии, до app.save()');
});

test('подсказка: шторка «Подсказка ×» для всех режимов, без «второго тапа»; итог — «Уровень пройден!» и «К карте»', () => {
  assert.match(game, /app\.overlays\.sheet\(\{\s*title: COPY\.hintTitle/);
  assert.match(game, /nextMove: 'Следующий ход'/);
  assert.ok(!/HINT_ARM_MS|hintArmedUntil|hintConfirm/.test(game), 'подтверждение двойным тапом убрано: выбор в шторке и есть подтверждение');
  assert.match(win, /'Уровень пройден!'/);
  assert.match(win, /'Ежедневная решена!'/);
  assert.match(win, /art\('sage-loop'/);
  assert.match(game, /toMap: 'К карте'/);
  // «Следующий уровень →» — единственная чёрная кнопка итога.
  assert.equal((win.match(/variant: 'primary'/g) || []).length, 3, 'primary — «Следующий уровень» итога и по одной на экране «Кампания пройдена»');
});
