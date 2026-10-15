# Публикация «Росчерка» в App Store

Приложение — веб-игра в нативной оболочке Capacitor (папка `ios/`). Собирается в облаке
Codemagic по файлу `codemagic.yaml`, без Xcode на Mac. Всё, что ниже, подготовлено; владельцу
аккаунта Apple Developer остаются только действия, которые требуют его учётной записи.
Каждый шаг — одно действие в браузере, кода писать не нужно.

## Что уже готово в репозитории

| Что | Где |
| --- | --- |
| iOS-проект Capacitor, bundle id `tech.kuick.roscherk`, версия 0.3.0, только iPhone, портрет | `ios/App/` |
| Иконка 1024×1024 и заставка | `ios/App/App/Assets.xcassets/` |
| Облачная сборка → TestFlight | `codemagic.yaml` |
| Нативные плагины: вибрация (Haptics), статус-бар, заставка | `src/native.js`, сборка `node tools/build.mjs --native` |
| Политика конфиденциальности | https://etoevelina.github.io/roscherk/privacy.html |
| Тексты для страницы в App Store | ниже, раздел «Метаданные» |
| Скриншоты 6,9″ и 6,5″ | `store/screenshots/` |

## Шаги для владельца аккаунта Apple Developer

### 1. Приложение в App Store Connect (5 минут)
1. https://appstoreconnect.apple.com → **My Apps** → **+** → **New App**.
2. Platform: iOS. Name: **Росчерк**. Primary language: Russian. Bundle ID: нажать **Register a new
   bundle ID** (или заранее на https://developer.apple.com/account/resources/identifiers/list:
   **+** → App IDs → App → Description «Roscherk», Bundle ID **Explicit** `tech.kuick.roscherk`,
   Capabilities не нужны). SKU: `roscherk`. User access: Full.

### 2. Ключ App Store Connect API (3 минуты)
1. App Store Connect → **Users and Access** → **Integrations** → **App Store Connect API** → **Team Keys** → **+**.
2. Name: `codemagic`, Access: **App Manager**. Скачать `.p8` (скачивается один раз), запомнить **Issuer ID** и **Key ID**.

### 3. Codemagic (10 минут)
1. https://codemagic.io → войти через GitHub → **Add application** → выбрать репозиторий
   `etoevelina/roscherk` (Евелина добавит владельца аккаунта в репозиторий или даст доступ через
   GitHub App). Project type: **Other** (у нас `codemagic.yaml`).
2. **Teams → Personal account → Integrations → App Store Connect → Add key**: имя **`roscherk-asc`**
   (ровно так — оно указано в `codemagic.yaml`), Issuer ID, Key ID, файл `.p8`.
3. Apple Developer Portal → https://developer.apple.com/account → **Membership details** —
   убедиться, что роль **Account Holder** или **Admin** (нужно для автоматической подписи).
4. В приложении в Codemagic: **Start new build** → branch `main` → workflow **ios-release** → **Start new build**.
   Сборка ~15 минут. Codemagic сам создаст сертификат распространения и профиль, соберёт `.ipa`
   и загрузит в TestFlight.

Если сборка упала на подписи — чаще всего не хватает прав у ключа API (нужен App Manager) или
bundle id ещё не зарегистрирован (шаг 1).

### 4. Страница приложения (15 минут)
В App Store Connect → приложение → **App Store** → версия 0.3.0:
- **Screenshots**: загрузить файлы из `store/screenshots/6.9/` (iPhone 6,9″) и `store/screenshots/6.5/`
  (6,5″). Остальные размеры Apple масштабирует сам.
- **Promotional text, Description, Keywords, Support URL, Marketing URL** — скопировать из раздела
  «Метаданные» ниже.
- **Privacy Policy URL**: `https://etoevelina.github.io/roscherk/privacy.html`.
- **Category**: Primary — Games → Puzzle; Secondary — Education.
- **Age Rating**: ответить «No» на всё → 4+.
- **App Privacy** → **Get started** → **Data Not Collected** (приложение ничего не собирает).
- **Build**: выбрать сборку из TestFlight (появляется через 5–20 минут после загрузки; на письмо
  «Missing Compliance» отвечать не нужно — флаг `ITSAppUsesNonExemptEncryption = NO` уже стоит).
- **App Review Information**: контакт и заметка для ревьюера (ниже).
- **Version Release**: Manually release this version (или автоматически).
- **Add for Review** → **Submit to App Review**.

Ревью обычно 1–3 дня. Если отклонят по правилу 4.2 («минимальная функциональность»), в ответ
достаточно описать, что это офлайн-игра на 400 уровней с четырьмя режимами, без веб-контента
(текст заметки для ревьюера это уже объясняет).

### 5. Следующие версии
`git tag v0.3.1 && git push --tags` — Codemagic соберёт и отправит в TestFlight сам
(номер сборки растёт автоматически). В App Store Connect — создать новую версию, выбрать
сборку, Submit.

## Метаданные

**Name:** Росчерк
**Subtitle (до 30 символов):** Линии, потоки и слова
**Promotional text (до 170):**
Четыре режима логических головоломок: проведи одну линию через все клетки, соедини потоки,
обведи фигуру одним росчерком — и разгадай английские цитаты по словам.

**Description:**
Росчерк — спокойные логические головоломки для коротких пауз и долгих вечеров. Каждое решение
рисуется пальцем одной непрерывной линией, а четвёртый режим прокачивает английский.

• Маршрут — одна дорожка от 1 до последнего числа через все клетки, сквозь стены нельзя.
• Потоки — соедини пары точек, не пересекая дорожки, и заполни всё поле.
• Один штрих — обведи фигуру, пройдя каждый отрезок ровно один раз.
• Слова — английский акростих: отгадывай слова по определениям, их буквы встают в скрытую
  цитату. 20 тем, 700 слов уровня B2–C1 с переводами и 100 цитат классиков.

400 уровней кампании, ежедневный уровень с серией, режим «Бесконечность» с растущей сложностью.
Честные подсказки, отмена хода, звёзды за чистое прохождение. Работает полностью офлайн, без
рекламы, покупок и регистрации. Светлая и тёмная тема, поддержка VoiceOver и Dynamic Type.

**Keywords (до 100 символов):**
головоломка,логика,линия,потоки,кроссворд,английский,слова,puzzle,flow,zip,acrostic

**Support URL:** https://github.com/etoevelina/roscherk/issues
**Marketing URL:** https://etoevelina.github.io/roscherk/
**Privacy Policy URL:** https://etoevelina.github.io/roscherk/privacy.html
**Copyright:** 2026 Evelina Penkova

**Notes for App Review:**
Roscherk is a fully offline puzzle game (400 hand-verified levels across four modes: three
one-line drawing puzzles and an English acrostic word puzzle for Russian-speaking learners).
It is built with Capacitor; all game logic and content are bundled in the app, there is no web
content loaded from a server, no account, no purchases and no data collection. No login is
needed for review: open the app and tap «Играть» on any mode.

## Как собрать локально (если появится Xcode)
```sh
npm ci
node tools/build.mjs --native
npx cap sync ios
npx cap open ios      # Xcode → Product → Archive → Distribute
```
`@capacitor/cli` требует Node 22+ (`nvm use 22` или `npx -y node@22 npx cap sync ios`).
