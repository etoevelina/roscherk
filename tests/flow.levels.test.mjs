// Валидность всех flow-уровней src/data/levels.json по сохранённому решению (§7.5): кампания,
// пул «Бесконечности» и daily — эталон валиден и покрывает поле, размер/глава по CHAPTERS,
// difficulty ≥ порога главы и не убывает внутри главы кампании, id — 8 hex, unique — bool.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAPTERS, POOL, DAILY } from '../src/modes/flow.gen.js';
import { validate, solutionOf } from '../src/modes/flow.solve.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let data;

before(() => {
  const path = resolve(ROOT, 'src/data/levels.json');
  assert.ok(existsSync(path), 'нет src/data/levels.json — выполните npm run gen');
  data = JSON.parse(readFileSync(path, 'utf8'));
  assert.ok(data.flow, 'в levels.json нет раздела flow');
});

/** Проверяет один уровень против спецификации его главы. */
function checkLevel(level, spec, where) {
  assert.match(String(level.id), /^[0-9a-f]{8}$/, `${where}: id`);
  assert.ok(Number.isInteger(level.seed) && level.seed >= 0, `${where}: seed`);
  assert.equal(level.n, spec.n, `${where}: размер поля главы ${spec.chapter}`);
  assert.equal(typeof level.unique, 'boolean', `${where}: unique`);
  assert.ok(level.flows.length >= spec.minFlows && level.flows.length <= spec.maxFlows, `${where}: число потоков`);
  assert.equal(level.flows.flat().length, level.n * level.n, `${where}: эталон покрывает поле`);
  assert.ok(validate(level, solutionOf(level)), `${where}: эталон валиден`);
  assert.ok(Number.isInteger(level.difficulty) && level.difficulty >= spec.minDifficulty, `${where}: difficulty ${level.difficulty} < ${spec.minDifficulty}`);
  if (level.n <= 8) assert.equal(level.unique, true, `${where}: уникальность обязательна при n ≤ 8`);
}

test('кампания: 100 уровней, главы по CHAPTERS, difficulty не убывает внутри главы', () => {
  const campaign = data.flow.campaign;
  assert.equal(campaign.length, 100);
  for (const spec of CHAPTERS) {
    let prev = -Infinity;
    for (let index = spec.from; index <= spec.to; index++) {
      const level = campaign[index - 1];
      assert.equal(level.chapter, spec.chapter, `уровень ${index}: глава`);
      checkLevel(level, spec, `кампания ${index}`);
      assert.ok(level.difficulty >= prev, `уровень ${index}: difficulty убывает (${prev} → ${level.difficulty})`);
      prev = level.difficulty;
    }
  }
  assert.deepEqual(campaign[0].tip, { ru: 'Соедини пары одного цвета и заполни все клетки' });
  assert.deepEqual(campaign[1].tip, { ru: 'Веди по чужой дорожке, чтобы разрезать её' });
});

test('пул «Бесконечности»: 150 уровней по главам POOL', () => {
  const pool = data.flow.pool;
  assert.equal(pool.length, POOL.reduce((sum, p) => sum + p.count, 0));
  let offset = 0;
  for (const spec of POOL) {
    for (let i = 0; i < spec.count; i++) {
      const level = pool[offset + i];
      assert.equal(level.chapter, spec.chapter, `пул ${offset + i}: глава`);
      checkLevel(level, spec, `пул ${offset + i}`);
    }
    offset += spec.count;
  }
});

test('daily: 40 уровней главы 3', () => {
  const daily = data.flow.daily;
  assert.equal(daily.length, DAILY.count);
  for (let i = 0; i < daily.length; i++) {
    assert.equal(daily[i].chapter, DAILY.chapter, `daily ${i}: глава`);
    checkLevel(daily[i], DAILY, `daily ${i}`);
  }
});

test('id уровней уникальны во всех наборах flow', () => {
  const ids = new Set();
  for (const kind of ['campaign', 'pool', 'daily']) {
    for (const level of data.flow[kind]) {
      assert.ok(!ids.has(level.id), `повтор id ${level.id}`);
      ids.add(level.id);
    }
  }
  assert.equal(ids.size, 290);
});
