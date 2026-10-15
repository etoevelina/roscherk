// Нативная оболочка (Capacitor, App Store): вибрация через Haptics, статус-бар поверх страницы,
// скрытие заставки. Подключается только в нативной сборке (tools/build.mjs --native): в вебе
// плагинов нет, и этот модуль не попадает в бандл.
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';

export function setupNative() {
  if (!Capacitor.isNativePlatform()) return;
  window.__roscherkHaptic = (kind) => {
    try {
      if (kind === 'success') Haptics.notification({ type: NotificationType.Success });
      else Haptics.impact({ style: kind === 'heavy' ? ImpactStyle.Heavy : kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light });
    } catch {
      /* без вибрации */
    }
  };
  // Статус-бар: поверх страницы (safe-area учтена в CSS), стиль — по теме документа.
  const syncStatusBar = () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
  };
  StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
  syncStatusBar();
  new MutationObserver(syncStatusBar).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  SplashScreen.hide().catch(() => {});
}
