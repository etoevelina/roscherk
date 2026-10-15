// Хранилище localStorage, ключ roscherk.v1 (§3.3 спеки).
// Все чтения/записи в try/catch; битый JSON или чужая версия → чистое состояние.
// Функции чистые относительно переданного объекта storage, чтобы тестировать на фейке.

export const KEY = 'roscherk.v1';
export const VERSION = 1;

const DEFAULT_MODES = ['zip', 'flow', 'stroke'];

export function defaultSettings() {
  return {
    sound: true,
    theme: 'system',
    flowNumbers: false,
    installCardClosed: false,
    installReminderShown: false,
  };
}

/** Чистое состояние с пустыми секциями для перечисленных режимов. */
export function defaultState(modeIds = DEFAULT_MODES) {
  const progress = {};
  const skipped = {};
  const best = {};
  for (const id of modeIds) {
    progress[id] = {};
    skipped[id] = [];
    best[id] = 0;
  }
  best.mix = 0;
  return {
    v: VERSION,
    progress,
    skipped,
    current: null,
    settings: defaultSettings(),
    daily: { streak: 0, bestStreak: 0, lastDate: null, history: [] },
    endless: { best },
  };
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * normalize(raw, modeIds) → валидное состояние.
 * Неизвестная версия, не-объект или мусор → чистое состояние; известная версия — недостающие
 * поля дописываются, лишние и битые секции заменяются значениями по умолчанию.
 */
export function normalize(raw, modeIds = DEFAULT_MODES) {
  const clean = defaultState(modeIds);
  if (!isObject(raw) || raw.v !== VERSION) return clean;

  const out = clean;

  if (isObject(raw.progress)) {
    for (const [mode, levels] of Object.entries(raw.progress)) {
      if (!isObject(levels)) continue;
      const entry = {};
      for (const [id, rec] of Object.entries(levels)) {
        if (!isObject(rec)) continue;
        const bestMs = Number(rec.bestMs);
        entry[id] = {
          star: rec.star === true,
          bestMs: Number.isFinite(bestMs) && bestMs > 0 ? bestMs : 0,
        };
      }
      out.progress[mode] = entry;
    }
  }

  if (isObject(raw.skipped)) {
    for (const [mode, list] of Object.entries(raw.skipped)) {
      if (Array.isArray(list)) out.skipped[mode] = list.filter((x) => typeof x === 'string');
    }
  }

  if (isObject(raw.current) && typeof raw.current.mode === 'string' && typeof raw.current.levelId === 'string') {
    const c = raw.current;
    out.current = {
      kind: ['campaign', 'daily', 'endless'].includes(c.kind) ? c.kind : 'campaign',
      mode: c.mode,
      levelId: c.levelId,
      elapsedMs: Number.isFinite(Number(c.elapsedMs)) ? Math.max(0, Number(c.elapsedMs)) : 0,
      hintUsed: c.hintUsed === true,
      resets: Number.isFinite(Number(c.resets)) ? Math.max(0, Number(c.resets) | 0) : 0,
      startedAt: Number.isFinite(Number(c.startedAt)) ? Number(c.startedAt) : 0,
      state: c.state === undefined ? null : c.state,
    };
    if (isObject(c.endless)) {
      out.current.endless = {
        streak: Number.isFinite(Number(c.endless.streak)) ? Math.max(0, Number(c.endless.streak) | 0) : 0,
        modeChoice: typeof c.endless.modeChoice === 'string' ? c.endless.modeChoice : 'mix',
      };
    }
    if (typeof c.date === 'string') out.current.date = c.date;
  }

  if (isObject(raw.settings)) {
    const s = raw.settings;
    out.settings.sound = s.sound !== false;
    out.settings.theme = ['system', 'dark', 'light'].includes(s.theme) ? s.theme : 'system';
    out.settings.flowNumbers = s.flowNumbers === true;
    out.settings.installCardClosed = s.installCardClosed === true;
    out.settings.installReminderShown = s.installReminderShown === true;
  }

  if (isObject(raw.daily)) {
    const d = raw.daily;
    const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v) | 0) : 0);
    out.daily.streak = num(d.streak);
    out.daily.bestStreak = Math.max(num(d.bestStreak), out.daily.streak);
    out.daily.lastDate = typeof d.lastDate === 'string' ? d.lastDate : null;
    out.daily.history = Array.isArray(d.history)
      ? d.history.filter((x) => typeof x === 'string').slice(-60)
      : [];
  }

  if (isObject(raw.endless) && isObject(raw.endless.best)) {
    for (const [k, v] of Object.entries(raw.endless.best)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) out.endless.best[k] = n | 0;
    }
  }

  return out;
}

/** load(storage, modeIds) → состояние; любая ошибка → чистое состояние. */
export function load(storage, modeIds = DEFAULT_MODES) {
  let raw = null;
  try {
    const text = storage?.getItem(KEY);
    if (text) raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  return normalize(raw, modeIds);
}

/** save(state, storage) → true при успехе. Ошибки (квота, приватный режим) глотаются. */
export function save(state, storage) {
  try {
    storage?.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clear(storage) {
  try {
    storage?.removeItem(KEY);
  } catch {
    /* игнорируем */
  }
}

// --- Код прогресса (base64 от JSON в UTF-8) ---------------------------------------------

function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function exportCode(state) {
  const json = JSON.stringify({ ...state, current: null });
  return bytesToBase64(new TextEncoder().encode(json));
}

/** importCode(code, modeIds) → нормализованное состояние или null, если код не разобрать. */
export function importCode(code, modeIds = DEFAULT_MODES) {
  try {
    const trimmed = String(code).replace(/\s+/g, '');
    if (!trimmed) return null;
    const json = new TextDecoder().decode(base64ToBytes(trimmed));
    const raw = JSON.parse(json);
    if (!isObject(raw) || raw.v !== VERSION) return null;
    return normalize(raw, modeIds);
  } catch {
    return null;
  }
}
