// Настройки (§3.1 п.5): звук, тема, номера на точках, код прогресса, сброс прогресса, версия.
import { h, icon } from './dom.js';
import { t } from '../core/i18n.js';
import { exportCode, importCode, defaultState } from '../core/storage.js';

export function mountSettings(app) {
  const { state } = app;

  const toggle = (key, label, note) => {
    const btn = h('button', { class: `toggle ${state.settings[key] ? 'on' : ''}`, role: 'switch', 'aria-checked': String(!!state.settings[key]), 'aria-label': label });
    btn.addEventListener('click', () => {
      state.settings[key] = !state.settings[key];
      btn.classList.toggle('on', state.settings[key]);
      btn.setAttribute('aria-checked', String(state.settings[key]));
      app.save();
      app.audio.tap();
    });
    return h('div', { class: 'setting-row' }, h('div', { class: 'label' }, label, note ? h('small', { text: note }) : null), btn);
  };

  // Тема: системная / тёмная / светлая.
  const themeSeg = h('div', { class: 'seg' });
  const renderTheme = () => {
    themeSeg.replaceChildren(
      ...[
        ['system', t('themeSystem')],
        ['dark', t('themeDark')],
        ['light', t('themeLight')],
      ].map(([id, label]) =>
        h('button', {
          class: state.settings.theme === id ? 'on' : '',
          text: label,
          onClick: () => {
            state.settings.theme = id;
            app.save();
            app.applyTheme();
            renderTheme();
          },
        }),
      ),
    );
  };
  renderTheme();

  const copyCode = async () => {
    const code = exportCode(state);
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (copied) app.overlays.toast(t('codeCopied'));
    else {
      app.overlays.toast(t('codeShown'));
      await app.overlays.prompt(t('copyCode'), { value: code, readOnly: true });
    }
  };

  const pasteCode = async () => {
    const code = await app.overlays.prompt(t('pastePrompt'));
    if (code == null || !code.trim()) return;
    const next = importCode(code, app.modes.map((m) => m.id));
    if (!next) {
      app.overlays.toast(t('codeBad'));
      return;
    }
    if (!(await app.overlays.confirm(t('pasteConfirm')))) return;
    app.replaceState(next);
    app.overlays.toast(t('codeApplied'));
    app.go('settings');
  };

  const resetProgress = async () => {
    if (!(await app.overlays.confirm(t('resetProgressConfirm'), { danger: true }))) return;
    app.replaceState(defaultState(app.modes.map((m) => m.id)));
    app.overlays.toast(t('progressCleared'));
    app.go('settings');
  };

  const content = h(
    'div',
    { class: 'content' },
    h(
      'div',
      { class: 'card' },
      toggle('sound', t('sound'), t('soundNote')),
      h('div', { class: 'setting-row stack' }, h('div', { class: 'label', text: t('theme') }), themeSeg),
      toggle('flowNumbers', t('flowNumbers'), t('flowNumbersNote')),
    ),
    h('div', { class: 'section-title', text: t('progress') }),
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'setting-row' }, h('button', { class: 'btn setting-btn', text: t('copyCode'), onClick: copyCode })),
      h('div', { class: 'setting-row' }, h('button', { class: 'btn setting-btn', text: t('pasteCode'), onClick: pasteCode })),
      h('div', { class: 'setting-row' }, h('button', { class: 'btn setting-btn danger', text: t('resetProgress'), onClick: resetProgress })),
    ),
    h('div', { class: 'version', text: `${t('version')}: ${app.buildHash}` }),
  );

  const el = h(
    'div',
    { class: 'screen settings-screen lumin' },
    h(
      'div',
      { class: 'topbar' },
      h('button', { class: 'icon-btn round', 'aria-label': t('back'), onClick: () => app.go('home') }, icon('back')),
      h('span', { class: 'title', text: t('settings') }),
      h('span', { class: 'spacer' }),
    ),
    content,
  );
  return { el, destroy() {} };
}
