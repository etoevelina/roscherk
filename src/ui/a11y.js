// «Специальные возможности» (docs/DESIGN.md §5.11): крупный текст в головоломке, меньше
// движения, контрастные номера, вибрация. Сверху — живой пример плиток «Слов» (A 12 · R 4 · T 8)
// на настоящих классах .wv-tile/.wv-acell, поэтому он меняется сразу: каждое изменение пишет
// settings.a11y, сохраняет и вызывает app.applyA11y() (классы body.a11y-*, их CSS —
// src/styles/50-profile.css). «Назад» и «Готово» → params.back (функция или { name, params },
// например игра) или профиль.
import { h } from './dom.js';
import { screen, header, row, switchControl, seg } from './kit.js';
import { svgIcon, backTo } from './settings.js';
import { vibrate } from '../core/audio.js';

export const A11Y_COPY = {
  title: 'Специальные возможности',
  lead: 'Сделай головоломки удобными — пример меняется сразу.',
  done: 'Готово',
  preview: 'Пример',
  previewNote: 'как в «Словах»',
  previewLabel: 'Пример плиток «Слов»: A 12, R 4, T 8',
  largeText: 'Крупный текст в головоломке',
  largeTextNote: 'Буквы и номера на 20 % крупнее',
  reduceMotion: 'Меньше движения',
  reduceMotionNote: 'Без перемещений и пружин',
  reduceMotionSystem: 'Уже включено в настройках iPhone',
  contrast: 'Контрастные номера',
  contrastNote: 'Номера чернилами и жирнее',
  haptics: 'Вибрация',
  hapticsNote: 'Отклик при вводе и победе',
  hapticsLight: 'Лёгкая',
  hapticsOff: 'Выкл',
  foot: 'Размер текста и уменьшение движения из настроек iPhone учитываются всегда.',
};

const SVG = {
  text: '<path d="M3.5 18L8.5 6l5 12M5.3 14h6.4"/><path d="M14.5 18l3.25-7.5L21 18M15.6 15.6h4.3"/>',
  motion: '<circle cx="15" cy="12" r="6"/><path d="M2.5 9H6M2 12h4M2.5 15H6"/>',
  contrast: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>',
};

/** Строка с переключателем: тап по всей строке переключает; своя иконка (нет в dom.js). */
function switchRow({ svg, iconName, label, sub }, on, onChange) {
  const sw = switchControl(on, onChange, label);
  const r = row({ iconName, label, sub, control: sw });
  if (svg) r.prepend(h('span', { class: 'w-row-icon' }, svgIcon(svg)));
  r.classList.add('pf-tap');
  r.addEventListener('click', (e) => {
    if (!sw.contains(e.target)) sw.click();
  });
  return { row: r, sw, sub: r.querySelector('.w-row-label small') };
}

export function mountA11y(app, params = {}) {
  const a = () => app.state.settings.a11y;
  const done = () => backTo(app, params, 'profile');

  const doneBtn = h('button', { class: 'a11y-done', type: 'button', text: A11Y_COPY.done, onClick: done });
  const hdr = header({ title: A11Y_COPY.title, onBack: done, right: doneBtn });
  hdr.classList.add('pf-header');
  hdr.querySelector('h1')?.setAttribute('aria-hidden', 'true'); // заголовок для диктора — крупный ниже

  // Живой пример: плитка цитаты и клетки ответа — те же классы, что в игре.
  const tile = (ch, n, cls) => h('span', { class: `wv-tile ${cls}` }, h('b', { lang: 'en', text: ch }), h('em', { text: String(n) }));
  const cell = (ch, n) => h('span', { class: 'wv-acell filled' }, h('b', { lang: 'en', text: ch }), h('small', { text: String(n) }));
  const sample = h(
    'div',
    { class: 'a11y-sample', role: 'img', 'aria-label': A11Y_COPY.previewLabel },
    h('div', { class: 'a11y-tiles', 'aria-hidden': 'true' }, tile('A', 12, 'filled'), tile('R', 4, 'sel'), tile('T', 8, 'filled')),
    h('div', { class: 'a11y-cells', 'aria-hidden': 'true' }, cell('A', 12), cell('R', 4), cell('T', 8)),
  );
  const preview = h(
    'div',
    { class: 'a11y-preview' },
    h('div', { class: 'a11y-preview-head' }, h('span', { class: 'w-eyebrow', text: A11Y_COPY.preview }), h('span', { class: 'w-caption', text: A11Y_COPY.previewNote })),
    sample,
  );

  const pulse = () => {
    if (app.reducedMotion()) return;
    sample.classList.remove('pulse');
    void sample.offsetWidth; // перезапуск анимации
    sample.classList.add('pulse');
  };
  const change = (key, value) => {
    a()[key] = value;
    app.save();
    app.applyA11y();
    app.audio?.tap?.();
    pulse();
  };

  const systemReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const large = switchRow({ svg: SVG.text, label: A11Y_COPY.largeText, sub: A11Y_COPY.largeTextNote }, a().largeText, (on) => change('largeText', on));
  const motion = switchRow(
    { svg: SVG.motion, label: A11Y_COPY.reduceMotion, sub: systemReduced ? A11Y_COPY.reduceMotionSystem : A11Y_COPY.reduceMotionNote },
    a().reduceMotion,
    (on) => change('reduceMotion', on),
  );
  const contrast = switchRow({ svg: SVG.contrast, label: A11Y_COPY.contrast, sub: A11Y_COPY.contrastNote }, a().contrastNumbers, (on) => change('contrastNumbers', on));

  const hapticsSeg = seg(
    [
      { id: 'light', label: A11Y_COPY.hapticsLight },
      { id: 'off', label: A11Y_COPY.hapticsOff },
    ],
    a().haptics === 'off' ? 'off' : 'light',
    (id) => {
      change('haptics', id);
      if (id !== 'off') vibrate(10); // почувствовать «лёгкую» сразу (в приложении для iPhone)
    },
    A11Y_COPY.haptics,
  );
  hapticsSeg.classList.add('a11y-seg');
  const hapticsRow = row({ iconName: 'vibrate', label: A11Y_COPY.haptics, sub: A11Y_COPY.hapticsNote, control: hapticsSeg });
  hapticsRow.classList.add('a11y-hap');

  const { el, scroll } = screen(
    { className: 'pf-screen a11y-screen', header: hdr },
    h('div', { class: 'a11y-intro' }, h('h1', { class: 'w-title', text: A11Y_COPY.title }), h('p', { class: 'w-body', text: A11Y_COPY.lead })),
    preview,
    h('div', { class: 'pf-group' }, large.row, motion.row, contrast.row, hapticsRow),
    h('p', { class: 'pf-foot left', text: A11Y_COPY.foot }),
  );

  const onScroll = () => hdr.classList.toggle('pf-scrolled', scroll.scrollTop > 64);
  scroll.addEventListener('scroll', onScroll, { passive: true });

  return {
    el,
    destroy() {
      scroll.removeEventListener('scroll', onScroll);
    },
  };
}
