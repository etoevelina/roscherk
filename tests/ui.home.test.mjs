// Тесты чистой логики главной (src/ui/home.js, docs/DESIGN.md §5.2): цель карточки «Продолжить путь»
// и мини-превью ежедневной. DOM не нужен: модуль на верхнем уровне к document не обращается.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickJourney, dailyPattern } from '../src/ui/home.js';

const mk = (prefix, n, chapterSize = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, chapter: chapterSize ? 1 + Math.floor(i / chapterSize) : 1 }));
const CAMPAIGNS = { zip: mk('z', 10), flow: mk('f', 10), stroke: mk('s', 10), words: mk('w', 10, 5), draw: [] };
const MODES = [{ id: 'zip' }, { id: 'flow' }, { id: 'stroke' }, { id: 'words', openByChapter: true }, { id: 'draw' }];
const POOL = { zip: mk('zp', 3), flow: [], stroke: [], words: [], draw: [] };
const find = (modeId, levelId) => {
  for (const kind of ['campaign', 'pool']) {
    const list = (kind === 'campaign' ? CAMPAIGNS : POOL)[modeId] || [];
    const index = list.findIndex((l) => l.id === levelId);
    if (index >= 0) return { level: list[index], kind, index };
  }
  return null;
};
const win = (ids) => Object.fromEntries(ids.map((id) => [id, { star: false, bestMs: 1000, stars: 1 }]));
const base = { today: '2026-10-15', modes: MODES, levelsOf: (id) => CAMPAIGNS[id] || [], find };

test('pickJourney: новичок — «Маршрут · Уровень 1»', () => {
  const j = pickJourney({ ...base, current: null, progress: {}, skipped: {} });
  assert.deepEqual(j, { type: 'start', modeId: 'zip', levelId: 'z1', index: 0 });
});

test('pickJourney: прерванная партия кампании — её уровень', () => {
  const current = { kind: 'campaign', mode: 'flow', levelId: 'f4' };
  const j = pickJourney({ ...base, current, progress: { zip: win(['z1', 'z2']) } });
  assert.equal(j.type, 'resume');
  assert.equal(j.modeId, 'flow');
  assert.equal(j.levelId, 'f4');
  assert.equal(j.index, 3);
});

test('pickJourney: ежедневная сегодняшняя продолжается, вчерашняя — нет', () => {
  const today = { kind: 'daily', mode: 'zip', levelId: 'z3', date: '2026-10-15' };
  assert.equal(pickJourney({ ...base, current: today }).type, 'resume');
  const stale = { ...today, date: '2026-10-14' };
  const j = pickJourney({ ...base, current: stale, progress: { flow: win(['f1']) } });
  assert.equal(j.type, 'next');
  assert.equal(j.modeId, 'flow');
});

test('pickJourney: бесконечность из пула продолжается', () => {
  const current = { kind: 'endless', mode: 'zip', levelId: 'zp2', endless: { streak: 3, modeChoice: 'mix' } };
  const j = pickJourney({ ...base, current });
  assert.equal(j.type, 'resume');
  assert.equal(j.kind, 'endless');
});

test('pickJourney: уровня из current нет в сборке — следующий уровень', () => {
  const current = { kind: 'campaign', mode: 'zip', levelId: 'gone' };
  const j = pickJourney({ ...base, current, progress: { zip: win(['z1', 'z2', 'z3']) } });
  assert.deepEqual(j, { type: 'next', modeId: 'zip', levelId: 'z4', index: 3 });
});

test('pickJourney: режим с наибольшим прогрессом, при равенстве — по порядку реестра', () => {
  const progress = { zip: win(['z1']), flow: win(['f1', 'f2', 'f3']), stroke: win(['s1', 's2', 's3']) };
  assert.equal(pickJourney({ ...base, progress }).modeId, 'flow');
});

test('pickJourney: полностью пройденный режим пропускается', () => {
  const progress = { zip: win(CAMPAIGNS.zip.map((l) => l.id)), stroke: win(['s1']) };
  const j = pickJourney({ ...base, progress });
  assert.equal(j.modeId, 'stroke');
  assert.equal(j.levelId, 's2');
});

test('pickJourney: «Слова» — окно по главам (openByChapter)', () => {
  const progress = { words: win(['w1', 'w2', 'w3', 'w4', 'w5', 'w6']) };
  const j = pickJourney({ ...base, progress });
  assert.equal(j.modeId, 'words');
  assert.equal(j.levelId, 'w7');
});

test('pickJourney: всё пройдено или уровней нет — null', () => {
  const all = {};
  for (const [id, list] of Object.entries(CAMPAIGNS)) all[id] = win(list.map((l) => l.id));
  assert.equal(pickJourney({ ...base, progress: all }), null);
  assert.equal(pickJourney({ ...base, levelsOf: () => [] }), null);
});

test('dailyPattern: 25 клеток, детерминирован по дате, 4 чёрные, первая клетка белая', () => {
  for (const date of ['2026-10-15', '2026-01-01', '2027-03-09']) {
    const a = dailyPattern(date);
    assert.equal(a.length, 25);
    assert.deepEqual(a, dailyPattern(date));
    assert.ok(a.every((v) => v === 0 || v === 1 || v === 2));
    assert.equal(a.filter((v) => v === 2).length, 4);
    assert.equal(a[a.findIndex((v) => v !== 0)], 1);
    // центральная строка заполнена во всех силуэтах
    assert.ok(a.slice(10, 15).every((v) => v !== 0));
  }
  const days = Array.from({ length: 14 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
  assert.ok(new Set(days.map((d) => dailyPattern(d).join(''))).size > 7, 'узор меняется изо дня в день');
});

test('pickJourney: последний сыгранный режим (settings.lastMode) важнее режима с наибольшим прогрессом', async () => {
  const { pickJourney } = await import('../src/ui/home.js');
  const mk = (p, n) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, chapter: 1 }));
  const camp = { zip: mk('z', 10), flow: mk('f', 10) };
  const progress = { zip: { z0: { star: true, bestMs: 1 }, z1: { star: true, bestMs: 1 }, z2: { star: true, bestMs: 1 } }, flow: { f0: { star: false, bestMs: 1 } } };
  const modes = [{ id: 'zip' }, { id: 'flow' }];
  const base = { modes, levelsOf: (id) => camp[id], progress, skipped: {} };
  assert.equal(pickJourney(base).modeId, 'zip');
  const j = pickJourney({ ...base, lastMode: 'flow' });
  assert.equal(j.modeId, 'flow');
  assert.equal(j.levelId, 'f1');
  assert.equal(pickJourney({ ...base, lastMode: 'nope' }).modeId, 'zip');
});
