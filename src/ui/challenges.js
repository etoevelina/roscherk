// «Испытания» (docs/DESIGN.md §5.12): Бесконечность — серия уровней растущей сложности (§3.2).
// Сцена с lavender-orb, выбор режима сегментами (Маршрут · Потоки · Один штрих · Микс), лучшая
// серия выбранного режима и ступени сложности, главная кнопка «Играть →» / «Продолжить →»
// (прерванная бесконечность того же выбора продолжается с того же уровня через current).
import { h, icon } from './dom.js';
import { screen, header, button, art, seg } from './kit.js';
import { tr } from '../core/i18n.js';
import { MIX } from '../core/endless.js';
import { findLevel } from '../core/levels.js';

const COPY = {
  title: 'Испытания',
  eyebrow: 'Бесконечность',
  sceneTitle: ['Уровни', 'без конца'],
  sceneBody: 'Чем длиннее серия побед, тем сложнее следующий уровень.',
  modeLabel: 'Режим',
  modeGroup: 'Режим бесконечности',
  mix: 'Микс',
  best: 'Лучшая серия',
  bestLabel: (n, name) => `Лучшая серия, ${name}: ${n}`,
  note: 'Подсказка или пропуск обрывают серию. Выход из игры её сохраняет.',
  resume: (n) => `Прерванная серия: ${n} — продолжишь с того же уровня.`,
  play: 'Играть',
  cont: 'Продолжить',
  ladder: (on, total) => `Ступени сложности: открыто ${on} из ${total}`,
};

/** Ступени сложности — пороги серии из chaptersForStreak (core/endless.js): 0–4 · 5–9 · 10–14 · 15+. */
const STEPS = [
  { from: 0, label: '0–4', name: 'Разминка' },
  { from: 5, label: '5–9', name: 'Средне' },
  { from: 10, label: '10–14', name: 'Трудно' },
  { from: 15, label: '15+', name: 'Мастер' },
];

export function mountChallenges(app) {
  const { state } = app;
  const rot = app.rotationModes;
  const cur = state.current;
  const resumeEndless = cur && cur.kind === 'endless' && app.modeById[cur.mode] && findLevel(app.levels, cur.mode, cur.levelId) ? cur : null;
  const choices = rot.length > 1 ? [...rot.map((m) => m.id), MIX] : rot.map((m) => m.id);
  const fallback = rot.length === 1 ? rot[0].id : MIX;
  let choice = resumeEndless?.endless?.modeChoice;
  if (!choices.includes(choice)) choice = fallback;

  const labelOf = (id) => (id === MIX ? COPY.mix : tr(app.modeById[id]?.name) || id);
  const canResume = () => !!resumeEndless && resumeEndless.endless?.modeChoice === choice;

  // --- Сцена. ---
  const scene = h(
    'div',
    { class: 'w-card lav ch-scene' },
    art('lavender-orb', 'ch-orb'),
    h('p', { class: 'w-eyebrow ch-eyebrow', text: COPY.eyebrow }),
    h('h2', { class: 'ch-scene-title' }, COPY.sceneTitle[0], h('br'), COPY.sceneTitle[1]),
    h('p', { class: 'ch-scene-body', text: COPY.sceneBody }),
  );

  // --- Лучшая серия и ступени. ---
  const bestNum = h('span', { text: '0' });
  const bestLine = h('span', { class: 'ch-best-num', role: 'img' }, icon('flame'), bestNum);
  const steps = STEPS.map((s, i) =>
    h(
      'div',
      { class: 'ch-step' },
      h('span', { class: 'ch-step-bar', 'aria-hidden': 'true' }, h('i', { style: { height: `${10 + i * 8}px` } })),
      h('b', { text: s.label }),
      h('span', { text: s.name }),
    ),
  );
  const ladder = h('div', { class: 'ch-ladder', role: 'img' }, steps);
  const bestCard = h(
    'div',
    { class: 'w-card ch-best' },
    h('span', { class: 'ch-best-label', 'aria-hidden': 'true', text: COPY.best }),
    bestLine,
    ladder,
  );

  // --- Главная кнопка внизу. ---
  const resumeLine = h('p', { class: 'ch-resume', 'aria-live': 'polite' });
  const cta = button(COPY.play, {
    variant: 'primary',
    arrow: true,
    block: true,
    disabled: choices.length === 0,
    onClick: () => {
      app.audio?.tap?.();
      if (canResume()) {
        app.go('game', { kind: 'endless', modeId: resumeEndless.mode, levelId: resumeEndless.levelId, endless: resumeEndless.endless });
      } else {
        app.startEndless(choice, 0);
      }
    },
  });
  const ctaLabel = cta.querySelector('span');

  const render = () => {
    const best = state.endless?.best?.[choice] || 0;
    bestNum.textContent = String(best);
    bestLine.setAttribute('aria-label', COPY.bestLabel(best, labelOf(choice)));
    const reached = STEPS.filter((s) => best >= s.from).length; // всегда ≥ 1: «Разминка» открыта
    steps.forEach((el, i) => {
      el.classList.toggle('on', i < reached);
      el.classList.toggle('top', i === reached - 1 && best > 0);
    });
    ladder.setAttribute('aria-label', COPY.ladder(reached, STEPS.length));
    const resume = canResume();
    ctaLabel.textContent = resume ? COPY.cont : COPY.play;
    resumeLine.textContent = resume ? COPY.resume(resumeEndless.endless?.streak || 0) : '';
  };

  const segEl =
    choices.length > 1
      ? seg(
          choices.map((id) => ({ id, label: labelOf(id) })),
          choice,
          (id) => {
            choice = id;
            render();
          },
          COPY.modeGroup,
        )
      : null;

  const { el } = screen(
    { className: 'ch', header: header({ title: COPY.title, onBack: () => app.go('home'), center: false }) },
    scene,
    segEl ? h('p', { class: 'w-eyebrow ch-label', 'aria-hidden': 'true', text: COPY.modeLabel }) : null,
    segEl,
    bestCard,
    h('p', { class: 'w-caption ch-note', text: COPY.note }),
  );
  el.appendChild(h('div', { class: 'ch-foot' }, resumeLine, cta));
  render();
  return { el, destroy() {} };
}
