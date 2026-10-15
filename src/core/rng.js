// Детерминированный ГПСЧ и хэш для генераторов уровней (§5.6 спеки).
// Единственный разрешённый источник случайности в генераторах: ни системное время, ни встроенный ГПСЧ.
// Любой результат зависит только от seed и порядка вызовов.

/**
 * mulberry32 — быстрый 32-битный ГПСЧ с хорошим распределением.
 * seed — любое число; берётся как uint32 (seed >>> 0).
 * Возвращает объект:
 *   next()      → число в [0, 1)
 *   int(n)      → целое в [0, n) (n > 0, целое)
 *   pick(arr)   → случайный элемент массива (undefined для пустого)
 *   shuffle(arr) → Фишер–Йетс на месте; возвращает тот же массив
 */
export function mulberry32(seed) {
  let a = seed >>> 0;

  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (n) => Math.floor(next() * n);

  const pick = (arr) => (arr.length === 0 ? undefined : arr[int(arr.length)]);

  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = int(i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  };

  return { next, int, pick, shuffle };
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

// Буфер для побайтовой записи чисел (float64, little-endian) — числа хэшируются
// по своему двоичному представлению, а не по строке, поэтому 1 и "1" дают разные хэши.
const numberView = new DataView(new ArrayBuffer(8));

/**
 * hash32(...parts) — FNV-1a 32-бит по последовательности частей.
 * Части — строки или числа (остальное приводится к строке). Между частями добавляется
 * байт-разделитель и байт типа, поэтому ("ab","c") ≠ ("a","bc"), а 7 ≠ "7".
 * Возвращает uint32. Детерминирован, не зависит от платформы.
 * Используется для seed уровня = hash32(masterSeed, mode, kind, index) и для «Ежедневной».
 */
export function hash32(...parts) {
  let h = FNV_OFFSET;
  const feed = (byte) => {
    h ^= byte & 0xff;
    h = Math.imul(h, FNV_PRIME);
  };

  for (const part of parts) {
    if (typeof part === 'number') {
      feed(0x01);
      numberView.setFloat64(0, part, true);
      for (let i = 0; i < 8; i++) feed(numberView.getUint8(i));
    } else {
      const s = typeof part === 'string' ? part : String(part);
      feed(typeof part === 'string' ? 0x02 : 0x03);
      for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        feed(code);
        feed(code >>> 8);
      }
    }
    feed(0x1f); // разделитель частей
  }
  return h >>> 0;
}
