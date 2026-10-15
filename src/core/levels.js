// Данные уровней в рантайме (§4.7, §5.4): чтение из <script id="levels">, распаковка
// компактного кодирования и поиск уровня по id. Компактное кодирование применяет tools/build.mjs
// только когда levels.json > 400 КБ: массив клеток пути заменяется на { s: стартовая клетка,
// d: строка направлений 'RDLU' } (zip.path, flow.flows[i]). Кодирование без потерь.

const DIRS = { R: 1, L: -1, D: 'down', U: 'up' };

/** encodePath(cells, n) → { s, d }. */
export function encodePath(cells, n) {
  let d = '';
  for (let i = 1; i < cells.length; i++) {
    const diff = cells[i] - cells[i - 1];
    if (diff === 1) d += 'R';
    else if (diff === -1) d += 'L';
    else if (diff === n) d += 'D';
    else if (diff === -n) d += 'U';
    else throw new Error(`путь не 4-связный: ${cells[i - 1]} → ${cells[i]}`);
  }
  return { s: cells[0], d };
}

/** decodePath({s, d}, n) → [cellIdx…]. */
export function decodePath(packed, n) {
  if (Array.isArray(packed)) return packed;
  const out = [packed.s];
  let cur = packed.s;
  for (const ch of packed.d) {
    const step = DIRS[ch];
    cur += step === 'down' ? n : step === 'up' ? -n : step;
    out.push(cur);
  }
  return out;
}

/** Компактная форма всего levels.json (мутирует копию). */
export function compactLevels(data) {
  const out = JSON.parse(JSON.stringify(data));
  for (const [mode, sets] of Object.entries(out)) {
    if (mode === 'meta' || !sets || typeof sets !== 'object') continue;
    for (const list of Object.values(sets)) {
      if (!Array.isArray(list)) continue;
      for (const level of list) {
        if (Array.isArray(level.path) && typeof level.n === 'number') level.path = encodePath(level.path, level.n);
        if (Array.isArray(level.flows) && typeof level.n === 'number') {
          level.flows = level.flows.map((f) => (Array.isArray(f) ? encodePath(f, level.n) : f));
        }
      }
    }
  }
  out.meta = { ...(out.meta || {}), compact: true };
  return out;
}

/** Обратная распаковка; данные без meta.compact возвращаются как есть. */
export function decodeLevels(data) {
  if (!data || !data.meta || !data.meta.compact) return data;
  for (const [mode, sets] of Object.entries(data)) {
    if (mode === 'meta' || !sets || typeof sets !== 'object') continue;
    for (const list of Object.values(sets)) {
      if (!Array.isArray(list)) continue;
      for (const level of list) {
        if (level.path && !Array.isArray(level.path)) level.path = decodePath(level.path, level.n);
        if (Array.isArray(level.flows)) level.flows = level.flows.map((f) => decodePath(f, level.n));
      }
    }
  }
  return data;
}

/**
 * Прочитать уровни из вшитого <script type="application/json" id="levels">, уровни «Слов» (§2.5)
 * из <script id="words"> (→ levels.words) и «Карандаша» (§2.6) из <script id="draw"> (→ levels.draw).
 */
export function readEmbeddedLevels(doc = document) {
  const el = doc.getElementById('levels');
  let levels = { meta: {} };
  if (el) {
    try {
      levels = decodeLevels(JSON.parse(el.textContent));
    } catch (err) {
      console.error('levels.json не разобран', err);
      levels = { meta: {} };
    }
  }
  const drawEl = doc.getElementById('draw');
  if (drawEl) {
    try {
      const data = JSON.parse(drawEl.textContent);
      if (data && data.draw && typeof data.draw === 'object') levels.draw = data.draw;
    } catch (err) {
      console.error('draw.json не разобран', err);
    }
  }
  const wordsEl = doc.getElementById('words');
  if (wordsEl) {
    try {
      const data = JSON.parse(wordsEl.textContent);
      if (data && data.words && typeof data.words === 'object') levels.words = data.words;
    } catch (err) {
      console.error('words.json не разобран', err);
    }
  }
  return levels;
}

/** Наборы уровней режима с гарантированными массивами. */
export function modeSets(levels, modeId) {
  const sets = levels[modeId] || {};
  return {
    campaign: sets.campaign || [],
    pool: sets.pool || [],
    daily: sets.daily || [],
  };
}

/** findLevel(levels, modeId, id) → { level, kind, index } | null. */
export function findLevel(levels, modeId, id) {
  const sets = modeSets(levels, modeId);
  for (const kind of ['campaign', 'pool', 'daily']) {
    const index = sets[kind].findIndex((l) => l.id === id);
    if (index >= 0) return { level: sets[kind][index], kind, index };
  }
  return null;
}
