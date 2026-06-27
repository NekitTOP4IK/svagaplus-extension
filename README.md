# Tribute Alerts Twitch Extension

Браузерное расширение для сервиса [Tribute Alerts](https://tributealerts.nekittop4ik.space).

Отображает кастомные бейджи и цвета ников подписчиков Tribute прямо в чате Twitch — в нативном чате и в режиме 7TV.

---

## Установка

Скачать готовое расширение можно на [странице установки](https://tributealerts.nekittop4ik.space/extension/download).

Поддерживаемые браузеры: **Chrome (или иные браузеры на Chromium)** (Web Store / ZIP), **Firefox** (AMO / .xpi).

---

## Как это работает

Расширение встраивается в страницы `twitch.tv`, определяет текущий канал и Twitch-логин пользователя, загружает список подписчиков с их бейджами и цветами ников, подключается к бэкенду по WebSocket для получения обновлений в реальном времени и отображает всё это в нативном чате и в режиме 7TV.

**Привязка аккаунта:** нажмите кнопку в попапе расширения → откроется Telegram-бот → подтвердите привязку Twitch к Tribute.

**Отвязка аккаунта:** выполняется через [страницу настроек](https://tributealerts.nekittop4ik.space/viewer/settings) — там личность пользователя подтверждается на 100%.

---

## Структура проекта

```
├── manifest.json             # Manifest V3 — Chrome
├── manifest.firefox.json     # Manifest V3 — Firefox (gecko ID + update_url)
├── CHANGELOG.md
├── icons/
│   └── icon64.png
└── src/
    ├── config.js             # Глобальный CONFIG: BACKEND_URL, BOT_USERNAME
    ├── content/
    │   ├── core.js           # Ядро: кэш пользователей, fetchBadges, initSocket, tooltip
    │   ├── observer.js       # MutationObserver — запускает всю систему
    │   ├── twitch.js         # Нативный чат Twitch (.chat-line__message)
    │   ├── seventv.js        # Чат 7TV (.seventv-message)
    │   ├── usercard.js       # Карточки пользователей (7TV + нативная Twitch)
    │   ├── styles.css        # Стили бейджей и тултипа
    │   └── socket.io.js      # Socket.IO клиент v4.7.5 (unminified)
    └── popup/
        ├── popup.html        # UI попапа со всеми состояниями
        ├── popup.js          # Логика попапа: статус, привязка, polling, баннер обновления
        └── tribute-alerts.svg
```

---

## Contributing

Pull request'ы и issue приветствуются.

---

## Лицензия

MIT — подробнее в [LICENSE](LICENSE).
