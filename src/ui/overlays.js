// Оверлеи (§3.1 п.6, §2.1, §4.6): тосты с действием, диалоги подтверждения/ввода,
// «Поверни телефон», тост обновления SW. Живут в #overlays поверх экранов.
import { h, icon, clear } from './dom.js';
import { t } from '../core/i18n.js';

export function createOverlays(root) {
  const stack = h('div', { class: 'toast-stack' });
  root.appendChild(stack);
  let rotateEl = null;
  let dialogEl = null;

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
          text: action.label,
          onClick: () => {
            close();
            action.onClick();
          },
        }),
      );
    }
    if (dismissible) {
      el.appendChild(h('button', { class: 'dismiss', 'aria-label': t('close'), onClick: close }, icon('close')));
    }
    stack.appendChild(el);
    while (stack.children.length > 3) stack.firstChild.remove();
    if (duration > 0) timer = setTimeout(close, duration);
    return { close, el };
  }

  function closeDialog() {
    dialogEl?.remove();
    dialogEl = null;
  }

  /** confirm(text, { ok, cancel }) → Promise<boolean>. */
  function confirm(text, { ok = t('yes'), cancel = t('cancel'), danger = false } = {}) {
    closeDialog();
    return new Promise((resolve) => {
      const done = (v) => {
        closeDialog();
        resolve(v);
      };
      dialogEl = h(
        'div',
        { class: 'dialog-backdrop', onClick: (e) => e.target === dialogEl && done(false) },
        h(
          'div',
          { class: 'dialog', role: 'dialog' },
          h('p', { text }),
          h(
            'div',
            { class: 'btn-row' },
            h('button', { class: 'btn', text: cancel, onClick: () => done(false) }),
            h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, text: ok, onClick: () => done(true) }),
          ),
        ),
      );
      root.appendChild(dialogEl);
    });
  }

  /** prompt(text, { value, readOnly }) → Promise<string|null>. Текст в textarea (код прогресса). */
  function prompt(text, { value = '', readOnly = false, ok = t('ok'), cancel = t('cancel') } = {}) {
    closeDialog();
    return new Promise((resolve) => {
      const done = (v) => {
        closeDialog();
        resolve(v);
      };
      const area = h('textarea', { readonly: readOnly || null, spellcheck: 'false', autocapitalize: 'off' });
      area.value = value;
      dialogEl = h(
        'div',
        { class: 'dialog-backdrop' },
        h(
          'div',
          { class: 'dialog', role: 'dialog' },
          h('p', { text }),
          area,
          h(
            'div',
            { class: 'btn-row' },
            h('button', { class: 'btn', text: cancel, onClick: () => done(null) }),
            readOnly ? null : h('button', { class: 'btn primary', text: ok, onClick: () => done(area.value) }),
          ),
        ),
      );
      root.appendChild(dialogEl);
      if (!readOnly) setTimeout(() => area.focus(), 50);
      else area.select?.();
    });
  }

  /**
   * sheet({ eyebrow, title, note, options: [{ label, detail, disabled, onPick }], cancel }) — нижняя
   * шторка выбора (Lumin «Hints», §2.5): эффект каждого варианта виден до выбора; тап по фону — отмена.
   */
  function sheet({ eyebrow = '', title = '', note = null, options = [], cancel = t('cancel') } = {}) {
    closeDialog();
    const close = () => closeDialog();
    const list = h(
      'div',
      { class: 'sheet-options' },
      options.map((o) =>
        h(
          'button',
          {
            class: 'sheet-option',
            type: 'button',
            disabled: o.disabled || null,
            onClick: () => {
              close();
              o.onPick?.();
            },
          },
          h('span', { class: 'sheet-label', text: o.label }),
          h('span', { class: 'sheet-detail', text: o.detail || '' }),
        ),
      ),
    );
    dialogEl = h(
      'div',
      {
        class: 'sheet-backdrop',
        onClick: (e) => e.target === dialogEl && close(),
        onKeydown: (e) => {
          if (e.key === 'Escape') close();
        },
      },
      h(
        'div',
        { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
        eyebrow ? h('div', { class: 'sheet-eyebrow', text: eyebrow }) : null,
        h('h3', { class: 'sheet-title', text: title }),
        list,
        note ? h('p', { class: 'sheet-note', text: note }) : null,
        h('button', { class: 'btn sheet-cancel', type: 'button', text: cancel, onClick: close }),
      ),
    );
    root.appendChild(dialogEl);
    dialogEl.querySelector('.sheet-option:not([disabled])')?.focus?.({ preventScroll: true });
  }

  /**
   * intro(cards, { next, done }) → Promise: знакомство из нескольких карточек (Lumin «Onboarding»):
   * точки прогресса, «Дальше» и «Начать» на последней. Закрывается и по «Пропустить».
   */
  function intro(cards, { next = t('next'), done = t('ok'), skip = t('skip') } = {}) {
    closeDialog();
    return new Promise((resolve) => {
      let i = 0;
      const titleEl = h('h2', { class: 'intro-title' });
      const textEl = h('p', { class: 'intro-text' });
      const dots = h('div', { class: 'intro-dots', 'aria-hidden': 'true' }, cards.map(() => h('i')));
      const btn = h('button', { class: 'btn primary big', type: 'button' });
      const finish = () => {
        closeDialog();
        resolve();
      };
      const show = () => {
        titleEl.textContent = cards[i].title;
        textEl.textContent = cards[i].text;
        btn.textContent = i === cards.length - 1 ? done : next;
        [...dots.children].forEach((d, j) => d.classList.toggle('on', j === i));
      };
      btn.addEventListener('click', () => {
        if (i < cards.length - 1) {
          i++;
          show();
        } else finish();
      });
      dialogEl = h(
        'div',
        { class: 'intro-backdrop' },
        h(
          'div',
          { class: 'intro', role: 'dialog', 'aria-modal': 'true' },
          h('button', { class: 'intro-skip', type: 'button', text: skip, onClick: finish }),
          h('div', { class: 'intro-art', 'aria-hidden': 'true' }, h('span', { class: 'orb a' }), h('span', { class: 'orb b' })),
          titleEl,
          textEl,
          dots,
          btn,
        ),
      );
      show();
      root.appendChild(dialogEl);
    });
  }

  /** Оверлей «Поверни телефон». */
  function setRotate(on) {
    if (on && !rotateEl) {
      rotateEl = h(
        'div',
        { class: 'rotate-overlay' },
        icon('rotate'),
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

  return { toast, confirm, prompt, sheet, intro, setRotate, destroyAll };
}
