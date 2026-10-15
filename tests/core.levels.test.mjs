// Тесты src/core/levels.js: компактное кодирование путей (§4.7) без потерь на всех уровнях
// levels.json и синтетических путях; decodeLevels без meta.compact — без изменений; поиск уровня.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePath, decodePath, compactLevels, decodeLevels, modeSets, findLevel } from '../src/core/levels.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('encodePath/decodePath: round-trip на синтетических путях', () => {
  const n = 4;
  const snake = [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12];
  const packed = encodePath(snake, n);
  assert.equal(packed.s, 0);
  assert.equal(packed.d, 'RRRDLLLDRRRDLLL');
  assert.deepEqual(decodePath(packed, n), snake);
  assert.deepEqual(decodePath([5, 6], n), [5, 6], 'массив возвращается как есть');
  assert.deepEqual(decodePath(encodePath([9], n), n), [9], 'путь из одной клетки');
  assert.deepEqual(decodePath(encodePath([10, 6, 2, 3], n), n), [10, 6, 2, 3]);
});

test('encodePath отвергает не 4-связный путь', () => {
  assert.throws(() => encodePath([0, 5], 4), /4-связный/);
  assert.throws(() => encodePath([0, 2], 4), /4-связный/);
});

test('compactLevels/decodeLevels: round-trip, вход не мутируется, meta.compact выставлен', () => {
  const data = {
    meta: { masterSeed: 1 },
    zip: { campaign: [{ id: 'a', n: 3, path: [0, 1, 2, 5, 4, 3, 6, 7, 8], marks: [[0, 1]], walls: [] }], pool: [], daily: [] },
    flow: { campaign: [{ id: 'b', n: 3, flows: [[0, 1, 2], [3, 4, 5], [6, 7, 8]] }], pool: [], daily: [] },
    stroke: { campaign: [{ id: 'c', w: 3, h: 3, nodes: [[0, 0]], edges: [[0, 1, 0]], solution: [0, 1] }], pool: [], daily: [] },
  };
  const snapshot = JSON.stringify(data);
  const compact = compactLevels(data);
  assert.equal(JSON.stringify(data), snapshot, 'вход не изменился');
  assert.equal(compact.meta.compact, true);
  assert.equal(typeof compact.zip.campaign[0].path.d, 'string');
  assert.equal(typeof compact.flow.campaign[0].flows[1].d, 'string');
  assert.deepEqual(compact.stroke.campaign[0], data.stroke.campaign[0], 'stroke не кодируется');
  const decoded = decodeLevels(JSON.parse(JSON.stringify(compact)));
  delete decoded.meta.compact;
  assert.deepEqual(decoded, data);
});

test('decodeLevels без meta.compact возвращает данные как есть', () => {
  const data = { meta: {}, zip: { campaign: [{ id: 'a', n: 2, path: { s: 0, d: 'R' } }] } };
  assert.equal(decodeLevels(data), data);
  assert.deepEqual(data.zip.campaign[0].path, { s: 0, d: 'R' }, 'путь не тронут');
  assert.equal(decodeLevels(null), null);
});

test('компактное кодирование всех уровней levels.json без потерь', () => {
  const path = resolve(ROOT, 'src/data/levels.json');
  assert.ok(existsSync(path), 'нет src/data/levels.json — выполните npm run gen');
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const compact = compactLevels(data);
  const compactJson = JSON.stringify(compact);
  assert.ok(compactJson.length < JSON.stringify(data).length, 'компактная форма должна быть короче');
  const decoded = decodeLevels(JSON.parse(compactJson));
  delete decoded.meta.compact;
  assert.deepEqual(decoded, data);
});

test('modeSets и findLevel', () => {
  const data = { meta: {}, zip: { campaign: [{ id: 'a' }, { id: 'b' }], pool: [{ id: 'p' }] } };
  assert.deepEqual(modeSets(data, 'flow'), { campaign: [], pool: [], daily: [] });
  assert.deepEqual(modeSets(data, 'zip').daily, []);
  assert.deepEqual(findLevel(data, 'zip', 'b'), { level: { id: 'b' }, kind: 'campaign', index: 1 });
  assert.deepEqual(findLevel(data, 'zip', 'p'), { level: { id: 'p' }, kind: 'pool', index: 0 });
  assert.equal(findLevel(data, 'zip', 'deadbeef'), null);
  assert.equal(findLevel(data, 'stroke', 'a'), null);
});
