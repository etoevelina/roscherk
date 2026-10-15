// Тесты src/core/rng.js: детерминизм, распределение, перестановка, FNV-1a.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, hash32 } from '../src/core/rng.js';

test('mulberry32: одинаковый seed даёт одинаковую последовательность', () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  for (let i = 0; i < 1000; i++) assert.equal(a.next(), b.next());
});

test('mulberry32: разные seed дают разные последовательности', () => {
  const a = mulberry32(1);
  const b = mulberry32(2);
  const sa = Array.from({ length: 16 }, () => a.next());
  const sb = Array.from({ length: 16 }, () => b.next());
  assert.notDeepEqual(sa, sb);
});

test('mulberry32: seed приводится к uint32', () => {
  const a = mulberry32(5);
  const b = mulberry32(5 + 2 ** 32);
  assert.equal(a.next(), b.next());
});

test('next(): значения в [0, 1)', () => {
  const rng = mulberry32(777);
  for (let i = 0; i < 10000; i++) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 1, `вне диапазона: ${v}`);
  }
});

test('int(n): целые в [0, n) с равномерным распределением', () => {
  const rng = mulberry32(2024);
  const n = 10;
  const draws = 20000;
  const buckets = new Array(n).fill(0);
  for (let i = 0; i < draws; i++) {
    const v = rng.int(n);
    assert.ok(Number.isInteger(v) && v >= 0 && v < n, `вне диапазона: ${v}`);
    buckets[v]++;
  }
  const expected = draws / n;
  for (let k = 0; k < n; k++) {
    assert.ok(
      Math.abs(buckets[k] - expected) < expected * 0.1,
      `корзина ${k}: ${buckets[k]} при ожидании ~${expected}`,
    );
  }
});

test('pick(arr): возвращает элемент массива, для пустого — undefined', () => {
  const rng = mulberry32(9);
  const arr = ['a', 'b', 'c', 'd'];
  for (let i = 0; i < 100; i++) assert.ok(arr.includes(rng.pick(arr)));
  assert.equal(rng.pick([]), undefined);
});

test('shuffle(arr): перестановка на месте, возвращает тот же массив', () => {
  const rng = mulberry32(42);
  const arr = Array.from({ length: 50 }, (_, i) => i);
  const result = rng.shuffle(arr);
  assert.equal(result, arr);
  assert.deepEqual([...arr].sort((x, y) => x - y), Array.from({ length: 50 }, (_, i) => i));
  assert.notDeepEqual(arr, Array.from({ length: 50 }, (_, i) => i));
});

test('shuffle(arr): детерминирован от seed и не смещён', () => {
  const a = mulberry32(100).shuffle([1, 2, 3, 4, 5, 6]);
  const b = mulberry32(100).shuffle([1, 2, 3, 4, 5, 6]);
  assert.deepEqual(a, b);

  // Каждый элемент должен попадать на каждую позицию примерно одинаково часто.
  const rng = mulberry32(31337);
  const m = 4;
  const counts = Array.from({ length: m }, () => new Array(m).fill(0));
  const runs = 8000;
  for (let i = 0; i < runs; i++) {
    const arr = rng.shuffle([0, 1, 2, 3]);
    for (let pos = 0; pos < m; pos++) counts[arr[pos]][pos]++;
  }
  const expected = runs / m;
  for (const row of counts) {
    for (const c of row) assert.ok(Math.abs(c - expected) < expected * 0.15, `смещение: ${c}`);
  }
});

test('hash32: детерминирован и возвращает uint32', () => {
  const h1 = hash32('roscherk', 'zip', 'campaign', 17);
  const h2 = hash32('roscherk', 'zip', 'campaign', 17);
  assert.equal(h1, h2);
  assert.ok(Number.isInteger(h1) && h1 >= 0 && h1 <= 0xffffffff);
  assert.equal(hash32(), 0x811c9dc5); // без частей — смещение FNV
});

test('hash32: чувствителен к разбиению, типу и порядку частей', () => {
  assert.notEqual(hash32('ab', 'c'), hash32('a', 'bc'));
  assert.notEqual(hash32(7), hash32('7'));
  assert.notEqual(hash32('a', 'b'), hash32('b', 'a'));
  assert.notEqual(hash32(1, 'zip'), hash32(2, 'zip'));
  assert.notEqual(hash32('2026-01-01'), hash32('2026-01-02'));
});

test('hash32: разброс по индексам (seed уровней не слипаются)', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(hash32(123456, 'flow', 'pool', i));
  assert.equal(seen.size, 1000);
});
