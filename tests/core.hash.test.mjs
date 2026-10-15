// Тесты src/core/hash.js: канонический JSON и contentId.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentId, canonicalJson } from '../src/core/hash.js';

test('canonicalJson: ключи отсортированы рекурсивно, массивы по порядку', () => {
  const s = canonicalJson({ b: [3, { z: 1, a: 2 }], a: 'x', c: null });
  assert.equal(s, '{"a":"x","b":[3,{"a":2,"z":1}],"c":null}');
});

test('canonicalJson: undefined в объекте опускается, в массиве — null', () => {
  assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
  assert.equal(canonicalJson([1, undefined]), '[1,null]');
});

test('contentId: 8 hex, не зависит от порядка ключей', () => {
  const a = contentId({ n: 4, path: [0, 1, 2, 3], marks: [[0, 1], [3, 2]], walls: [] });
  const b = contentId({ walls: [], marks: [[0, 1], [3, 2]], path: [0, 1, 2, 3], n: 4 });
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.equal(a, b);
});

test('contentId: разное содержимое — разные id', () => {
  const a = contentId({ n: 4, path: [0, 1, 2, 3] });
  const b = contentId({ n: 4, path: [0, 1, 3, 2] });
  assert.notEqual(a, b);
});

test('contentId: совпадает с sha1 канонической строки (стабилен между запусками)', () => {
  // Контрольное значение: printf '{"a":1}' | shasum → 9f89c740…
  assert.equal(contentId({ a: 1 }), '9f89c740');
});
