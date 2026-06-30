# Svaga+ Extension Unified Popup And Auth Spec

Date: 2026-06-29

## Purpose

Rewrite the extension as one coherent Svaga+ product instead of a Tribute Alerts + Twitch Social Rating merge. The popup must be a compact settings/status surface, the extension must use one viewer identity from the main Svaga+ service, and Social Rating must use current v3 backend contracts.

This spec replaces the previous popup direction in `docs/superpowers/plans/2026-06-29-popup-v3-badges-social-rating-plan.md`.

## Product Requirements

- Brand is `Свага+`.
- The rating feature names are `Свагометр` and `Соц. рейтинг`.
- Do not show `Swag`, `Social`, `Tribute Alerts`, or TSR branding in the user-facing popup.
- The popup must not show two independent authorizations.
- The popup must not show login and logout as equal primary actions at the same time.
- The Twitch avatar must come from the connected viewer profile. Do not replace it with a large Twitch icon.
- Subscriber badges and nickname colors are always enabled.
- Only Social Rating can be enabled or disabled from extension settings.
- The UI should follow `/mnt/data/dev/Other projects/SvagaPlus/DESIGN-variant-3.md`.

## Visual Direction

Use the Mercury-style Svaga+ dashboard language:

- Shell background: `#171721`.
- Main surface: `#1e1e2a`.
- Interactive surface: `#272735`.
- Primary text: `#ededf3`.
- Secondary text: `#c3c3cc`.
- Muted/border: `#70707d`.
- Primary action: `#5266eb`.
- Use Inter/Arcadia-style typography with light, airy hierarchy.
- Buttons are pill-shaped, radius `32px` to `40px`.
- Panels/cards are sharp or near-sharp, radius `0px` to `4px`.
- Do not use purple/green decorative gradients, glassmorphism, glows, oversized rounded cards, or emoji-as-icons.

Popup layout:

1. Header row:
   - Svaga+ icon.
   - `Свага+`.
   - Small state text: current channel or connection state.
2. Account block:
   - Twitch avatar from `/api/viewer/me`.
   - Twitch login.
   - Telegram linked state when available.
   - Primary action if disconnected: `Подключить аккаунт`.
   - Secondary action if connected: `Открыть настройки`.
   - Account switching/logout must be a quieter secondary or overflow action, not next to the primary connect action.
3. Feature settings:
   - `Бейджи подписчиков` read-only enabled.
   - `Цвета ников` read-only enabled.
   - `Соц. рейтинг` toggle.
4. Current channel:
   - Channel login.
   - Badge data status.
   - `Свагометр` and `Соц. рейтинг` values when the viewer token and channel are known and Social Rating is enabled.
5. Footer/status:
   - Compact error/loading state.
   - No large explanatory marketing copy.

## Current Auth Facts

Checked in `/mnt/data/dev/Other projects/SvagaPlus Server` on 2026-06-29.

### Frontend Viewer Connect

`frontend/src/pages/ViewerConnectPage.tsx` is the canonical viewer sign-in flow:

- If `api.getViewerToken()` exists, it navigates to `/viewer/settings`.
- If the URL has Twitch OAuth `code`, it calls:
  - `api.linkViewerTwitch(code, `${origin}/viewer-connect`)`
- On success it stores:
  - `api.setViewerToken(res.token)`
- If `res.telegram_linked === false`, it shows Telegram linking.
- Telegram linking calls:
  - `api.linkInitiate()`
  - Opens `https://t.me/${botUsername}?start=link_${res.token}`
  - Polls `api.getViewerMe()` until `is_linked === true`.

`frontend/src/services/api.ts` stores the viewer JWT as `viewer_token` and sends it as:

```http
Authorization: Bearer <viewer_token>
```

### Backend Viewer Endpoints

`POST /api/auth/twitch/viewer`

- Body:
  - `twitch_code`
  - `redirect_uri`
- Returns a viewer JWT token.
- If Telegram is not linked:

```json
{
  "success": true,
  "token": "jwt",
  "telegram_linked": false,
  "twitch_login": "viewer"
}
```

- If Telegram is linked:

```json
{
  "success": true,
  "token": "jwt",
  "data": {}
}
```

`GET /api/viewer/me`

- Requires viewer JWT.
- Returns:

```json
{
  "success": true,
  "twitch_username": "viewer",
  "avatar_url": "https://...",
  "color_banned": false,
  "color_ban_reason": null,
  "is_linked": true
}
```

`POST /api/extension/link-initiate`

- Requires viewer JWT.
- Returns:

```json
{
  "success": true,
  "token": "uuid"
}
```

The Telegram deep link is `https://t.me/<bot>?start=link_<token>`.

### Old Extension Auth To Remove From UX

The current extension still contains a second TSR auth flow:

- `src/social-rating/background/service-worker.ts`
- `src/social-rating/background/background-firefox.ts`
- `src/social-rating/background/callback.html`
- Backend legacy endpoints around `/auth/twitch`, `/auth/callback`, token refresh, and logout.

This flow must not be exposed as a separate user-facing authorization. The extension should authenticate as the same viewer account used by `/viewer-connect`.

## Required Auth Architecture

Browser extension pages cannot read the web app's `localStorage.viewer_token` directly. Therefore the implementation needs an explicit handoff from the Svaga+ web app to the extension.

Recommended flow:

1. Extension popup has no viewer token.
2. User clicks `Подключить аккаунт`.
3. Extension opens the web app route:

```text
<FRONTEND_URL>/viewer-connect?extension=1&return=<extension_callback_url>
```

4. `viewer-connect` runs the existing Twitch + Telegram flow.
5. When a valid viewer token exists, the frontend redirects to the extension callback URL with token payload:

```text
chrome-extension://<id>/viewer-auth-callback.html#token=<jwt>
```

Firefox equivalent should use the extension runtime URL for the callback page.

6. Extension callback sends the token to the background script.
7. Background stores:
   - `viewerToken`
   - `viewerLogin`
   - `avatarUrl`
   - `telegramLinked`
   - `lastViewerMeAt`
8. Background immediately calls `GET /api/viewer/me` to validate the token and hydrate the account block.
9. Popup reads account state from extension storage/background.

If backend/frontend cannot be changed in the same pass, the minimum acceptable interim behavior is:

- Popup opens `/viewer-connect`.
- Extension clearly says account connection is completed in the web dashboard.
- Subscriber badges still work through public v3 badge endpoints.
- Social Rating write actions remain unavailable until token handoff exists.

That interim mode is not the target final state.

## API Contracts

Use v3 endpoints for extension badge and rating work.

### Subscriber And Rating Badges

`GET /api/v3/channels/<channel_identifier>/viewers/<viewer_identifier>/badges`

`GET /api/v3/channels/<channel_identifier>/badges?viewers=<login1>,<login2>`

Response:

```json
{
  "success": true,
  "data": {
    "channel": {
      "id": "uuid",
      "login": "streamer",
      "twitch_channel_id": "2001"
    },
    "viewers": {
      "viewer": {
        "viewer": {
          "id": "uuid",
          "login": "viewer",
          "twitch_id": "1001"
        },
        "tra_badges": [
          {
            "id": "uuid",
            "title": "Founder",
            "url": "/badge.png"
          }
        ],
        "tsr_badges": [
          {
            "id": "uuid",
            "kind": "swag",
            "rank": 1,
            "period_id": "uuid",
            "url": "/swag.png",
            "active": true
          }
        ]
      }
    }
  }
}
```

Normalize both `tra_badges` and `tsr_badges` into one internal badge model, but preserve `source`.

### Social Rating

`GET /api/v3/social/channels/<channel>/status`

`GET /api/v3/social/channels/<channel>/viewers/<viewer>/rating`

`POST /api/v3/social/channels/<channel>/votes`

Body:

```json
{
  "target_login": "viewer",
  "value": 1
}
```

Rating response:

```json
{
  "success": true,
  "data": {
    "channel": {
      "login": "streamer",
      "rating_enabled": true,
      "activity_public": true
    },
    "viewer": {
      "login": "target",
      "avatar_url": null
    },
    "swag_score": 7,
    "social_score": 2,
    "enabled": true
  }
}
```

Alias endpoints should also use `/api/v3/social/aliases...` when the feature is enabled.

Do not use for new extension code:

- `/api/v2/badges/<channel>/status/<login>`
- `/api/v2/badges/<channel>/all`
- `/ratings/<channel>/<login>`
- `/channels/<channel>/badge-grants`
- `/channels/<channel>/ratings/<login>/adjust`
- The old extension `/auth/twitch` flow as a visible login path.

## Extension Architecture

Target structure:

```text
src/
  app/
    background.ts
    content.ts
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
      native-chat.ts
      seventv-chat.ts
      usercard.ts
      index.ts
    social-rating/
      api.ts
      cache.ts
      cards.ts
      chat-badges.ts
      aliases.ts
      ws.ts
      index.ts
```

Rules:

- Use TypeScript for new extension code.
- Do not keep one half in raw JS and one half in TS.
- Do not introduce a React popup unless explicitly requested.
- Manifest should load one content bundle through `src/app/content.ts`.
- Popup state should have one source of truth in `src/popup/popup.ts`.
- Remove direct global coupling such as `cachedUsers`, `currentChannelName`, and duplicated badge caches.
- Keep browser API access behind `src/shared/browser.ts` so Chrome/Firefox differences stay local.
- Keep storage keys and migrations in `src/shared/storage.ts`.

## State Model

Storage keys:

```ts
interface ExtensionSettings {
  socialRatingEnabled: boolean;
}

interface ViewerAccount {
  token: string;
  twitchLogin: string;
  avatarUrl: string | null;
  telegramLinked: boolean;
  lastCheckedAt: number;
}

interface RuntimeChannelState {
  channelLogin: string | null;
  ratingEnabledForChannel: boolean | null;
  lastUpdatedAt: number;
}
```

Defaults:

- `socialRatingEnabled: true`
- Subscriber badges: always enabled, no setting.
- Nick colors: always enabled, no setting.

Token validation:

- On startup, if a viewer token exists, call `GET /api/viewer/me`.
- If unauthorized, clear only `ViewerAccount`, not feature settings.
- Popup must show one disconnected state.

Cache:

- Badge cache key: `<channel_login>:<viewer_login>`.
- Badge cache TTL: 2 to 5 minutes.
- Batch pending viewer logins per channel to avoid one request per chat message.
- Rating cache key: `<channel_login>:<viewer_login>`.
- Rating cache TTL: about 30 seconds.
- Social Rating disabled means no rating requests and no rating UI injection.

## Content Behavior

On Twitch channel pages:

1. Detect channel login from URL/router/DOM.
2. Start subscriber badge feature always.
3. Start nickname color feature always if present in current code.
4. Start Social Rating feature only when `socialRatingEnabled === true`.
5. Fetch v3 badge data lazily for visible chat users and usercards.
6. Render:
   - Subscriber badges.
   - Social Rating badges from `tsr_badges`.
   - `Свагометр` / `Соц. рейтинг` values where the existing TSR UI expects rating data.

When settings change:

- Popup writes `socialRatingEnabled`.
- Background broadcasts a settings-changed message.
- Content enables/disables the social feature without reloading the page where practical.

## Non-Goals

- Do not redesign the Svaga+ dashboard.
- Do not change backend rating math.
- Do not change Telegram bot linking semantics unless needed for extension handoff.
- Do not add a second Twitch authorization.
- Do not preserve the current rejected popup layout.

## Acceptance Criteria

- Popup has one account block and one main authorization path.
- Disconnected state shows `Подключить аккаунт`, not a login/logout pair.
- Connected state shows Twitch login and the viewer avatar from `/api/viewer/me`.
- The user-facing strings are `Свага+`, `Свагометр`, and `Соц. рейтинг`.
- Subscriber badges are always active.
- Social Rating can be toggled off and stops its content injections/requests.
- v3 subscriber badges render in native Twitch chat, 7TV chat, and usercards.
- v3 Social Rating badges render where TSR badges were expected.
- Popup build and extension builds pass for Chrome and Firefox.
- Static search finds no old user-facing `Tribute Alerts`, `Swag`, `Social`, or old badge/rating endpoints in extension source, except migration notes/tests/docs.

