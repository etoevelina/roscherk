// Оверлеи (§3.1 п.6, §2.1, §4.6; вид — WORDS 1.2, docs/DESIGN.md): тосты с действием, диалоги
// подтверждения/ввода, шторка (подсказки, быстрые настройки, выбор), знакомство с режимом,
// «Поверни телефон», тост обновления SW. Живут в #overlays поверх экранов. Стили — src/styles/60-game.css.
import { h, icon, clear } from './dom.js';
import { art } from './kit.js';
import { t } from '../core/i18n.js';

/** Иконка шторки: имя из dom.js или готовый узел. */
const iconNode = (name) => (name == null ? null : typeof name === 'string' ? icon(name) : name);

export function createOverlays(root) {
  const stack = h('div', { class: 'toast-stack' });
  root.appendChild(stack);
  let rotateEl = null;
  let dialogEl = null;
  let dialogClose = null; // колбэк закрытия текущей шторки/диалога (onClose шторки)
  let restoreFocus = null;

  /**
   * toast(text, { duration = 2500, action: { label, onClick }, key, dismissible }) → { close() }.
   * Тост с тем же key заменяет предыдущий. duration 0 — до закрытия вручную: такой тост всегда
   * dismissible (кнопка «закрыть»), иначе от него не избавиться.
   */
  function toast(text, { duration = 2500, action = null, key = null, dismissible = duration === 0 } = {}) {
    if (key) {
      for (const el of stack.querySelectorAll(`[data-key="${key}"]`)) el.remove();
    }
    let timer = null;
    // Тост без кнопок пропускает касания сквозь себя: не съедает тап по клетке или «Дальше».
    const passive = !action && !dismissible;
    const el = h('div', { class: `toast${passive ? ' passive' : ''}`, role: 'status', dataset: key ? { key } : null }, h('span', { text }));
    const close = () => {
      if (timer) clearTimeout(timer);
      el.remove();
    };
    if (action) {
      el.appendChild(
        h('button', {
          class: 'act',
          type: 'button',
          text: action.label,
          onClick: () => {
            close();
            action.onClick();
          },
        }),
      );
    }
    if (dismissible) {
      el.appendChild(h('button', { class: 'dismiss', type: 'button', 'aria-label': t('close'), onClick: close }, icon('close')));
    }
    stack.appendChild(el);
    while (stack.children.length > 3) stack.firstChild.remove();
    if (duration > 0) timer = setTimeout(close, duration);
    return { close, el };
  }

  /** Открыть модальный слой: прежний закрывается, фокус потом возвращается на место. */
  function openDialog(el, onClose = null) {
    closeDialog();
    restoreFocus = typeof document !== 'undefined' ? document.activeElement : null;
    dialogEl = el;
    dialogClose = onClose;
    root.appendChild(el);
  }

  function closeDialog() {
    if (!dialogEl) return;
    const cb = dialogClose;
    dialogEl.remove();
    dialogEl = null;
    dialogClose = null;
    const back = restoreFocus;
    restoreFocus = null;
    if (back && back.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
    cb?.();
  }

  /** confirm(text, { ok, cancel, danger }) → Promise<boolean>. */
  function confirm(text, { ok = t('yes'), cancel = t('cancel'), danger = false } = {}) {
    return new Promise((resolve) => {
      let result = false;
      const done = (v) => {
        result = v;
        closeDialog();
      };
      const okBtn = h('button', { class: `w-btn ${danger ? 'danger' : 'primary'}`, type: 'button', text: ok, onClick: () => done(true) });
      const el = h(
        'div',
        {
          class: 'dialog-backdrop',
          onClick: (e) => e.target === el && done(false),
          onKeydown: (e) => e.key === 'Escape' && done(false),
        },
        h(
          'div',
          { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': text },
          h('p', { text }),
          h('div', { class: 'dialog-actions' }, h('button', { class: 'w-btn secondary', type: 'button', text: cancel, onClick: () => done(false) }), okBtn),
        ),
      );
      openDialog(el, () => resolve(result));
      okBtn.focus({ preventScroll: true });
    });
  }

  /**
   * prompt(text, { value, readOnly, ok, cancel, input, maxLength, placeholder }) → Promise<string|null>.
   * По умолчанию — textarea (код прогресса); input: true — однострочное поле (имя).
   */
  function prompt(text, { value = '', readOnly = false, ok = t('ok'), cancel = t('cancel'), input = false, maxLength = null, placeholder = null } = {}) {
    return new Promise((resolve) => {
      let result = null;
      const field = input
        ? h('input', { type: 'text', class: 'dialog-input', maxlength: maxLength, placeholder, autocomplete: 'off', enterkeyhint: 'done' })
        : h('textarea', { readonly: readOnly || null, spellcheck: 'false', autocapitalize: 'off', placeholder });
      field.value = value;
      const done = (v) => {
        result = v;
        closeDialog();
      };
      if (input) field.addEventListener('keydown', (e) => e.key === 'Enter' && done(field.value));
      const el = h(
        'div',
        { class: 'dialog-backdrop', onKeydown: (e) => e.key === 'Escape' && done(null) },
        h(
          'div',
          { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': text },
          h('p', { text }),
          field,
          h(
            'div',
            { class: 'dialog-actions' },
            h('button', { class: `w-btn ${readOnly ? 'primary' : 'secondary'}`, type: 'button', text: readOnly ? t('close') : cancel, onClick: () => done(null) }),
            readOnly ? null : h('button', { class: 'w-btn primary', type: 'button', text: ok, onClick: () => done(field.value) }),
          ),
        ),
      );
      openDialog(el, () => resolve(result));
      if (!readOnly) setTimeout(() => field.focus(), 50);
      else field.select?.();
    });
  }

  /**
   * sheet({ title, eyebrow, note, options, content, className, onClose }) → { close } — нижняя шторка
   * WORDS («Подсказка ×»): затемнение, белая скруглённая карточка, строки «иконка · название · цена».
   * options: [{ label, detail, icon, price, priceLabel, selected, disabled, onPick }]; content —
   * произвольные узлы под строками (быстрые настройки). Тап по фону, × и Escape закрывают.
   * cancel — из прежнего API, больше не нужен (закрытие — крестиком).
   */
  function sheet({ eyebrow = '', title = '', note = null, options = [], content = null, className = '', onClose = null } = {}) {
    const close = () => {
      if (dialogEl === el) closeDialog();
    };
    const list = options.length
      ? h(
          'div',
          { class: 'sheet-options', role: 'list' },
          options.map((o) =>
            h(
              'button',
              {
                class: `sheet-option${o.selected ? ' selected' : ''}`,
                type: 'button',
                role: 'listitem',
                disabled: o.disabled || null,
                'aria-current': o.selected ? 'true' : null,
                'aria-label': [o.label, o.detail, o.priceLabel].filter(Boolean).join('. ') || null,
                onClick: () => {
                  close();
                  o.onPick?.();
                },
              },
              o.icon ? h('span', { class: 'sheet-icon', 'aria-hidden': 'true' }, iconNode(o.icon)) : null,
              h('span', { class: 'sheet-text' }, h('span', { class: 'sheet-label', text: o.label }), o.detail ? h('span', { class: 'sheet-detail', text: o.detail }) : null),
              o.price ? h('span', { class: 'sheet-price', 'aria-hidden': 'true' }, o.price) : null,
              o.selected ? h('span', { class: 'sheet-check', 'aria-hidden': 'true' }, icon('check')) : null,
            ),
          ),
        )
      : null;
    const closeBtn = h('button', { class: 'sheet-close', type: 'button', 'aria-label': t('close'), onClick: close }, icon('close'));
    const el = h(
      'div',
      {
        class: 'sheet-backdrop',
        onClick: (e) => e.target === el && close(),
        onKeydown: (e) => {
          if (e.key === 'Escape') close();
        },
      },
      h(
        'div',
        { class: `sheet${className ? ` ${className}` : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
        h(
          'div',
          { class: 'sheet-head' },
          h('div', { class: 'sheet-heading' }, eyebrow ? h('div', { class: 'sheet-eyebrow', text: eyebrow }) : null, h('h2', { class: 'sheet-title', text: title })),
          closeBtn,
        ),
        list,
        content ? h('div', { class: 'sheet-content' }, content) : null,
        note ? h('p', { class: 'sheet-note', text: note }) : null,
      ),
    );
    openDialog(el, onClose);
    // Фокус — на саму шторку: VoiceOver объявляет заголовок, кольцо фокуса не висит на первой строке.
    el.querySelector('.sheet')?.focus?.({ preventScroll: true });
    return { close, el };
  }

  /**
   * intro(cards, { next, done, skip }) → Promise: знакомство из нескольких карточек при первом входе
   * в режим: сцена с 3D-графикой, заголовок, текст, точки прогресса, «Дальше» → «Начать».
   */
  function intro(cards, { next = t('next'), done = t('ok'), skip = t('skip') } = {}) {
    return new Promise((resolve) => {
      let i = 0;
      const titleEl = h('h2', { class: 'intro-title', tabindex: '-1' });
      const textEl = h('p', { class: 'intro-text' });
      const dots = h('div', { class: 'intro-dots', 'aria-hidden': 'true' }, cards.map(() => h('i')));
      const label = h('span');
      const btn = h('button', { class: 'w-btn primary split block', type: 'button' }, label, icon('arrow'));
      const finish = () => closeDialog();
      const show = () => {
        titleEl.textContent = cards[i].title;
        textEl.textContent = cards[i].text;
        label.textContent = i === cards.length - 1 ? done : next;
        [...dots.children].forEach((d, j) => d.classList.toggle('on', j === i));
      };
      btn.addEventListener('click', () => {
        if (i < cards.length - 1) {
          i++;
          show();
          titleEl.focus({ preventScroll: true });
        } else finish();
      });
      const el = h(
        'div',
        { class: 'intro-backdrop', onKeydown: (e) => e.key === 'Escape' && finish() },
        h(
          'div',
          { class: 'intro', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'intro-title' },
          h('button', { class: 'intro-skip', type: 'button', text: skip, onClick: finish }),
          h('div', { class: 'intro-art', 'aria-hidden': 'true' }, art('sage-loop', 'intro-loop'), art('lavender-orb', 'intro-orb')),
          titleEl,
          textEl,
          dots,
          btn,
        ),
      );
      titleEl.id = 'intro-title';
      show();
      openDialog(el, () => resolve());
      titleEl.focus({ preventScroll: true });
    });
  }

  /** Оверлей «Поверни телефон». */
  function setRotate(on) {
    if (on && !rotateEl) {
      rotateEl = h(
        'div',
        { class: 'rotate-overlay', role: 'alert' },
        h('span', { class: 'rotate-icon', 'aria-hidden': 'true' }, icon('rotate')),
        h('h2', { text: t('rotate') }),
        h('p', { text: t('rotateText') }),
      );
      root.appendChild(rotateEl);
    } else if (!on && rotateEl) {
      rotateEl.remove();
      rotateEl = null;
    }
  }

  function destroyAll() {
    clear(stack);
    closeDialog();
    setRotate(false);
  }

  return { toast, confirm, prompt, sheet, intro, setRotate, destroyAll, closeDialog };
}
