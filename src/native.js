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
  // Статус-бар поверх страницы (safe-area учтена в CSS). Под ним в обеих темах тёмная полоса
  // шапки (§4.1), поэтому текст статус-бара всегда светлый (Style.Dark = светлые значки).
  StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  SplashScreen.hide().catch(() => {});
}
