// Экран игры (§3.1 п.3–4, §2.1, §3.3, §4.1–4.3). Оболочка общается с режимом только через
// контракт §5.1: create/serialize/layout/render/pointer/isSolved/reset/hint/stats/perfect/ghost/
// nextLabel/footer. Здесь — холст, ввод, таймер, undo, подсказка, сброс, пропуск, current, победа.
import { h, icon } from './dom.js';
import { t, tr } from '../core/i18n.js';
import { createCanvas, createRenderLoop, boardRect, createFrameBudget } from '../core/canvas.js';
import { createPointerTracker, attachPointer } from '../core/input.js';
import { vibrate } from '../core/audio.js';
import { createConfetti } from '../core/particles.js';
import { createGhost, pulse } from '../core/anim.js';
import { findLevel } from '../core/levels.js';
import {
  startAttempt,
  starFor,
  recordWin,
  recordSkip,
  skipAvailable,
  hintShouldPulse,
  createTimer,
  createUndoStack,
  doneCount,
  isDone,
  levelStatuses,
} from '../core/progress.js';
import { recordDailyWin } from '../core/daily.js';
import { updateBest, createStreakTracker } from '../core/endless.js';
import { buildWinOverlay } from './win.js';

const HINT_ARM_MS = 2000;
/** Статистика попытки, которую undo не откатывает (§2.1): тупики stroke, подсказки и вводы «Слов». */
const ATTEMPT_STATS = ['deadEnds', 'hints', 'ent', 'bad'];
const RESET_TOAST_MS = 5000;
const CONFETTI_MS = 1200;
const CONFETTI_STRONG_MS = 1800;
const FRAME_BUDGET_MS = 4;
const FRAME_WARMUP = 3; // кадров без предупреждения о бюджете после смены уровня/темы/размера

const now = () => performance.now();

export function mountGame(app, params) {
  const { state } = app;
  const mode = app.modeById[params.modeId];
  const found = mode ? findLevel(app.levels, params.modeId, params.levelId) : null;
  if (!found) {
    // Уровня нет в этой сборке (замена уровня = новый id, чужой код прогресса): current на него
    // обнуляем, иначе «Продолжить» зациклится на этом тосте.
    if (state.current && state.current.mode === params.modeId && state.current.levelId === params.levelId) {
      state.current = null;
      app.save();
    }
    app.overlays.toast(t('noLevels'));
    queueMicrotask(() => app.go('home'));
    return { el: h('div', { class: 'screen' }), destroy() {} };
  }
  const { level, index: levelIndex } = found;
  const kind = params.kind;
  const campaign = app.modeSets(mode.id).campaign;
  const isCampaign = kind === 'campaign';
  const isEndless = kind === 'endless';
  const isDaily = kind === 'daily';

  let theme = app.applyModeTheme(mode);

  // --- Восстановление незавершённой партии ---------------------------------------------
  const cur = state.current;
  const resume = !!cur && cur.kind === kind && cur.mode === mode.id && cur.levelId === level.id;
  let gameState = mode.create(level, resume && cur.state ? cur.state : undefined);
  const t0 = now();
  const attempt = resume
    ? { hintUsed: cur.hintUsed, resets: cur.resets, startedAt: cur.startedAt || Date.now(), lastChangeAt: t0 }
    : startAttempt(t0);
  if (!resume) attempt.startedAt = Date.now();
  if (resume && gameState.hintUsed) attempt.hintUsed = true;
  const timer = createTimer(resume ? cur.elapsedMs : 0);
  const undo = createUndoStack();
  const endlessInfo = isEndless ? { ...(params.endless || cur?.endless || { streak: 0, modeChoice: mode.id }) } : null;
  // Серия Бесконечности: живое значение + значение для «Повторить»; обрыв обнуляет оба (§3.2).
  const streak = endlessInfo ? createStreakTracker(endlessInfo.streak) : null;
  const dailyDate = isDaily ? params.date || cur?.date || app.today() : null;

  let won = false;
  let ended = false; // партия завершена (победа или пропуск): current больше не пишется
  let destroyed = false;
  let layout = null;
  let strokeActive = false; // режиму доставлен down, up ещё не было
  let strokeSnapshot = null;
  let strokeChanged = false;
  let strokeSteps = 0;
  let appeared = false; // состояние получено undo/restore: анимацию появления не повторять
  let hintArmedUntil = 0;
  let confetti = null;
  let winAt = 0;
  let ghost = null;
  let ghostStart = 0;
  let ghostDismissed = resume; // обучение — до первого касания (§3.1 п.7)
  // Партия «тронута» (было касание, клавиша, undo, сброс, подсказка) или продолжена: только тогда
  // она записывается в current. Иначе просто открытый и закрытый уровень затирал бы начатую партию
  // другого уровня (слот current один, §3.3). Бесконечность пишет current всегда (серия).
  let touched = resume;
  let introOpen = Array.isArray(mode.intro) && mode.intro.length > 0 && !(state.settings.introSeen || []).includes(mode.id);
  let ghostTimer = null;
  let pendingHint = null; // подсказка kind:'rollback' с кнопкой «Укоротить до неё» (zip)
  let hintToast = null;
  let armToast = null;

  // --- DOM -------------------------------------------------------------------------------
  const isDom = !!mode.dom; // §2.5: режим рисует себя DOM-разметкой (view), холста нет
  const lumin = mode.skin === 'lumin'; // оформление по дизайн-системе Lumin (§2.5)
  const titleText = isCampaign
    ? typeof mode.titleFor === 'function'
      ? tr(mode.titleFor(level, levelIndex, campaign))
      : `${tr(mode.name)} · ${levelIndex + 1}`
    : isDaily
      ? `${t('daily')} · ${tr(mode.name)}`
      : `${t('endless')} · ${tr(mode.name)}`;
  const subEl = h('span', { class: 'sub' });
  const board = h('div', { class: 'board' });
  const tipEl = h('div', { class: 'tip' });
  const footerEl = h('span', { class: 'footer-text' });
  const undoBtn = barButton('undo', t('undo'), () => doUndo());
  const resetBtn = barButton('reset', t('reset'), () => doReset());
  const hintBtn = barButton('hint', t('hint'), () => doHint());
  const skipBtn = barButton('skip', t('skip'), () => doSkip());
  skipBtn.classList.add('skip');
  skipBtn.style.display = 'none';

  const tip = level.tip ? tr(level.tip) : isCampaign && levelIndex < 3 ? tr(mode.helpText) : '';
  tipEl.textContent = tip;
  // Режим с клавиатурой (§2.5): место по высоте дорого — пустая строка совета не занимает его.
  if (mode.keyboard && !tip) tipEl.style.display = 'none';
  const kbd = mode.keyboard ? buildKeyboard((k) => onKey(k)) : null;
  // Тосты над клавиатурой перекрывали бы клавиши — с клавиатурой они показываются сверху.
  if (kbd) document.body.classList.add('kbd-open');

  // Lumin: подсказка — круглая кнопка в шапке, нижняя строка — тихие «Отменить · Сбросить · слов 3/7».
  const topHint = lumin
    ? h('button', { class: 'icon-btn round', 'aria-label': t('hint'), onClick: () => (app.audio.tap(), doHint()) }, icon('hint'))
    : null;
  const el = h(
    'div',
    { class: `screen game-screen${lumin ? ' lumin' : ''}${isDom ? ' dom' : ''}`, style: { '--mode-color': theme.accent } },
    h(
      'div',
      { class: 'topbar accent' },
      h('button', { class: `icon-btn${lumin ? ' round' : ''}`, 'aria-label': t('back'), onClick: () => app.go('home') }, icon('back')),
      h('span', { class: 'title', text: titleText }),
      topHint || subEl,
    ),
    board,
    tipEl,
    h('div', { class: 'bottombar' }, undoBtn, resetBtn, lumin ? null : hintBtn, skipBtn, footerEl),
    kbd,
  );
  if (lumin) document.body.classList.add('lumin-on');

  function barButton(name, label, onClick) {
    return h(
      'button',
      {
        class: 'bar-btn',
        onClick: () => {
          app.audio.tap();
          // Кнопка нажата вторым пальцем посреди росчерка: сначала штатно завершаем росчерк
          // (снимок в undo, current), иначе действие подменит состояние под активным drag режима.
          if (tracker.active) {
            const end = tracker.abort();
            if (end) onPointer(end);
          }
          onClick();
        },
      },
      icon(name),
      h('span', { text: label }),
    );
  }

  // --- Холст и рендер --------------------------------------------------------------------
  // Цикл рендера объявлен до холста: createCanvas измеряет контейнер синхронно и зовёт invalidate().
  const loop = createRenderLoop((tt) => {
    if (destroyed) return false;
    if (isDom) {
      try {
        view.update(gameState, { t: tt, reducedMotion: app.reducedMotion(), won });
      } catch (err) {
        console.error('view режима упал', err);
      }
      return false;
    }
    if (!layout) return false;
    cv.begin();
    const ctx = cv.ctx;
    const started = app.dev ? now() : 0;
    let more = false;
    try {
      more = mode.render(ctx, gameState, layout, theme, tt, renderOpts()) === true;
    } catch (err) {
      console.error('render режима упал', err);
    }
    if (ghost && !won) more = drawGhost(ctx, tt) || more;
    if (won) more = drawWinFx(ctx, tt) || more;
    if (app.dev) {
      const dt = now() - started;
      if (frameBudget.check(dt)) console.warn(`кадр ${dt.toFixed(1)} мс > ${FRAME_BUDGET_MS} мс`);
    }
    return more;
  });
  // Первые кадры после открытия уровня, смены темы или размера строят статический слой и играют
  // появление — это не проблема производительности, предупреждение для них не выводим.
  const frameBudget = createFrameBudget(FRAME_BUDGET_MS, FRAME_WARMUP);

  // DOM-режим (§2.5): вид сам следит за размером; тапы приходят как api.tap(target).
  const view = isDom
    ? mode.view(board, { tap: (target) => onTap(target), invalidate: () => loop.invalidate(), reducedMotion: () => app.reducedMotion() })
    : null;
  const cv = isDom
    ? null
    : createCanvas(board, (rect) => {
        frameBudget.reset();
        relayout(rect);
        loop.invalidate();
      });

  /**
   * Пересчёт layout; rect передаётся явно, пока cv ещё создаётся (синхронный первый замер).
   * Поле поднято к верху холста (boardRect): при победе оверлей снизу не закрывает нижние ряды.
   */
  function relayout(rect = cv ? cv.rect() : null) {
    if (isDom || !rect || rect.w < 2 || rect.h < 2) return;
    layout = mode.layout(gameState, boardRect(rect), theme);
    // Призрак обучения: уровень 1 режима, до первого касания; после касания не возвращается
    // ни при смене размера/темы, ни после undo. Смена layout лишь пересчитывает его точки.
    if (!isCampaign || levelIndex !== 0 || ghostDismissed || won) return;
    const pts = mode.ghost(level, layout);
    if (!ghost) {
      ghost = createGhost(pts);
      ghostStart = now();
    } else {
      ghost = createGhost(pts) || ghost;
    }
  }

  const renderOpts = () => ({ reducedMotion: app.reducedMotion(), flowNumbers: state.settings.flowNumbers, appeared });

  function dismissGhost() {
    ghostDismissed = true;
    ghost = null;
    if (ghostTimer) {
      clearTimeout(ghostTimer);
      ghostTimer = null;
    }
  }

  /** Кадр призрака; в паузе между повторами rAF-цикл не держим — кадр заказывается таймером (§4.3). */
  function drawGhost(ctx, tt) {
    const g = ghost.at(tt, ghostStart);
    if (!g) {
      if (!ghostTimer) {
        ghostTimer = setTimeout(() => {
          ghostTimer = null;
          if (!destroyed && ghost) loop.invalidate();
        }, ghost.nextStart(tt, ghostStart) + 1);
      }
      return false;
    }
    const pts = ghost.points;
    ctx.save();
    ctx.globalAlpha = 0.35 * g.alpha;
    ctx.strokeStyle = theme.accent;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(6, (layout.cell || 30) * 0.3);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    const total = g.progress * (pts.length - 1);
    for (let i = 1; i < pts.length; i++) {
      if (i <= total) ctx.lineTo(pts[i].x, pts[i].y);
      else {
        ctx.lineTo(g.x, g.y);
        break;
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 0.8 * g.alpha;
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(g.x, g.y, Math.max(8, (layout.cell || 30) * 0.22), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return true;
  }

  function drawWinFx(ctx, tt) {
    if (app.reducedMotion()) return false;
    const dt = tt - winAt;
    const dur = confetti ? confetti.dur : CONFETTI_MS;
    let more = false;
    if (dt < dur) {
      // «Сияние» поля — пульс цвета режима поверх холста.
      const rect = cv.rect();
      ctx.save();
      ctx.globalAlpha = 0.08 + 0.1 * pulse(tt, 400, winAt);
      ctx.fillStyle = theme.accent;
      ctx.fillRect(0, 0, rect.w, rect.h);
      ctx.restore();
      more = true;
    }
    if (confetti && confetti.draw(ctx, tt)) more = true;
    return more;
  }

  // --- Ввод ------------------------------------------------------------------------------
  const tracker = createPointerTracker();
  const detachInput = cv ? attachPointer(cv.canvas, tracker, onPointer, { onRawDown: () => app.audio.unlock() }) : () => {};

  function onPointer(ev) {
    if (destroyed || !layout) return;
    const finishing = ev.type === 'up' || ev.type === 'cancel';
    if (won || app.isLandscape()) {
      // Ввод заблокирован (победа, ландшафт), но начатый росчерк завершаем как up (§4.1):
      // режим закрывает drag, снимок попадает в undo, состояние сохраняется.
      if (!finishing || !strokeActive) return;
    }
    if (ev.type === 'down') {
      dismissGhost();
      strokeActive = true;
      strokeSnapshot = mode.serialize(gameState);
      strokeChanged = false;
      strokeSteps = 0;
    }
    let events = [];
    try {
      events = mode.pointer(gameState, layout, ev) || [];
    } catch (err) {
      console.error('pointer режима упал', err);
    }
    handleEvents(events);
    if (finishing) {
      touched = true;
      strokeActive = false;
      if (strokeChanged && strokeSnapshot) undo.push(strokeSnapshot);
      strokeSnapshot = null;
      strokeChanged = false;
      saveCurrent();
    }
    loop.invalidate();
  }

  /**
   * Клавиша экранной/физической клавиатуры (§2.5): снимок до нажатия, изменившая поле клавиша —
   * отдельный шаг undo; смена выделения шагом не считается. Начатый росчерк сначала завершается.
   */
  function onKey(k) {
    if (destroyed || (!layout && !isDom) || won || ended || app.isLandscape() || typeof mode.key !== 'function') return;
    if (tracker.active) {
      const end = tracker.abort();
      if (end) onPointer(end);
    }
    dismissGhost();
    const snapshot = mode.serialize(gameState);
    strokeChanged = false;
    let events = [];
    try {
      events = mode.key(gameState, k, now()) || [];
    } catch (err) {
      console.error('key режима упал', err);
    }
    handleEvents(events);
    if (strokeChanged) undo.push(snapshot);
    strokeChanged = false;
    if (events.length) {
      touched = true;
      saveCurrent();
    }
    updateHud();
    loop.invalidate();
  }

  /** Тап DOM-режима (§2.5): только выделение — без шага undo; партия сохраняется. */
  function onTap(target) {
    if (destroyed || won || ended || app.isLandscape() || typeof mode.tap !== 'function') return;
    dismissGhost();
    let events = [];
    try {
      events = mode.tap(gameState, target) || [];
    } catch (err) {
      console.error('tap режима упал', err);
    }
    handleEvents(events);
    if (events.length) {
      touched = true;
      saveCurrent();
    }
    loop.invalidate();
  }

  function handleEvents(events) {
    let solved = false;
    // Пачка событий, завершающая уровень: перевод слова уже будет в списке слов на экране победы —
    // тост не нужен (он лёг бы поверх «Дальше»).
    const finishing = events.some((e) => e.kind === 'solved');
    for (const ev of events) {
      switch (ev.kind) {
        case 'step':
          // Тон тика растёт с длиной дорожки: режим может передать index/length, иначе считаем сами.
          strokeSteps++;
          app.audio.step(ev.index ?? ev.length ?? strokeSteps);
          break;
        case 'reject':
          app.audio.reject();
          vibrate(30);
          shake();
          if (ev.reason === 'early-finish' && ev.remaining != null) {
            app.overlays.toast(t('remainingCells', { n: ev.remaining }), { key: 'remaining', duration: 1800 });
          } else if (ev.message) {
            app.overlays.toast(tr(ev.message), { key: 'reject', duration: 2600 });
          }
          break;
        case 'cut':
          app.audio.cut();
          break;
        case 'complete':
          app.audio.complete();
          if (ev.clue != null) vibrate(20); // Lumin: средняя вибрация на отгаданное слово (не flow)
          if (ev.message && !finishing) app.overlays.toast(tr(ev.message), { key: `complete-${ev.clue ?? 0}`, duration: 2600 });
          break;
        case 'miss':
          // Lumin «Errors stay local»: лёгкая вибрация, без тряски и звука отказа.
          vibrate(10);
          break;
        case 'notice':
          if (ev.message) app.overlays.toast(tr(ev.message), { key: 'notice', duration: 2600 });
          break;
        case 'deadend':
          // startMatters === false — цикл или фиксированный старт: совет «другую точку старта» ложный,
          // дело в порядке обхода (§2.1).
          app.overlays.toast(t(ev.startMatters === false ? 'deadendOrder' : 'deadend'), { key: 'deadend' });
          break;
        case 'changed':
          strokeChanged = true;
          attempt.lastChangeAt = now();
          dropPendingHint();
          updateHud();
          break;
        case 'solved':
          solved = true;
          break;
        default:
          break;
      }
    }
    if (solved || (!won && mode.isSolved(gameState))) onSolved();
  }

  function shake() {
    if (app.reducedMotion()) return;
    board.classList.remove('shake');
    void board.offsetWidth;
    board.classList.add('shake');
  }

  function updateHud() {
    const next = mode.nextLabel(gameState);
    subEl.textContent = next || '';
    const footer = mode.footer(gameState);
    footerEl.textContent = footer ? tr(footer) : '';
    undoBtn.disabled = undo.size === 0 && !strokeChanged;
    skipBtn.style.display = isDaily || won ? 'none' : isEndless || skipAvailable(attempt, now()) ? '' : 'none';
    (topHint || hintBtn).classList.toggle('pulse', !won && hintShouldPulse(attempt, now()));
  }

  // --- Снимки, undo, сброс, подсказка, пропуск ------------------------------------------
  /**
   * Undo = create(levelData, snapshot) (§2.1). Статический слой переносится в новое состояние:
   * режимы сами проверяют его по размеру клетки/теме/DPR, а перерисовывать его положено только
   * при смене уровня, темы или размера (§4.3). Начатый росчерк при этом забывается.
   */
  function restore(snapshot) {
    const prev = gameState;
    // Счётчик тупиков за попытку (stroke, §2.1) undo не откатывает: иначе порог «второй тупик →
    // пульс нечётных точек» обходился бы кнопкой «Отменить». Для zip/flow поле лишнее и игнорируется.
    // Статистика попытки undo не откатывает (§2.1, §2.5): тупики stroke, подсказки и точность «Слов»
    // только растут; hintUsed, раз поставленный, остаётся. Поля, которых у режима нет, не трогаются.
    let snap = snapshot;
    if (prev) {
      for (const f of ATTEMPT_STATS) {
        if (Number.isInteger(prev[f])) snap = { ...snap, [f]: Math.max(snapshot[f] ?? 0, prev[f]) };
      }
      if (prev.hintUsed === true && Object.prototype.hasOwnProperty.call(snapshot, 'hintUsed')) snap = { ...snap, hintUsed: true };
    }
    gameState = mode.create(level, snap);
    if (prev && prev._cache) gameState._cache = prev._cache;
    appeared = true;
    strokeSnapshot = null;
    strokeChanged = false;
    dropPendingHint();
    relayout();
    attempt.lastChangeAt = now();
    updateHud();
    loop.invalidate();
  }

  function doUndo() {
    if (ended) return;
    const snap = undo.pop();
    if (!snap) return;
    touched = true;
    restore(snap);
    saveCurrent();
  }

  function doReset() {
    if (ended) return;
    touched = true;
    const before = mode.serialize(gameState);
    undo.push(before);
    mode.reset(gameState);
    attempt.resets++;
    attempt.lastChangeAt = now();
    dropPendingHint();
    updateHud();
    loop.invalidate();
    saveCurrent();
    app.overlays.toast(t('resetDone'), {
      key: 'reset',
      duration: RESET_TOAST_MS,
      action: { label: t('undoReset'), onClick: () => doUndo() },
    });
  }

  function doHint() {
    if (ended) return;
    // Lumin «Hints» (§2.5): шторка с вариантами и их эффектом вместо двойного тапа.
    if (typeof mode.hintOptions === 'function') {
      const options = mode.hintOptions(gameState) || [];
      app.overlays.sheet({
        eyebrow: t('hint'),
        title: t('hintSheetTitle'),
        note: attempt.hintUsed ? null : t('hintSheetNote'),
        options: options.map((o) => ({ label: tr(o.label), detail: tr(o.detail), disabled: !!o.disabled, onPick: () => applyHint(o.id) })),
        cancel: t('cancel'),
      });
      return;
    }
    const tt = now();
    if (!attempt.hintUsed && tt > hintArmedUntil) {
      hintArmedUntil = tt + HINT_ARM_MS;
      armToast = app.overlays.toast(t('hintConfirm'), { key: 'hint', duration: HINT_ARM_MS });
      return;
    }
    hintArmedUntil = 0;
    armToast?.close();
    armToast = null;
    const before = mode.serialize(gameState);
    const result = mode.hint(gameState, tt) || { kind: 'none' };
    if (result.kind === 'none') {
      // Подсказки нет: поле уже решено (zip, flow) или солвер stroke упёрся в лимит узлов (§2.4).
      // Режим в этом случае hintUsed не ставит — звезда не снимается.
      gameState.hint = null;
      app.overlays.toast(t('hintUnavailable'), { key: 'hint' });
      loop.invalidate();
      return;
    }
    undo.push(before);
    touched = true;
    const firstHint = !attempt.hintUsed;
    attempt.hintUsed = true;
    gameState.hintUsed = true;
    if (isEndless && firstHint) breakStreak();
    if (result.kind === 'rollback' && typeof mode.truncate === 'function') {
      // Кнопка живёт до первого изменения поля (changed/undo/reset — dropPendingHint): режим и сам
      // отвергает устаревшую подсказку (truncate → false), но висящая кнопка вводила бы в заблуждение.
      pendingHint = result;
      hintToast = app.overlays.toast(t('hint'), {
        key: 'hint',
        duration: 4000,
        action: {
          label: t('truncateTo'),
          onClick: () => {
            hintToast = null;
            if (ended || !pendingHint) return;
            const hint = pendingHint;
            pendingHint = null;
            const snap = mode.serialize(gameState);
            if (mode.truncate(gameState, hint, now())) {
              undo.push(snap);
              attempt.lastChangeAt = now();
              updateHud();
              saveCurrent();
            }
            loop.invalidate();
          },
        },
      });
    }
    updateHud();
    loop.invalidate();
    saveCurrent();
    // Подсказка flow раскрывает поток целиком и может закрыть поле — победа без звезды.
    if (mode.isSolved(gameState)) onSolved();
  }

  /** Применить выбранный в шторке вариант подсказки (§2.5). */
  function applyHint(id) {
    if (ended || destroyed) return;
    const tt = now();
    const before = mode.serialize(gameState);
    const result = mode.hint(gameState, tt, id) || { kind: 'none' };
    if (result.kind === 'none') {
      app.overlays.toast(t('hintUnavailable'), { key: 'hint' });
      loop.invalidate();
      return;
    }
    undo.push(before);
    touched = true;
    const firstHint = !attempt.hintUsed;
    attempt.hintUsed = true;
    gameState.hintUsed = true;
    if (isEndless && firstHint) breakStreak();
    if (result.kind === 'check') {
      app.overlays.toast(result.wrong ? t('checkWrong', { n: result.wrong }) : t('checkOk'), { key: 'hint' });
    }
    // Открытая буква могла дорешать слова: тост с переводом и звук, как при вводе.
    if (Array.isArray(result.events)) handleEvents(result.events.filter((ev) => ev.kind === 'complete'));
    attempt.lastChangeAt = now();
    updateHud();
    loop.invalidate();
    saveCurrent();
    if (!won && mode.isSolved(gameState)) onSolved();
  }

  /** Снять кнопку «Укоротить до неё»: подсказка привязана к дорожке на момент показа. */
  function dropPendingHint() {
    if (!pendingHint && !hintToast) return;
    pendingHint = null;
    hintToast?.close();
    hintToast = null;
  }

  /** Обрыв серии Бесконечности (подсказка или пропуск, §3.2): рекорд фиксируется, серия — в ноль. */
  function breakStreak() {
    if (!streak) return;
    const was = streak.break();
    endlessInfo.streak = 0;
    if (was === 0) return;
    state.endless.best = updateBest(state.endless.best, endlessInfo.modeChoice, was);
    app.overlays.toast(t('endlessBroken'), { key: 'streak' });
  }

  function doSkip() {
    if (won || ended) return;
    ended = true;
    if (isCampaign) {
      state.skipped[mode.id] = recordSkip(state.skipped[mode.id] || [], level.id);
      state.current = null;
      app.save();
      const next = campaign[levelIndex + 1];
      if (next) app.go('game', { kind: 'campaign', modeId: mode.id, levelId: next.id });
      else app.go('levels', { modeId: mode.id });
    } else if (isEndless) {
      breakStreak();
      state.current = null;
      app.save();
      app.startEndless(endlessInfo.modeChoice, 0, level.id);
    }
  }

  // --- current ---------------------------------------------------------------------------
  function saveCurrent() {
    if (ended || destroyed) return;
    if (!touched && !isEndless) return;
    const snapshot = { ...mode.serialize(gameState) };
    const record = {
      kind,
      mode: mode.id,
      levelId: level.id,
      elapsedMs: Math.round(timer.elapsed(now())),
      hintUsed: attempt.hintUsed,
      resets: attempt.resets,
      startedAt: attempt.startedAt,
      state: snapshot,
    };
    if (endlessInfo) record.endless = { ...endlessInfo };
    if (dailyDate) record.date = dailyDate;
    state.current = record;
    app.save();
  }

  // --- Победа ----------------------------------------------------------------------------
  function onSolved() {
    if (won) return;
    won = true;
    ended = true;
    const tt = now();
    timer.pause(tt);
    const elapsedMs = Math.max(1, Math.round(timer.elapsed(tt)));
    const perfect = mode.perfect(gameState);
    const star = starFor(attempt, perfect);
    let prevBestMs = 0;
    let chapterDone = null;
    let endlessStreak = null;
    let endlessRecord = false;

    let chapterLabel = null;
    if (isCampaign) {
      const progress = state.progress[mode.id] || {};
      prevBestMs = progress[level.id]?.bestMs || 0;
      state.progress[mode.id] = recordWin(progress, level.id, star, elapsedMs);
      // Пройденный уровень больше не «пропущенный» (пунктирная рамка в списке).
      const skipped = state.skipped[mode.id] || [];
      if (skipped.includes(level.id)) state.skipped[mode.id] = skipped.filter((id) => id !== level.id);
      const nextLevel = campaign[levelIndex + 1];
      // «Глава/тема пройдена» — только когда пройдены все её уровни (при окне по темам их можно
      // проходить вразнобой, §2.5).
      const chapterComplete =
        !mode.openByChapter || campaign.filter((l) => l.chapter === level.chapter).every((l) => isDone(state.progress[mode.id], l.id));
      if ((!nextLevel || nextLevel.chapter !== level.chapter) && chapterComplete) {
        chapterDone = level.chapter;
        if (typeof mode.chapterTitle === 'function') chapterLabel = t('themeDone', { name: tr(mode.chapterTitle(level.chapter, level)) });
      }
    } else if (isDaily) {
      state.daily = recordDailyWin(state.daily, dailyDate);
    } else if (isEndless) {
      // Считаем от живой серии: после подсказки она уже 0, и победа даёт 1, а не streakBefore + 1.
      endlessInfo.streak = streak.win();
      endlessStreak = endlessInfo.streak;
      const prevBest = state.endless.best[endlessInfo.modeChoice] || 0;
      endlessRecord = endlessInfo.streak > prevBest;
      state.endless.best = updateBest(state.endless.best, endlessInfo.modeChoice, endlessInfo.streak);
      app.endlessUsed.add(level.id);
    }
    state.current = null;
    app.save();

    // Напоминание об установке после 3-го пройденного уровня во вкладке Safari.
    if (!app.isStandalone && !state.settings.installReminderShown) {
      const total = app.modes.reduce((acc, m) => acc + doneCount(app.modeSets(m.id).campaign, state.progress[m.id] || {}), 0);
      if (total >= 3) {
        state.settings.installReminderShown = true;
        app.save();
        setTimeout(() => app.overlays.toast(t('installReminder'), { duration: 5000 }), 1500);
      }
    }

    app.audio.win();
    vibrate([30, 40, 30]);
    if (kbd) {
      kbd.style.display = 'none';
      document.body.classList.remove('kbd-open');
    }
    updateHud();
    winAt = tt;
    const reduced = app.reducedMotion();
    // Lumin: финал спокойный, без конфетти (§2.5).
    if (!reduced && cv && !lumin) {
      const rect = cv.rect();
      confetti = createConfetti(rect.w, rect.h, tt, {
        strong: !!chapterDone,
        colors: [theme.accent, theme.hint, theme.ok, theme.text, ...theme.flow.slice(0, 4)],
        seed: (level.seed || 1) >>> 0,
      });
    }
    loop.invalidate();

    const stats = mode.stats(gameState);
    const overlay = buildWinOverlay(app, {
      kind,
      mode,
      star,
      perfect,
      elapsedMs,
      prevBestMs,
      statsLines: stats?.lines || [],
      vocab: stats?.vocab || null,
      skin: mode.skin || null,
      quote: stats?.quote || null,
      accuracy: stats?.accuracy,
      hints: stats?.hints,
      chapterDone,
      chapterLabel,
      endlessStreak,
      endlessRecord,
      dailyWon: isDaily,
      onNext: () => {
        app.audio.tap();
        if (isCampaign) {
          const next = nextCampaignLevel();
          if (next) app.go('game', { kind: 'campaign', modeId: mode.id, levelId: next.id });
          else if (doneCount(campaign, state.progress[mode.id] || {}) === campaign.length) app.go('campaignDone', { modeId: mode.id });
          else app.go('levels', { modeId: mode.id });
        } else if (isDaily) {
          app.go('home');
        } else {
          app.startEndless(endlessInfo.modeChoice, endlessInfo.streak);
        }
      },
      onRepeat: () => {
        app.audio.tap();
        // «Повторить» возвращает серию, с которой уровень открыли; после обрыва — 0.
        if (isEndless) app.go('game', { kind, modeId: mode.id, levelId: level.id, endless: { ...endlessInfo, streak: streak.before } });
        else app.go('game', { kind, modeId: mode.id, levelId: level.id, date: dailyDate });
      },
    });
    const delay = reduced ? 0 : lumin ? 360 : chapterDone ? CONFETTI_STRONG_MS : CONFETTI_MS;
    setTimeout(() => {
      if (destroyed) return;
      el.appendChild(overlay);
      // Фокус на заголовок победы: VoiceOver объявляет результат, Tab идёт по кнопкам диалога.
      overlay.querySelector('.lw-title, .win-card h2')?.focus?.({ preventScroll: true });
    }, delay);
  }

  /**
   * «Дальше» в кампании: линейные режимы — следующий уровень по порядку. С окном по темам
   * (openByChapter, §2.5) — следующий открытый непройденный уровень этой темы, иначе первый
   * открытый непройденный в любой теме; null — всё пройдено (или открытых нет).
   */
  function nextCampaignLevel() {
    if (!mode.openByChapter) return campaign[levelIndex + 1] || null;
    const progress = state.progress[mode.id] || {};
    const statuses = levelStatuses(campaign, progress, state.skipped[mode.id] || [], { byChapter: true });
    const open = (s) => s.status === 'open' && s.id !== level.id;
    const same = statuses.find((s) => open(s) && campaign[s.index].chapter === level.chapter && !s.skipped);
    const any = same || statuses.find((s) => open(s) && !s.skipped) || statuses.find(open);
    return any ? campaign[any.index] : null;
  }

  // --- Таймер, видимость, тема ----------------------------------------------------------
  function onVisibility() {
    if (document.visibilityState === 'hidden') {
      timer.pause(now());
      saveCurrent();
    } else {
      if (!introOpen) timer.start(now());
      ghostStart = now();
      loop.invalidate();
    }
  }
  function onPageHide() {
    timer.pause(now());
    saveCurrent();
  }
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);

  // Физическая клавиатура (Mac, iPad с клавиатурой) — только для режимов с вводом букв.
  // Не перехватывает клавиши, пока открыт диалог (шторка, знакомство, подтверждение, победа) или
  // фокус на кнопке/поле: Tab/Enter/пробел там работают как обычно (WCAG 2.1.1/2.1.2).
  function onKeyDown(e) {
    if (!kbd || won || ended || destroyed || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('.sheet-backdrop, .intro-backdrop, .dialog-backdrop, .win-overlay')) return;
    const tgt = e.target;
    const tag = tgt && tgt.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if ((e.key === 'Enter' || e.key === 'Tab' || e.key === ' ') && tgt && tgt.closest && tgt.closest('button, a') && !tgt.closest('.kbd')) return;
    if (e.key === 'Tab' && e.shiftKey) return;
    // Русская (и любая не латинская) раскладка: буква по физической клавише (e.code «KeyA» → A).
    const code = /^Key([A-Z])$/.exec(e.code || '');
    const latin = /^[a-zA-Z]$/.test(e.key) ? e.key.toUpperCase() : null;
    const key = KEY_MAP[e.key] || latin || (code && e.key && e.key.length === 1 ? code[1] : null);
    if (!key) return;
    e.preventDefault();
    onKey(key);
  }
  if (kbd) document.addEventListener('keydown', onKeyDown);

  // Смена темы: режимы сами перерисовывают статический слой по theme.id (§4.3), кэш не трогаем.
  const unwatchTheme = app.onThemeChange(() => {
    theme = app.applyModeTheme(mode);
    el.style.setProperty('--mode-color', theme.accent);
    frameBudget.reset();
    relayout();
    loop.invalidate();
  });

  const ticker = setInterval(() => {
    if (!destroyed && !won) updateHud();
  }, 1000);

  if (!introOpen && document.visibilityState !== 'hidden') timer.start(t0);
  relayout();
  updateHud();
  loop.invalidate();

  // Знакомство с режимом при первом входе (Lumin «Onboarding», §2.5) — один раз; таймер уровня
  // стоит, пока оно на экране.
  if (introOpen) {
    setTimeout(() => {
      if (destroyed) return;
      app.overlays
        .intro(mode.intro.map((c) => ({ title: tr(c.title), text: tr(c.text) })), { next: t('next'), done: t('introStart'), skip: t('skip') })
        .then(() => {
          introOpen = false;
          state.settings.introSeen = [...(state.settings.introSeen || []), mode.id];
          app.save();
          if (!destroyed && !won && document.visibilityState !== 'hidden') timer.start(now());
          attempt.lastChangeAt = now();
        });
    }, 200);
  }

  return {
    el,
    destroy() {
      if (destroyed) return;
      timer.pause(now());
      // Выход с экрана сохраняет партию (и серию Бесконечности) через current; после победы или
      // пропуска (ended) current уже обнулён и не воскрешается.
      saveCurrent();
      destroyed = true;
      if (ghostTimer) clearTimeout(ghostTimer);
      clearInterval(ticker);
      detachInput();
      loop.stop();
      cv?.destroy();
      view?.destroy();
      if (lumin) document.body.classList.remove('lumin-on');
      unwatchTheme();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      if (kbd) {
        document.removeEventListener('keydown', onKeyDown);
        document.body.classList.remove('kbd-open');
      }
    },
  };
}

const KEY_MAP = { Backspace: 'Backspace', Delete: 'Backspace', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Next', Tab: 'Next' };
const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

/**
 * Экранная клавиатура QWERTY + ⌫ (§2.5). Нажатие — на pointerdown (без задержки click и без фокуса),
 * подсветка .down до отпускания; системная клавиатура iOS не появляется.
 */
export function buildKeyboard(onKey) {
  const rows = KEY_ROWS.map((letters, r) => {
    const keys = [...letters].map((ch) => h('button', { class: 'key', type: 'button', dataset: { k: ch }, 'aria-label': ch, text: ch }));
    if (r === 2) keys.push(h('button', { class: 'key wide', type: 'button', dataset: { k: 'Backspace' }, 'aria-label': t('backspace') }, icon('backspace')));
    return h('div', { class: 'kbd-row' }, keys);
  });
  const el = h('div', { class: 'kbd', role: 'group', 'aria-label': t('keyboard') }, rows);
  let pressed = null;
  const release = () => {
    if (pressed) pressed.classList.remove('down');
    pressed = null;
  };
  el.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest ? e.target.closest('.key') : null;
    if (!btn) return;
    e.preventDefault();
    release();
    pressed = btn;
    btn.classList.add('down');
    onKey(btn.dataset.k);
  });
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('pointerleave', release);
  // Клик без pointerdown (VoiceOver, клавиатурная навигация) — тоже нажатие.
  el.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    const btn = e.target.closest ? e.target.closest('.key') : null;
    if (btn) onKey(btn.dataset.k);
  });
  return el;
}
