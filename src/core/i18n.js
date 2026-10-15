// Строки интерфейса (§0: контракт {ru, en}, в v1 наполнен только ru; en = ru).
// t(key, vars) — строка по ключу с подстановкой {name}; tr(obj) — выбор языка у объекта {ru, en}.

const STRINGS = {
  appTitle: { ru: 'Росчерк' },
  play: { ru: 'Играть' },
  continue: { ru: 'Продолжить' },
  back: { ru: 'Назад' },
  settings: { ru: 'Настройки' },
  passed: { ru: 'пройдено {done}/{total}' },
  daily: { ru: 'Ежедневная' },
  dailyLevel: { ru: 'Уровень дня · {mode}' },
  dailyDone: { ru: 'Сегодня пройдено' },
  streakDays: { ru: 'Серия: {n} {days}' },
  day1: { ru: 'день' },
  day2: { ru: 'дня' },
  day5: { ru: 'дней' },
  endless: { ru: 'Бесконечность' },
  endlessHint: { ru: 'Сложность растёт с серией' },
  mix: { ru: 'микс' },
  bestStreak: { ru: 'Лучшая серия: {n}' },
  streak: { ru: 'Серия: {n}' },
  installTitle: { ru: 'Добавь на экран «Домой»' },
  installText: { ru: 'Нажми «Поделиться» внизу Safari, затем «На экран „Домой“» — игра будет работать офлайн.' },
  installReminder: { ru: 'Установи, чтобы прогресс не стёрся' },
  close: { ru: 'Закрыть' },
  chapter: { ru: 'Глава {n}' },
  locked: { ru: 'Закрыто' },
  undo: { ru: 'Отменить' },
  reset: { ru: 'Сбросить' },
  hint: { ru: 'Подсказка' },
  skip: { ru: 'Пропустить' },
  hintConfirm: { ru: 'Подсказка? Звезда не засчитается' },
  hintUnavailable: { ru: 'Подсказка сейчас недоступна' },
  undoReset: { ru: 'Отменить сброс' },
  resetDone: { ru: 'Поле очищено' },
  remainingCells: { ru: 'Осталось клеток: {n}' },
  deadend: { ru: 'Тупик. Попробуй другую точку старта' },
  deadendOrder: { ru: 'Тупик. Этот отрезок надо было пройти позже' },
  truncateTo: { ru: 'Укоротить до неё' },
  rotate: { ru: 'Поверни телефон' },
  rotateText: { ru: 'Игра работает в портретной ориентации. Состояние сохранено.' },
  done: { ru: 'Готово!' },
  perfect: { ru: 'Идеально' },
  time: { ru: 'Время {t}' },
  best: { ru: 'Лучшее {t}' },
  bestDelta: { ru: 'Лучшее {t} ({d})' },
  newBest: { ru: 'Новый рекорд!' },
  next: { ru: 'Дальше' },
  repeat: { ru: 'Повторить' },
  repeatForStar: { ru: 'Повторить за звездой' },
  chapterDone: { ru: 'Глава {n} пройдена' },
  campaignDone: { ru: 'Кампания пройдена' },
  campaignDoneText: { ru: 'Все уровни режима «{mode}» позади. Дальше — Бесконечность и Ежедневная.' },
  home: { ru: 'На главный' },
  dailyWon: { ru: 'Уровень дня пройден' },
  endlessStreak: { ru: 'Серия: {n}' },
  endlessBroken: { ru: 'Серия прервана' },
  endlessRecord: { ru: 'Новый рекорд серии!' },
  sound: { ru: 'Звук' },
  soundNote: { ru: 'Звук подчиняется беззвучному переключателю телефона.' },
  theme: { ru: 'Тема' },
  themeSystem: { ru: 'Системная' },
  themeDark: { ru: 'Тёмная' },
  themeLight: { ru: 'Светлая' },
  flowNumbers: { ru: 'Номера на точках' },
  flowNumbersNote: { ru: 'Для режима «Потоки»: индекс потока на обеих точках пары.' },
  progress: { ru: 'Прогресс' },
  copyCode: { ru: 'Скопировать код прогресса' },
  pasteCode: { ru: 'Вставить код прогресса' },
  pastePrompt: { ru: 'Вставь код прогресса:' },
  pasteConfirm: { ru: 'Заменить текущий прогресс данными из кода?' },
  codeCopied: { ru: 'Код скопирован' },
  codeShown: { ru: 'Код прогресса показан — скопируй его вручную' },
  codeBad: { ru: 'Код не распознан' },
  codeApplied: { ru: 'Прогресс восстановлен' },
  resetProgress: { ru: 'Сбросить прогресс' },
  resetProgressConfirm: { ru: 'Удалить весь прогресс, серии и настройки? Это нельзя отменить.' },
  progressCleared: { ru: 'Прогресс сброшен' },
  version: { ru: 'Версия сборки' },
  yes: { ru: 'Да' },
  cancel: { ru: 'Отмена' },
  ok: { ru: 'Ок' },
  updateAvailable: { ru: 'Доступно обновление' },
  restart: { ru: 'Перезапустить' },
  level: { ru: 'Уровень {n}' },
  star: { ru: 'Звезда' },
  check: { ru: 'Пройдено' },
  lock: { ru: 'Замок' },
  campaign: { ru: 'Кампания' },
  levelsTitle: { ru: '{mode} — уровни' },
  noLevels: { ru: 'Уровней пока нет' },
  share: { ru: 'Поделиться' },
  heroSub: { ru: 'Головоломки одной линией и английские слова' },
  statStreak: { ru: 'Серия' },
  statSolved: { ru: 'Пройдено' },
  statStars: { ru: 'Звёзд' },
  modesTitle: { ru: 'Режимы' },
  themeDone: { ru: 'Тема «{name}» пройдена' },
  vocabTitle: { ru: 'Слова уровня' },
  keyboard: { ru: 'Клавиатура' },
  backspace: { ru: 'Стереть' },
  hintSheetTitle: { ru: 'Немного помочь?' },
  hintSheetNote: { ru: 'С подсказкой звезда за этот уровень не засчитается' },
  checkWrong: { ru: 'Неверных букв: {n} — они подсвечены' },
  checkOk: { ru: 'Ошибок нет — продолжай' },
  introStart: { ru: 'Начать' },
  winEyebrow: { ru: 'Цитата собрана' },
  winTitle: { ru: 'Мысль найдена.' },
  statTime: { ru: 'Время' },
  statHints: { ru: 'Подсказки' },
  statAccuracy: { ru: 'Точность' },
  levelsCount: { ru: '{n} уровней · пройдено {done}' },
  campaignDoneOnly: { ru: 'Все уровни режима «{mode}» позади. Можно переиграть любой — слова стоит повторять.' },
  levelsList: { ru: 'К темам' },
  announceWrong: { ru: '{ch} — неверно' },
  announceSolved: { ru: 'Слово отгадано: {w}' },
};

let lang = 'ru';

export function setLang(next) {
  lang = next === 'en' ? 'en' : 'ru';
}

export function getLang() {
  return lang;
}

/** tr(obj) → строка на текущем языке; en отсутствует → ru; не объект → как есть. */
export function tr(obj) {
  if (obj == null) return '';
  if (typeof obj === 'string') return obj;
  return obj[lang] ?? obj.ru ?? '';
}

/** t(key, vars) → строка с подстановкой {name}; неизвестный ключ возвращается как есть. */
export function t(key, vars) {
  const entry = STRINGS[key];
  let s = entry ? tr(entry) : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

/** Склонение «день/дня/дней» по числу. */
export function daysWord(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return t('day1');
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return t('day2');
  return t('day5');
}

/** formatTime(ms) → «0:41» или «12:03»; часы не показываем. */
export function formatTime(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
