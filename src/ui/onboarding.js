// Онбординг (docs/DESIGN.md §5.1, эталон WORDS «Onboarding»): знак «Р О С Ч Е Р К», обещание в две
// фразы, подпись, жемчужная лента справа и снизу, одна чёрная пилюля «Начать →». Без карусели и без
// ввода имени (имя задаётся в профиле). Нажатие → settings.onboarded = true → главная.
import { h } from './dom.js';
import { screen, button, art } from './kit.js';

const COPY = {
  mark: 'Росчерк',
  lead: 'Маленькие головоломки.',
  soft: 'Большая перспектива.',
  sub: 'Линии, английские слова, физика и ежедневные задачи — чтобы ум оставался любопытным.',
  start: 'Начать',
};

export function mountOnboarding(app) {
  let leaving = false;
  const start = button(COPY.start, {
    variant: 'primary',
    arrow: true,
    onClick: () => {
      if (leaving) return;
      leaving = true;
      app.audio?.tap?.();
      app.state.settings.onboarded = true;
      app.save();
      app.go('home');
    },
  });
  start.classList.add('ob-cta');

  const { el } = screen(
    { className: `ob${app.reducedMotion() ? '' : ' ob-anim'}` },
    h('p', { class: 'w-wordmark ob-mark', text: COPY.mark }),
    h('h1', { class: 'w-display ob-title' }, h('span', { text: COPY.lead }), ' ', h('span', { class: 'soft', text: COPY.soft })),
    h('p', { class: 'w-body ob-sub', text: COPY.sub }),
    start,
  );
  el.prepend(art('pearl-ribbon', 'ob-art'));
  return { el, destroy() {} };
}
