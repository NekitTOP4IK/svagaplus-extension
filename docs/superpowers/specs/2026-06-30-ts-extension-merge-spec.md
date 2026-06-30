# Svaga+ TS Extension Merge Spec

Date: 2026-06-30

## Goal

Merge the former Tribute Alerts extension and Twitch Social Rating extension into one Svaga+ browser extension. The extension should feel like one product, use TypeScript for all owned runtime code, use one viewer authorization flow, and keep the popup visually close to the current style for now.

## Scope For This Pass

Do:

- Keep one content entrypoint: `src/app/content.ts`.
- Keep one background entrypoint: `src/app/background.ts` for Chrome and `src/app/background-firefox.ts` only as Firefox compatibility if needed.
- Keep owned runtime code in TypeScript.
- Keep `src/vendor/socket.io.js` as vendor JS. Do not rewrite it.
- Keep popup style mostly as-is, but move popup logic to TypeScript and add settings.
- Add one setting: enable/disable `Соц. рейтинг`.
- Subscriber badges and nickname colors are always enabled.
- Remove user-facing old TSR login/logout.
- Use the unified viewer account stored by the extension from the Svaga+ viewer-connect handoff.
- Use v3 backend endpoints.

Do not:

- Add React.
- Add new dependencies.
- Redesign popup from scratch.
- Keep two visible authorization systems.
- Keep live extension code under `src/tribute-alerts/content`.
- Use `/api/v2/badges`, `/ratings/...`, or old extension `/auth/twitch` as a user-facing auth flow.

## Target Structure

```text
src/
  app/
    background.ts
    background-firefox.ts
    content.ts
    viewer-auth-callback.html
    viewer-auth-callback.ts
  popup/
    popup.html
    popup.ts
    popup.css
  shared/
    api.ts
    browser.ts
    config.ts
    storage.ts
    twitch.ts
    types.ts
  features/
    tribute-badges/
      api.ts
      cache.ts
      dom.ts
      native-chat.ts
      seventv-chat.ts
      usercard.ts
      index.ts
      styles.css
    social-rating/
      api.ts
      cache.ts
      chat-badges.ts
      cards.ts
      aliases.ts
      ws.ts
      index.ts
  vendor/
    socket.io.js
```

Temporary compatibility is acceptable only when it is not user-facing and does not block builds. Add a short comment where compatibility remains.

## Unified Auth

The extension must use one viewer account:

1. Popup sends `viewer:startConnect`.
2. Background opens:

```text
<FRONTEND_URL>/viewer-connect?extension=1&return=<extension callback URL>
```

3. Svaga+ frontend completes viewer-connect.
4. Frontend redirects to extension callback:

```text
chrome-extension://<id>/src/app/viewer-auth-callback.html#token=<viewer_jwt>
```

5. Callback sends `viewer:completeConnect` to background.
6. Background validates the token with `GET /api/viewer/me`.
7. Background stores:

```ts
interface ViewerAccount {
  token: string;
  twitchLogin: string;
  avatarUrl: string | null;
  telegramLinked: boolean;
  lastCheckedAt: number;
}
```

Security requirements:

- `viewer:completeConnect` must only be accepted from `viewer-auth-callback.html`.
- Callback must clear `location.hash` with `history.replaceState` after reading token.
- Invalid viewer token clears only account state, not feature settings.

The old TSR auth messages `LOGIN`, `LOGOUT`, `OAUTH_CALLBACK`, old refresh-token storage, and old `/auth/twitch` flow must not be reachable from popup UI.

## Settings

Storage:

```ts
interface ExtensionSettings {
  socialRatingEnabled: boolean;
}
```

Default:

```ts
{ socialRatingEnabled: true }
```

Popup behavior:

- Show `Бейджи подписчиков`: enabled/read-only.
- Show `Цвета ников`: enabled/read-only.
- Show `Соц. рейтинг`: toggle.
- Toggle writes settings and sends a settings-changed message to active Twitch tabs.
- If live disable is hard, content can require page refresh. Popup copy must say this plainly.

Content behavior:

- `startTributeBadgesContent()` always runs.
- `startSocialRatingContent()` runs only when `socialRatingEnabled` is true.
- Social Rating feature must listen for settings changes if the current implementation can stop cleanly. Otherwise avoid starting when disabled and document refresh requirement.

## Popup

Keep the old visual style for this pass, but fix product behavior:

- Brand: `Свага+`.
- Labels: `Свагометр`, `Соц. рейтинг`.
- No `Swag`, `Social`, `Tribute Alerts` in user-visible popup text.
- One account block:
  - disconnected: `Подключить аккаунт`;
  - connected: Twitch avatar/login from viewer account, Telegram status, `Открыть настройки`;
  - disconnect/switch is secondary only.
- No simultaneous primary login/logout buttons.
- Settings are always visible or one click away.

## APIs

Use:

- `GET /api/viewer/me`
- `POST /api/extension/link-initiate`
- `GET /api/v3/channels/<channel>/viewers/<viewer>/badges`
- `GET /api/v3/channels/<channel>/badges?viewers=<comma-list>`
- `GET /api/v3/social/channels/<channel>/status`
- `GET /api/v3/social/channels/<channel>/viewers/<viewer>/rating`
- `POST /api/v3/social/channels/<channel>/votes`
- `/api/v3/social/aliases...`

Do not use in live code:

- `/api/v2/badges`
- `/ratings/`
- `/channels/<channel>/badge-grants`
- `/auth/twitch` for popup/user login

## Acceptance

- `npm run build` passes.
- `npm run build:firefox` passes.
- Manifest content scripts load only `src/vendor/socket.io.js` and `src/app/content.js`.
- Manifest popup points to `src/popup/popup.html`.
- No live source files remain in `src/tribute-alerts/content`.
- Popup can toggle Social Rating.
- Disabled Social Rating does not start content Social Rating on page load.
- Subscriber badges still start regardless of Social Rating setting.
- Viewer token completion is sender-restricted and clears URL hash.
- Grep finds no old endpoints in live extension code except legacy compatibility comments/docs.

