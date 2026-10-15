// Идентификатор содержимого уровня (§2.0, §5.6 спеки). Только для Node (tools/generate.mjs,
// tools/verify.mjs): использует node:crypto и не должен попадать в браузерный бандл.
import { createHash } from 'node:crypto';

/**
 * canonicalJson(value) → строка: JSON с рекурсивно отсортированными ключами объектов.
 * Массивы сохраняют порядок; поля со значением undefined опускаются (как в JSON.stringify).
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',') + ']';
  }
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

/**
 * contentId(obj) → 8 hex-символов: первые 8 символов sha1 от канонического JSON.
 * Служебные поля (id, seed, chapter, difficulty, tip) вызывающий убирает сам перед вызовом.
 */
export function contentId(obj) {
  return createHash('sha1').update(canonicalJson(obj), 'utf8').digest('hex').slice(0, 8);
}
