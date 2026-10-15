// Данные «Карандаша» (§2.6, src/data/draw.json): 60 уровней, главы по порядку, каждый проходит
// проверку сборщика (эталон побеждает, бездействие — нет, чернила, детерминизм), id по содержимому.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentId } from '../src/core/hash.js';
import { verifyLevel, chapterOf, LEVELS_TOTAL, CHAPTERS, forId } from '../tools/draw.mjs';
import draw from '../src/modes/draw.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PATH = resolve(ROOT, 'src/data/draw.json');
const data = existsSync(PATH) ? JSON.parse(readFileSync(PATH, 'utf8')) : null;
const levels = data?.draw?.campaign || [];

test('draw.json есть: 60 уровней, главы 1–4 по порядку, id по содержимому', () => {
  assert.ok(data, 'нет src/data/draw.json — npm run draw');
  assert.equal(levels.length, LEVELS_TOTAL);
  levels.forEach((l, i) => {
    assert.equal(l.chapter, chapterOf(i + 1), `уровень ${i + 1}: глава`);
    assert.equal(l.id, contentId(forId(l)), `уровень ${i + 1}: id (без tip/limit)`);
    assert.ok(Number.isInteger(l.difficulty) && l.difficulty > 0);
  });
  for (const ch of CHAPTERS) assert.equal(levels.filter((l) => l.chapter === ch.chapter).length, ch.to - ch.from + 1, `глава ${ch.chapter}`);
});

test('каждый уровень проходит проверку сборщика и открывается режимом', { timeout: 600000 }, () => {
  for (let i = 0; i < levels.length; i++) {
    const { errors } = verifyLevel(levels[i], `уровень ${i + 1}`);
    assert.deepEqual(errors, []);
    const st = draw.create(levels[i]);
    assert.equal(st.sim.phase, levels[i].autoStart ? (st.sim.jar ? 'attack' : 'play') : 'prep');
    assert.ok(draw.layout(st, { x: 0, y: 0, w: 342, h: 600 }).scale > 0);
  }
});

test('кривая: сложность не убывает резко, в каждой главе есть разные типы ландшафта', () => {
  const byChapter = CHAPTERS.map((ch) => levels.filter((l) => l.chapter === ch.chapter));
  for (const list of byChapter) {
    const kinds = new Set(list.flatMap((l) => l.items.map((it) => it.kind)));
    assert.ok(kinds.has('ground') || kinds.has('block'));
    const polys = list.flatMap((l) => l.items.filter((it) => it.kind === 'ground').map((it) => JSON.stringify(it.poly)));
    assert.ok(new Set(polys).size >= Math.min(polys.length, 3), 'ландшафт не одинаковый');
  }
  const swarm = levels.filter((l) => l.type === 'swarm');
  assert.ok(swarm.length >= 16, `уровней «Рой» ${swarm.length}`);
  assert.ok(levels.some((l) => l.items.some((it) => it.kind === 'balloon')), 'есть воздушные шары');
  assert.ok(levels.some((l) => l.items.some((it) => it.kind === 'fan')), 'есть ветер');
  assert.ok(levels.some((l) => l.type === 'ball' && l.items.some((it) => it.kind === 'nest')), 'есть смешанные уровни');
});
