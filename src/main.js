// Точка входа оболочки: объект app, роутер экранов без History API (§4.1), тема, звук,
// хранилище, Service Worker, оверлей «Поверни телефон». Режимы — только через реестр и §5.1.
import { MODES, MODE_BY_ID, MODE_IDS } from './modes/index.js';
import { readEmbeddedLevels, modeSets } from './core/levels.js';
import { load, save, normalize } from './core/storage.js';
import { createAudio } from './core/audio.js';
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

const BUILD_HASH = '__CONTENT_HASH__';
const DEV_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

function createApp() {
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
    modeById: MODE_BY_ID,
    audio,
    overlays,
    buildHash: BUILD_HASH.startsWith('__') ? 'dev' : BUILD_HASH,
    dev: DEV_HOSTS.includes(location.hostname) || location.protocol === 'file:',
    isStandalone: navigator.standalone === true || matchMedia('(display-mode: standalone)').matches,
    endlessUsed: new Set(),

    modeSets: (modeId) => modeSets(levels, modeId),
    dailyPoolSize() {
      return Math.max(1, ...MODES.map((m) => modeSets(levels, m.id).daily.length));
    },
    today: () => localDateString(new Date()),
    reducedMotion: () => reducedMq.matches,
    isLandscape: () => landscapeMq.matches,

    save() {
      save(app.state, storage);
    },
    replaceState(next) {
      app.state = normalize(next, MODE_IDS);
      app.save();
      app.applyTheme();
    },

    /**
     * Применить настройку темы к документу и перечитать объект theme. Акцент режима живёт только
     * в объекте theme и в --mode-color игрового экрана; --accent на :root не трогаем — иначе инлайн
     * побеждал бы CSS темы и цвет последнего режима «прилипал» к главному экрану и настройкам.
     */
    applyTheme() {
      const id = applyTheme(app.state.settings.theme);
      themeObj = readTheme(document.documentElement, modeAccent(currentMode, id));
      setThemeColorMeta(currentMode ? themeObj.accent : themeObj.bg);
      for (const cb of themeListeners) cb(themeObj);
      return themeObj;
    },
    /** Тема с акцентом режима (для игрового экрана). Возвращает объект theme §4.4. */
    applyModeTheme(mode) {
      currentMode = mode;
      const id = applyTheme(app.state.settings.theme);
      themeObj = readTheme(document.documentElement, modeAccent(mode, id));
      setThemeColorMeta(mode ? themeObj.accent : themeObj.bg);
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
      const pick = pickDaily(today, MODE_IDS, app.dailyPoolSize());
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
      for (const id of MODE_IDS) pools[id] = modeSets(levels, id).pool;
      const used = new Set(app.endlessUsed);
      if (excludeId) used.add(excludeId);
      const choice = MODE_IDS.includes(modeChoice) ? modeChoice : MODES.length > 1 ? MIX : MODE_IDS[0];
      const picked = pickEndlessLevel({
        pools,
        modeIds: MODE_IDS,
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
    levels: mountLevels,
    game: mountGame,
    settings: mountSettings,
    campaignDone: mountCampaignDone,
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
  app.go('home');
  return app;
}

/** Service Worker (§4.6): не на localhost, под try/catch (file:// открывается без офлайна). */
function registerServiceWorker(app) {
  try {
    if (!('serviceWorker' in navigator)) return;
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
registerServiceWorker(app);
if (app.dev) window.__roscherk = app;
