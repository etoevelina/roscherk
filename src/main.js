// Точка входа оболочки: объект app, роутер экранов без History API (§4.1), тема, звук,
// хранилище, Service Worker, оверлей «Поверни телефон». Режимы — только через реестр и §5.1.
import { MODES, MODE_BY_ID, MODE_IDS, ROTATION_MODES, ROTATION_IDS } from './modes/index.js';
import { readEmbeddedLevels, modeSets } from './core/levels.js';
import { load, save, normalize } from './core/storage.js';
import { createAudio, setHaptics } from './core/audio.js';
import { applyTheme, readTheme, watchSystemTheme, modeAccent, setThemeColorMeta } from './core/theme.js';
import { t } from './core/i18n.js';
import { localDateString, pickDaily } from './core/daily.js';
import { pickEndlessLevel, MIX } from './core/endless.js';
import { hash32 } from './core/rng.js';
import { createOverlays } from './ui/overlays.js';
import { mountHome } from './ui/home.js';
import { mountLevels } from './ui/levels.js';
import { mountGame } from './ui/game.js';
import { mountSettings } from './ui/settings.js';
import { mountCampaignDone } from './ui/win.js';
// WORDS (docs/DESIGN.md): онбординг, вкладки «Режимы», «Ежедневная», «Статистика», профиль,
// специальные возможности, «Испытания», темы «Слов».
import { mountOnboarding } from './ui/onboarding.js';
import { mountPacks, mountWordPacks } from './ui/packs.js';
import { mountDaily } from './ui/daily.js';
import { mountStats } from './ui/stats.js';
import { mountA11y } from './ui/a11y.js';
import { mountChallenges } from './ui/challenges.js';
// Нативная оболочка: tools/build.mjs --native подставляет импорт src/native.js, в вебе — заглушка.
import { setupNative } from '__NATIVE_MODULE__';

const BUILD_HASH = '__CONTENT_HASH__';
const DEV_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
/**
 * Нативная оболочка (Capacitor, сборка для App Store): страница отдаётся с capacitor://localhost,
 * поэтому это не «dev», приложение уже «установлено» (без карточки «На экран Домой»), Service
 * Worker не нужен. Мост Capacitor внедряется до скриптов страницы.
 */
const NATIVE = (() => {
  try {
    return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  } catch {
    return false;
  }
})();

function createApp() {
  // Оформление Lumin для всего приложения (§4.4): тосты, шторки, диалоги в #overlays.
  document.body.classList.add('lumin-on');
  const root = document.getElementById('app');
  const overlaysRoot = document.getElementById('overlays');
  const levels = readEmbeddedLevels(document);
  const storage = (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();

  const state = load(storage, MODE_IDS);
  const audio = createAudio(() => app.state.settings.sound);
  const overlays = createOverlays(overlaysRoot);
  const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
  // Ландшафт блокирует ввод только на устройствах с сенсорным экраном (на Mac окно часто шире высоты).
  const landscapeMq = matchMedia('(orientation: landscape) and (pointer: coarse)');
  const themeListeners = new Set();
  let themeObj = null;
  let currentMode = null;
  let screen = null;

  const app = {
    state,
    levels,
    modes: MODES,
    /** Режимы Ежедневной и Бесконечности (§3.2; «Слова» — только кампания, §2.5). */
    rotationModes: ROTATION_MODES,
    modeById: MODE_BY_ID,
    audio,
    overlays,
    buildHash: BUILD_HASH.startsWith('__') ? 'dev' : BUILD_HASH,
    native: NATIVE,
    dev: !NATIVE && (DEV_HOSTS.includes(location.hostname) || location.protocol === 'file:'),
    isStandalone: NATIVE || navigator.standalone === true || matchMedia('(display-mode: standalone)').matches,
    endlessUsed: new Set(),

    modeSets: (modeId) => modeSets(levels, modeId),
    dailyPoolSize() {
      return Math.max(1, ...ROTATION_MODES.map((m) => modeSets(levels, m.id).daily.length));
    },
    today: () => localDateString(new Date()),
    // Меньше движения: системная настройка или своя в «Специальных возможностях».
    reducedMotion: () => reducedMq.matches || app.state.settings.a11y?.reduceMotion === true,
    isLandscape: () => landscapeMq.matches,

    save() {
      save(app.state, storage);
    },
    replaceState(next) {
      app.state = normalize(next, MODE_IDS);
      app.save();
      app.applyTheme();
      app.applyA11y();
    },

    /** Специальные возможности → классы <body> и вибрация (docs/DESIGN.md). */
    applyA11y() {
      const a = app.state.settings.a11y || {};
      document.body.classList.toggle('a11y-large', a.largeText === true);
      document.body.classList.toggle('a11y-motion', a.reduceMotion === true);
      document.body.classList.toggle('a11y-contrast', a.contrastNumbers === true);
      setHaptics(a.haptics !== 'off');
    },

    /**
     * Применить настройку темы к документу и перечитать объект theme. Акцент режима живёт только
     * в объекте theme и в --mode-color игрового экрана; --accent на :root не трогаем — иначе инлайн
     * побеждал бы CSS темы и цвет последнего режима «прилипал» к главному экрану и настройкам.
     */
    applyTheme() {
      const id = applyTheme(app.state.settings.theme);
      themeObj = readTheme(document.documentElement, modeAccent(currentMode, id));
      setThemeColorMeta(themeObj.bg); // Lumin: шапки цвета фона на всех экранах (§4.4)
      for (const cb of themeListeners) cb(themeObj);
      return themeObj;
    },
    /** Тема с акцентом режима (для игрового экрана). Возвращает объект theme §4.4. */
    applyModeTheme(mode) {
      currentMode = mode;
      const id = applyTheme(app.state.settings.theme);
      themeObj = readTheme(document.documentElement, modeAccent(mode, id));
      setThemeColorMeta(themeObj.bg);
      return themeObj;
    },
    onThemeChange(cb) {
      themeListeners.add(cb);
      return () => themeListeners.delete(cb);
    },
    theme: {
      get id() {
        return themeObj?.id || 'dark';
      },
      get obj() {
        return themeObj;
      },
      accentOf(mode) {
        return modeAccent(mode, themeObj?.id || 'dark') || themeObj?.accent || '#4f8cff';
      },
    },

    /** Роутер без History API: экран заменяется на месте, URL не меняется. */
    go(name, params = {}) {
      screen?.destroy();
      screen = null;
      root.replaceChildren();
      if (name !== 'game') app.applyModeTheme(null);
      const mount = SCREENS[name] || SCREENS.home;
      screen = mount(app, params);
      root.appendChild(screen.el);
    },

    startDaily() {
      const today = app.today();
      const pick = pickDaily(today, ROTATION_IDS, app.dailyPoolSize());
      const level = modeSets(levels, pick.mode).daily[pick.index];
      if (!level) {
        overlays.toast(t('noLevels'));
        return;
      }
      app.go('game', { kind: 'daily', modeId: pick.mode, levelId: level.id, date: today });
    },

    /** Следующий уровень Бесконечности для серии streak; excludeId — только что пропущенный. */
    startEndless(modeChoice, streak, excludeId = null) {
      const pools = {};
      for (const id of ROTATION_IDS) pools[id] = modeSets(levels, id).pool;
      const used = new Set(app.endlessUsed);
      if (excludeId) used.add(excludeId);
      const choice = ROTATION_IDS.includes(modeChoice) ? modeChoice : ROTATION_IDS.length > 1 ? MIX : ROTATION_IDS[0];
      const picked = pickEndlessLevel({
        pools,
        modeIds: ROTATION_IDS,
        modeChoice: choice,
        streak,
        usedIds: used,
        seed: hash32(Date.now(), used.size),
      });
      if (!picked) {
        overlays.toast(t('noLevels'));
        return;
      }
      app.endlessUsed.add(picked.level.id);
      app.go('game', { kind: 'endless', modeId: picked.mode, levelId: picked.level.id, endless: { streak, modeChoice: choice } });
    },
  };

  const SCREENS = {
    home: mountHome,
    levels: mountLevels, // карта уровней режима (или темы «Слов»: params.pack)
    game: mountGame,
    settings: mountSettings, // профиль и настройки
    profile: mountSettings,
    campaignDone: mountCampaignDone,
    onboarding: mountOnboarding,
    packs: mountPacks, // вкладка «Режимы»
    wordPacks: mountWordPacks, // темы «Слов»
    daily: mountDaily, // вкладка «Ежедневная»
    stats: mountStats, // вкладка «Статистика»
    a11y: mountA11y,
    challenges: mountChallenges, // «Испытания»: Бесконечность
  };

  // Системная тема → перечитать объект theme (экран игры подписан через onThemeChange).
  watchSystemTheme(() => app.applyTheme());
  app.applyTheme();

  // Ориентация: оверлей блокирует ввод, состояние не теряется.
  const onOrientation = () => overlays.setRotate(landscapeMq.matches);
  landscapeMq.addEventListener?.('change', onOrientation);
  onOrientation();

  // Звук (§4.5): контекст создаётся в первом pointerdown пользователя — где бы он ни случился
  // (кнопки главного экрана и настроек тоже), на каждом следующем — resume(); и при возврате на вкладку.
  document.addEventListener('pointerdown', () => audio.unlock(), { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') audio.resume();
  });

  // Current восстанавливается при входе в тот же уровень; стартуем всегда с главного.
  if (app.state.current && app.state.current.kind === 'endless' && app.state.current.levelId) {
    app.endlessUsed.add(app.state.current.levelId);
  }
  // Разработка (localhost): ?demo=1 — демо-прогресс, ?theme=dark|light, ?screen=stats&mode=zip&level=3
  // — сразу открыть экран (для скриншотов tools/shot.mjs). В вебе на GitHub Pages и в App Store не работает.
  const devParams = app.dev ? new URLSearchParams(location.search) : null;
  if (devParams?.get('demo')) app.state = normalize(demoState(app), MODE_IDS);
  if (devParams?.get('theme')) app.state.settings.theme = devParams.get('theme');
  if (devParams?.get('theme') || devParams?.get('demo')) app.applyTheme();
  app.applyA11y();
  if (devParams?.get('screen')) {
    const name = devParams.get('screen');
    const modeId = devParams.get('mode') || 'zip';
    const params = { modeId, pack: devParams.get('pack') || undefined, filter: devParams.get('filter') || undefined };
    if (name === 'game') {
      const list = modeSets(levels, modeId).campaign;
      const lv = list[Math.max(0, Math.min(list.length - 1, Number(devParams.get('level') || 1) - 1))];
      if (lv) app.go('game', { kind: 'campaign', modeId, levelId: lv.id, dev: devParams.get('dev') || undefined });
    } else app.go(name, params);
    return app;
  }
  // Онбординг (docs/DESIGN.md) — только при первом запуске; кто уже играл, его не видит.
  const played = Object.values(app.state.progress).some((p) => p && Object.keys(p).length) || !!app.state.daily.lastDate;
  if (!app.state.settings.onboarded && played) {
    app.state.settings.onboarded = true;
    app.save();
  }
  app.go(app.state.settings.onboarded ? 'home' : 'onboarding');
  return app;
}

/** Service Worker (§4.6): не на localhost, под try/catch (file:// открывается без офлайна). */
/** Демо-состояние для разработки (?demo=1): прогресс, звёзды, активность, серия, имя. */
function demoState(app) {
  const st = { v: 1, progress: {}, skipped: {}, current: null, endless: { best: { mix: 14, zip: 9 } } };
  const counts = { zip: 12, flow: 7, stroke: 4, words: 6, draw: 3 };
  for (const m of app.modes) {
    const list = app.modeSets(m.id).campaign;
    st.progress[m.id] = {};
    list.slice(0, counts[m.id] || 0).forEach((lv, i) => {
      const stars = 1 + ((i * 7) % 3);
      st.progress[m.id][lv.id] = { star: stars === 3, bestMs: 30000 + i * 4100, stars };
    });
  }
  const today = app.today();
  const day = (k) => {
    const d = new Date();
    d.setDate(d.getDate() - k);
    return localDateString(d);
  };
  st.activity = {};
  for (let k = 0; k < 40; k++) if (k % 5 !== 3) st.activity[day(k)] = 1 + ((k * 5) % 6);
  st.daily = { streak: 12, bestStreak: 15, lastDate: day(1), history: Array.from({ length: 12 }, (_, k) => day(k + 1)).reverse() };
  st.settings = { ...app.state.settings, onboarded: true, name: 'Евелина', installCardClosed: true, introSeen: ['words', 'draw'] };
  void today;
  return st;
}

function registerServiceWorker(app) {
  try {
    if (NATIVE || !('serviceWorker' in navigator)) return;
    if (DEV_HOSTS.includes(location.hostname) || location.protocol !== 'https:') return;
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          // Первая установка (страницей ещё никто не управляет) — не обновление: без тоста.
          // Проверяем controller в момент события: промис register() резолвится раньше updatefound.
          if (!worker || !navigator.serviceWorker.controller) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed') {
              app.overlays.toast(t('updateAvailable'), {
                duration: 0,
                key: 'update',
                dismissible: true,
                action: { label: t('restart'), onClick: () => location.reload() },
              });
            }
          });
        });
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch(() => {});
  } catch {
    /* без офлайна */
  }
}

const app = createApp();
setupNative();
registerServiceWorker(app);
if (app.dev) window.__roscherk = app;
