// Карта уровней — docs/DESIGN.md §5.5, эталон «Level map». Фон — шёлк map-backdrop на всю высоту
// (прокручивается вместе с тропой), поверх — пунктирная тропа: узлы-круги 52px зигзагом
// (±30 % ширины по синусу). Состояния узлов: пройден (белый, номер, 1–3 точки-звезды), текущий
// (чёрный; кольцо — если партия прервана), открыт, закрыт (серый с замком), пропущен (пунктирная
// обводка). Шапка «‹ · название · ★ N», внизу плавающая карточка главы/темы со стрелкой к текущему.
// Правила открытия — прежние (§3.1 п.2): levelStatuses, окно из 3 уровней, openByChapter.
// «Слова» (§2.5): карта одной темы (params.pack); список тем — экран wordPacks (src/ui/packs.js).
// Стили — src/styles/30-packs-map.css (префикс mp-).
import { h, icon } from './dom.js';
import { screen, header, pill, progress, art } from './kit.js';
import { backTo } from './settings.js';
import { tr, formatTime } from '../core/i18n.js';
import { levelStatuses, levelStars } from '../core/progress.js';
import { modeLook, themeLook, packIdOf, wordThemes, plural } from './packs.js';

/** Геометрия тропы (pt). */
export const NODE = 52;
export const STEP = 80; // шаг узлов по вертикали
export const STEP_THEME = 100; // карта темы «Слов»: 5 узлов — шаг шире
export const STEP_THEME_MAX = 150; // …и растягивается по высоте экрана до этого шага
export const LABEL_GAP = 60; // место под подпись главы
export const AMP = 0.3; // смещение ±30 % ширины
export const PERIOD = 8; // узлов на период синуса

const COPY = {
  back: 'Назад',
  noLevels: 'Уровней пока нет',
  lockedToast: 'Сначала пройди предыдущие уровни',
  lockedToastTheme: 'Сначала пройди предыдущие цитаты темы',
  themeTitle: (name) => `Тема: ${name}`,
  chapter: (n) => `Глава ${n}`,
  next: (n) => `Дальше — уровень ${n}`,
  resume: (n) => `Продолжить уровень ${n}`,
  allDone: 'Все уровни пройдены',
  themeDone: 'Тема пройдена',
  play: (n) => `Играть уровень ${n}`,
  starsLabel: (n) => `Звёзд: ${n}`,
  chapterProgress: (done, total) => `Пройдено ${done} из ${total}`,
};

/** Названия глав «Карандаша» по типу уровней (§2.6): «Глава 2 · Шарик». */
const CHAPTER_TYPES = { ball: 'Шарик', swarm: 'Рой' };

/** chapterName(mode, chapter, level) → «Путешествия» (темы) / «Глава 2 · Шарик» / «Глава 3». */
export function chapterName(mode, chapter, level) {
  if (mode && typeof mode.chapterTitle === 'function') return tr(mode.chapterTitle(chapter, level));
  const label = mode && typeof mode.chapterLabel === 'function' ? mode.chapterLabel(chapter) : null;
  if (label) return `${COPY.chapter(chapter)} · ${tr(label)}`;
  const kind = level && CHAPTER_TYPES[level.type];
  return kind ? `${COPY.chapter(chapter)} · ${kind}` : COPY.chapter(chapter);
}

/**
 * mapLayout(levels, { step, labels }) → { nodes: [{ x, y }], labels: [{ chapter, first, x, y }], height }.
 * x — смещение центра узла от середины в долях ширины (±AMP), y — центр узла в pt от верха тропы.
 * labels — подписи глав на тропе перед первым узлом каждой главы.
 */
export function mapLayout(levels, { step = STEP, labels = false } = {}) {
  const nodes = [];
  const marks = [];
  const round = (v) => Math.round(v * 10000) / 10000;
  let y = 0; // верх очередного узла
  levels.forEach((level, i) => {
    const x = round(AMP * Math.sin((i * 2 * Math.PI) / PERIOD));
    if (labels && (i === 0 || level.chapter !== levels[i - 1].chapter)) {
      y += LABEL_GAP;
      // Подпись — посередине между низом предыдущего узла и верхом этого, на линии тропы.
      const prev = i > 0 ? nodes[i - 1] : null;
      const from = prev ? prev.y + NODE / 2 : 0;
      marks.push({ chapter: level.chapter, first: i, x: round(prev ? (prev.x + x) / 2 : x), y: (from + y) / 2 });
    }
    nodes.push({ x, y: y + NODE / 2 });
    y += step;
  });
  return { nodes, labels: marks, height: nodes.length ? nodes[nodes.length - 1].y + NODE / 2 : 0 };
}

/** nodeState(status, isCurrent) → 'current' | 'done' | 'locked' | 'skipped' | 'open'. */
export function nodeState(s, isCurrent) {
  if (isCurrent) return 'current';
  if (s.status === 'done') return 'done';
  if (s.status === 'locked') return 'locked';
  return s.skipped ? 'skipped' : 'open';
}

const STAR_WORDS = ['звёзд', 'звезда', 'звезды', 'звезды'];

/** nodeLabel(n, state, { stars, bestMs, resume }) → «Уровень 12, пройден, 2 звезды из 3, лучшее 0:41». */
export function nodeLabel(n, state, { stars = 0, bestMs = 0, resume = false } = {}) {
  const base = `Уровень ${n}`;
  const parts = [base];
  if (state === 'done') {
    parts.push('пройден', `${stars} ${STAR_WORDS[stars] || 'звёзд'} из 3`);
    if (bestMs) parts.push(`лучшее ${formatTime(bestMs)}`);
  } else if (state === 'current') parts.push(resume ? 'текущий, начат' : 'текущий');
  else if (state === 'locked') parts.push('закрыт');
  else if (state === 'skipped') parts.push('пропущен');
  else parts.push('открыт');
  if (resume && state !== 'current') parts.push('начат');
  return parts.join(', ');
}

/**
 * resolvePack(campaign, params, current, nextIndex, remembered) → номер главы (темы) для карты «Слов».
 * pack — slug темы или номер главы; без него — тема уровня params.levelId, прерванной партии,
 * последней открытой карты темы (remembered — номер главы), следующего непройденного, иначе первая.
 */
export function resolvePack(campaign, { pack = null, levelId = null } = {}, current = null, nextIndex = -1, remembered = null) {
  if (!campaign.length) return null;
  if (pack != null && pack !== '') {
    const key = String(pack);
    const hit = campaign.find((l) => packIdOf(l) === key || String(l.chapter) === key);
    if (hit) return hit.chapter;
  }
  const byId = (id) => (id ? campaign.find((l) => l.id === id) : null);
  const lv = byId(levelId) || (current && current.kind === 'campaign' ? byId(current.levelId) : null);
  if (lv) return lv.chapter;
  if (remembered != null && campaign.some((l) => l.chapter === remembered)) return remembered;
  if (nextIndex >= 0 && campaign[nextIndex]) return campaign[nextIndex].chapter;
  return campaign[0].chapter;
}

/** Плавная кривая через центры узлов (Catmull-Rom → кубические Безье). */
function smoothPath(pts) {
  if (pts.length < 2) return '';
  const r = (v) => Math.round(v * 10) / 10;
  let d = `M${r(pts[0].x)} ${r(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    d += ` C${r(p1.x + (p2.x - p0.x) / 6)} ${r(p1.y + (p2.y - p0.y) / 6)} ${r(p2.x - (p3.x - p1.x) / 6)} ${r(p2.y - (p3.y - p1.y) / 6)} ${r(p2.x)} ${r(p2.y)}`;
  }
  return d;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

// Последняя открытая тема режима (на время сессии): возврат из игры без params.pack — на ту же карту.
const lastChapter = {};

export function mountLevels(app, params = {}) {
  const mode = app.modeById[params.modeId] || app.modes[0];
  const modeId = mode.id;
  const campaign = app.modeSets(modeId).campaign;
  const progressMap = app.state.progress[modeId] || {};
  const skipped = app.state.skipped[modeId] || [];
  const byChapter = !!mode.openByChapter;
  const statuses = levelStatuses(campaign, progressMap, skipped, { byChapter });
  // Темы «Слов» — отдельные карты (окно открытых уровней по темам).
  const themed = byChapter && typeof mode.chapterTitle === 'function';
  const cur = app.state.current && app.state.current.kind === 'campaign' && app.state.current.mode === modeId ? app.state.current : null;

  const firstOpen = (list) => list.find((x) => x.s.status === 'open' && !x.s.skipped) || list.find((x) => x.s.status === 'open') || null;
  const all = campaign.map((level, index) => ({ level, index, s: statuses[index] }));
  let items = all;
  let theme = null;
  if (themed) {
    const globalNext = firstOpen(all);
    const chapter = resolvePack(campaign, params, cur, globalNext ? globalNext.index : -1, lastChapter[modeId]);
    lastChapter[modeId] = chapter;
    items = all.filter((x) => x.level.chapter === chapter);
    theme = wordThemes(campaign, progressMap, mode.chapterTitle.bind(mode)).find((t) => t.chapter === chapter) || null;
  }
  const currentItem = firstOpen(items);
  const resumeId = cur && items.some((x) => x.level.id === cur.levelId) ? cur.levelId : null;
  const numberOf = (x) => (themed ? x.index - items[0].index + 1 : x.index + 1);
  const totalStars = campaign.reduce((acc, l) => acc + levelStars(progressMap[l.id]), 0);

  const play = (x) => {
    app.audio?.tap?.();
    app.go('game', { kind: 'campaign', modeId, levelId: x.level.id });
  };

  // --- Тропа.
  const chaptersInScope = new Set(items.map((x) => x.level.chapter));
  const withLabels = !themed && chaptersInScope.size > 1;
  const levelsInScope = items.map((x) => x.level);
  let step = themed ? STEP_THEME : STEP;
  let layout = mapLayout(levelsInScope, { step, labels: withLabels });
  const silk = h('div', { class: 'mp-silk', 'aria-hidden': 'true' });
  const pathSvg = svgEl('svg', { class: 'mp-path', 'aria-hidden': 'true', focusable: 'false' });
  const track = h('div', { class: 'mp-track' }, silk, pathSvg);
  const body = h('div', { class: 'mp-nodes', style: { height: `${layout.height}px` } });
  track.appendChild(body);

  let currentNode = null;
  const nodeEls = [];
  const labelEls = [];
  let labelIdx = 0;
  items.forEach((x, i) => {
    while (withLabels && labelIdx < layout.labels.length && layout.labels[labelIdx].first === i) {
      const mark = layout.labels[labelIdx++];
      const label = h('div', {
        class: 'mp-chapter',
        role: 'heading',
        'aria-level': '2',
        style: { left: `clamp(104px, calc(50% + ${(mark.x * 100).toFixed(2)}%), calc(100% - 104px))`, top: `${mark.y}px` },
        text: chapterName(mode, mark.chapter, x.level),
      });
      labelEls.push(label);
      body.appendChild(label);
    }
    const pos = layout.nodes[i];
    const isCurrent = x === currentItem;
    const state = nodeState(x.s, isCurrent);
    const n = numberOf(x);
    const stars = levelStars(progressMap[x.level.id]);
    const resume = x.level.id === resumeId;
    const node = h(
      'button',
      {
        class: `mp-node ${state}${resume ? ' resume' : ''}`,
        type: 'button',
        style: { left: `calc(50% + ${(pos.x * 100).toFixed(2)}%)`, top: `${pos.y}px` },
        'aria-label': nodeLabel(n, state, { stars, bestMs: x.s.bestMs, resume }),
        'aria-current': isCurrent ? 'step' : null,
        'aria-disabled': state === 'locked' ? 'true' : null,
        onClick: () => {
          if (state === 'locked') {
            app.overlays?.toast?.(themed ? COPY.lockedToastTheme : COPY.lockedToast, { key: 'map-locked' });
            return;
          }
          play(x);
        },
      },
      state === 'locked' ? icon('lock') : h('span', { class: 'mp-num', text: String(n) }),
      state === 'done'
        ? h(
            'span',
            { class: 'mp-dots', 'aria-hidden': 'true' },
            [0, 1, 2].map((k) => h('i', { class: k < stars ? 'on' : null })),
          )
        : null,
    );
    if (isCurrent) currentNode = node;
    nodeEls.push(node);
    body.appendChild(node);
  });
  /** Новый шаг тропы (карта темы растягивается на высоту экрана): узлы и подписи — на новые места. */
  function relayout(nextStep) {
    step = nextStep;
    layout = mapLayout(levelsInScope, { step, labels: withLabels });
    nodeEls.forEach((el, i) => (el.style.top = `${layout.nodes[i].y}px`));
    labelEls.forEach((el, i) => (el.style.top = `${layout.labels[i].y}px`));
    body.style.height = `${layout.height}px`;
  }
  if (!items.length) body.appendChild(h('p', { class: 'mp-empty w-body', text: COPY.noLevels }));

  // --- Плавающая карточка: глава/тема текущего уровня, прогресс, стрелка → текущий уровень.
  const card = floatingCard();
  function floatingCard() {
    let title;
    let sub;
    let done;
    let total;
    let look;
    if (themed) {
      const name = theme ? tr(theme.theme) : tr(mode.name);
      title = COPY.themeTitle(name);
      total = items.length;
      done = items.filter((x) => x.s.status === 'done').length;
      sub = currentItem ? (currentItem.level.id === resumeId ? COPY.resume(numberOf(currentItem)) : COPY.next(numberOf(currentItem))) : done >= total ? COPY.themeDone : COPY.chapterProgress(done, total);
      look = themeLook(theme ? theme.order : 0);
    } else if (currentItem) {
      const ch = currentItem.level.chapter;
      const inChapter = items.filter((x) => x.level.chapter === ch);
      title = chaptersInScope.size > 1 ? chapterName(mode, ch, inChapter[0].level) : tr(mode.name);
      total = inChapter.length;
      done = inChapter.filter((x) => x.s.status === 'done').length;
      sub = currentItem.level.id === resumeId ? COPY.resume(numberOf(currentItem)) : COPY.next(numberOf(currentItem));
      look = modeLook(modeId);
    } else {
      title = items.length ? COPY.allDone : tr(mode.name);
      total = items.length;
      done = items.filter((x) => x.s.status === 'done').length;
      sub = items.length ? `${total} ${plural(total, ['уровень', 'уровня', 'уровней'])} · ★ ${totalStars} из ${total * 3}` : COPY.noLevels;
      look = modeLook(modeId);
    }
    const thumb = h('span', { class: `mp-thumb ${look.family}`, 'aria-hidden': 'true' }, art(look.art, `mp-thumb-art pk-art-${look.art}`));
    const go = currentItem
      ? h(
          'button',
          {
            class: 'mp-go',
            type: 'button',
            'aria-label': COPY.play(numberOf(currentItem)),
            onClick: () => play(currentItem),
          },
          icon('arrow'),
        )
      : null;
    return h(
      'div',
      { class: 'mp-card' },
      thumb,
      h(
        'div',
        { class: 'mp-card-body' },
        h('h2', { class: 'mp-card-title', text: title }),
        h('p', { class: 'mp-card-sub', text: sub }),
        total
          ? h(
              'div',
              { class: 'mp-card-progress' },
              progress(done / total, COPY.chapterProgress(done, total)),
              h('span', { class: 'mp-card-count', 'aria-hidden': 'true', text: `${done}/${total}` }),
            )
          : null,
      ),
      go,
    );
  }

  const title = themed && theme ? tr(theme.theme) : tr(mode.name);
  const starPill = pill('star', totalStars, 'star', COPY.starsLabel(totalStars));
  const { el, scroll } = screen(
    {
      className: 'mp-screen',
      header: header({ title, onBack: () => backTo(app, params, themed ? 'wordPacks' : 'packs'), right: starPill, backLabel: COPY.back }),
    },
    track,
  );
  el.appendChild(card);

  // --- Пунктир и шёлк — по фактической ширине (после вставки в DOM); при смене ширины — заново.
  let lastW = 0;
  let lastH = 0;
  function draw() {
    const w = track.clientWidth;
    if (!w) return;
    // Карта темы (5 узлов): шаг растягивается, чтобы тропа заняла место между шапкой и карточкой.
    if (themed && levelsInScope.length > 1) {
      const padBottom = parseFloat(getComputedStyle(track).paddingBottom) || 0;
      const avail = scroll.clientHeight - body.offsetTop - padBottom;
      const fit = Math.max(STEP_THEME, Math.min(STEP_THEME_MAX, Math.floor((avail - NODE) / (levelsInScope.length - 1))));
      if (Math.abs(fit - step) > 1) relayout(fit);
    }
    const hgt = track.offsetHeight;
    if (w === lastW && hgt === lastH) return;
    lastW = w;
    lastH = hgt;
    const top = body.offsetTop;
    pathSvg.setAttribute('width', String(w));
    pathSvg.setAttribute('height', String(hgt));
    pathSvg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
    const pts = layout.nodes.map((p) => ({ x: w / 2 + p.x * w, y: top + p.y }));
    const split = currentItem ? items.indexOf(currentItem) : pts.length - 1;
    const walked = smoothPath(pts.slice(0, split + 1));
    const ahead = smoothPath(pts.slice(Math.max(0, split)));
    pathSvg.replaceChildren(
      ...(ahead ? [svgEl('path', { class: 'mp-line ahead', d: ahead })] : []),
      ...(walked ? [svgEl('path', { class: 'mp-line walked', d: walked })] : []),
    );
    // Шёлк: плитки 720×1279 по ширине, через одну отражены по вертикали — без видимых швов.
    const tileH = Math.round((w * 1279) / 720);
    const count = Math.max(1, Math.ceil(hgt / tileH));
    if (silk.childElementCount !== count || silk.dataset.w !== String(w)) {
      silk.dataset.w = String(w);
      silk.replaceChildren(...Array.from({ length: count }, (_, i) => h('div', { class: `mp-silk-tile${i % 2 ? ' flip' : ''}`, style: { height: `${tileH}px` } })));
    }
  }
  let ro = null;
  let raf = requestAnimationFrame(() => {
    raf = 0;
    draw();
    // Текущий узел — в середину видимой области (между шапкой и карточкой), без анимации.
    if (currentNode) {
      const cardH = card.offsetHeight || 0;
      const visible = scroll.clientHeight - cardH;
      scroll.scrollTop = Math.max(0, body.offsetTop + currentNode.offsetTop + NODE / 2 - visible * 0.5);
      if (!app.reducedMotion()) currentNode.classList.add('mp-pop');
    }
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(() => draw());
      ro.observe(track);
    }
  });

  return {
    el,
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
    },
  };
}
