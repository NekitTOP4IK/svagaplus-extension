# Свага+ Twitch Extension

Браузерное расширение Свага+ для Twitch.

Отображает кастомные бейджи, цвета ников и Соц. рейтинг прямо в чате Twitch.

---

## Установка

Скачать готовое расширение можно на странице установки проекта.

Поддерживаемые браузеры: **Chrome** и **Firefox**.

---

## Как это работает

Расширение встраивается в страницы `twitch.tv`, определяет текущий канал и Twitch-логин пользователя, загружает список зрителей с их бейджами и цветами ников, подключается к бэкенду по WebSocket для получения обновлений в реальном времени и отображает всё это в нативном чате и в режиме 7TV.

**Привязка аккаунта:** нажмите кнопку в попапе расширения, затем завершите viewer-connect.

**Настройки:** в попапе есть переключатель `Соц. рейтинг`; выключение действует после обновления вкладки Twitch.

---

## Структура проекта

```
├── manifest.json             # Manifest V3 — Chrome
├── manifest.firefox.json     # Manifest V3 — Firefox (gecko ID + update_url)
├── icons/
│   └── icon64.png
└── src/
    ├── app/
    │   ├── background.ts
    │   ├── background-firefox.ts
    │   ├── content.ts
    │   ├── viewer-auth-callback.html
    │   └── viewer-auth-callback.ts
    ├── popup/
    │   ├── popup.html
    │   ├── popup.css
    │   └── popup.ts
    ├── shared/
    │   ├── api.ts
    │   ├── browser.ts
    │   ├── config.ts
    │   ├── storage.ts
    │   ├── twitch.ts
    │   └── types.ts
    ├── features/
    │   ├── tribute-badges/
    │   └── social-rating/
    └── vendor/
        └── socket.io.js      # Vendor Socket.IO client
```

---

## Contributing

Pull request'ы и issue приветствуются.

---

## Лицензия

MIT — подробнее в [LICENSE](LICENSE).
