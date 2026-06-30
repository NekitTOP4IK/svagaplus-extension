# Svaga+ Extension Unified Popup/Auth Rewrite Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to execute this plan. Use `superpowers:test-driven-development` for behavior changes and `superpowers:verification-before-completion` before reporting completion.

**Goal:** Rewrite the extension into one coherent Svaga+ extension with a compact Mercury-style popup, one viewer-connect based authorization flow, current v3 badge/rating endpoints, and a structured TypeScript codebase.

**Spec:** `docs/superpowers/specs/2026-06-29-extension-unified-popup-auth-spec.md`

**Architecture:** Replace the current mixed JS/TS feature split with shared TypeScript modules and feature folders. The web app remains the canonical owner of viewer authentication; the extension receives a viewer token through an explicit handoff.

**Tech Stack:** Browser extension Manifest V3, TypeScript, Webpack, plain HTML/CSS popup, `webextension-polyfill`, Svaga+ Flask backend + React frontend.

---

## Pre-Flight

- [ ] Read the spec.
- [ ] Inspect current worktree with `git status --short`.
- [ ] Do not revert unrelated user changes.
- [ ] Treat current popup work as rejected unless it clearly matches the new spec.
- [ ] Confirm the backend/frontend routes in `/mnt/data/dev/Other projects/SvagaPlus Server` if they changed after 2026-06-29.

Expected important backend/frontend files:

- Server frontend: `/mnt/data/dev/Other projects/SvagaPlus Server/frontend/src/pages/ViewerConnectPage.tsx`
- Server frontend API client: `/mnt/data/dev/Other projects/SvagaPlus Server/frontend/src/services/api.ts`
- Backend viewer auth: `/mnt/data/dev/Other projects/SvagaPlus Server/backend/routes/twitch_auth.py`
- Backend viewer API: `/mnt/data/dev/Other projects/SvagaPlus Server/backend/routes/viewer_colors.py`
- Backend extension linking: `/mnt/data/dev/Other projects/SvagaPlus Server/backend/routes/extension.py`
- Extension root: `/mnt/data/dev/Other projects/SvagaPlus Extension`

---

## Task 1: Add/Confirm Extension Auth Handoff In Server Frontend

This task is in `/mnt/data/dev/Other projects/SvagaPlus Server`.

If the frontend already has an extension handoff page, adapt to it. If it does not, add the minimal flow below.

- [ ] Add support for `extension=1` and `return=<extension_callback_url>` to the viewer-connect flow.
- [ ] Preserve the existing web dashboard behavior when these query params are absent.
- [ ] After `viewer_token` exists and Telegram linking is resolved or intentionally pending, redirect to the extension callback URL:

```text
<extension_callback_url>#token=<viewer_jwt>
```

- [ ] Validate that the callback URL is an extension URL before redirecting.
- [ ] Do not log the token.
- [ ] Do not put the token in server logs.
- [ ] Keep the existing `/viewer/settings` redirect for normal browser users.

Implementation notes:

- `ViewerConnectPage.tsx` already calls `api.linkViewerTwitch(code, `${origin}/viewer-connect`)`.
- The extension flow likely needs to preserve `extension=1&return=...` while Twitch OAuth returns to `/viewer-connect`.
- If the backend redirect whitelist rejects this, update the whitelist/config rather than adding a new auth endpoint.

Verification:

- [ ] Web `/viewer-connect` still works without extension params.
- [ ] `/viewer-connect?extension=1&return=<valid-extension-url>` returns the token to the extension callback after auth.
- [ ] Telegram linking still uses `POST /api/extension/link-initiate`.

---

## Task 2: Create Shared Extension Foundation

Files in `/mnt/data/dev/Other projects/SvagaPlus Extension`.

Create or replace:

```text
src/shared/browser.ts
src/shared/config.ts
src/shared/storage.ts
src/shared/api.ts
src/shared/twitch.ts
src/shared/types.ts
```

- [ ] `browser.ts`: export one browser API wrapper based on `webextension-polyfill`.
- [ ] `config.ts`: export backend/frontend base URLs and extension callback path.
- [ ] `types.ts`: define `ExtensionSettings`, `ViewerAccount`, `RuntimeChannelState`, `V3Badge`, `V3ViewerBadges`, `SocialRating`.
- [ ] `storage.ts`: implement typed get/set/clear for settings and viewer account.
- [ ] Default settings must be:

```ts
{
  socialRatingEnabled: true
}
```

- [ ] `api.ts`: implement:
  - `getViewerMe(token)`
  - `getChannelViewerBadges(channel, viewer)`
  - `getChannelBadges(channel, viewers)`
  - `getSocialChannelStatus(channel, token?)`
  - `getSocialRating(channel, viewer, token?)`
  - `postSocialVote(channel, targetLogin, value, token)`
  - alias helpers under `/api/v3/social/aliases...`
- [ ] `twitch.ts`: implement channel login detection helpers used by content and popup.

Constraints:

- Use `/api/v3/...` for badges and social rating.
- Use viewer JWT for viewer/private actions.
- Do not use old `/auth/twitch` extension auth from the popup path.

Verification:

- [ ] Add focused unit tests if the repo has a test runner.
- [ ] If there is no test runner, at least run `npm run build` after this task.

---

## Task 3: Replace Background Auth With Viewer Account State

Modify:

```text
src/app/background.ts
src/social-rating/background/service-worker.ts
src/social-rating/background/background-firefox.ts
src/social-rating/background/callback.html
```

Create:

```text
src/app/viewer-auth-callback.html
src/app/viewer-auth-callback.ts
```

- [ ] Add background message handlers:
  - `viewer:startConnect`
  - `viewer:completeConnect`
  - `viewer:getAccount`
  - `viewer:refreshAccount`
  - `viewer:disconnect`
  - `settings:get`
  - `settings:update`
- [ ] `viewer:startConnect` opens:

```text
<FRONTEND_URL>/viewer-connect?extension=1&return=<runtime URL for viewer-auth-callback.html>
```

- [ ] `viewer-auth-callback.ts` reads `location.hash`, extracts `token`, sends `viewer:completeConnect`, then shows a compact success/error screen.
- [ ] `viewer:completeConnect` stores token, validates with `GET /api/viewer/me`, then stores login/avatar/telegram state.
- [ ] On browser startup/install, validate stored token with `GET /api/viewer/me`.
- [ ] Remove old TSR login/logout from the popup flow.
- [ ] Keep legacy background files only as compatibility wrappers if the manifest still requires them during migration.

Verification:

- [ ] Popup can start auth.
- [ ] Callback can store a token.
- [ ] Invalid token is cleared.
- [ ] No UI path opens old `/auth/twitch`.

---

## Task 4: Build The New Popup

Replace the rejected popup with:

```text
src/popup/popup.html
src/popup/popup.ts
src/popup/popup.css
```

Update manifest/webpack entries accordingly.

- [ ] Header shows icon, `Свага+`, and current channel/status.
- [ ] Disconnected account state:
  - Primary button: `Подключить аккаунт`.
  - No logout button.
- [ ] Connected account state:
  - Twitch avatar from `ViewerAccount.avatarUrl`.
  - Twitch login.
  - Telegram linked/pending state.
  - Primary/secondary action: `Открыть настройки`.
  - Quiet account switch/disconnect action only if needed.
- [ ] Feature rows:
  - `Бейджи подписчиков`: enabled, read-only.
  - `Цвета ников`: enabled, read-only.
  - `Соц. рейтинг`: real toggle bound to `settings.socialRatingEnabled`.
- [ ] Current channel block:
  - Shows channel login if detected.
  - Shows badge fetch state.
  - Shows `Свагометр` and `Соц. рейтинг` values if available.
- [ ] Loading and error states must fit inside popup without layout jumps.
- [ ] Use design tokens from the spec.
- [ ] Do not show `Swag`, `Social`, `Tribute Alerts`, or a large Twitch placeholder.

Verification:

- [ ] Open popup locally through an extension build.
- [ ] Check disconnected, connected, loading, token-expired, social-disabled states.
- [ ] Verify text fits at extension popup width.

---

## Task 5: Port Subscriber Badge Feature To Structured TypeScript

Create:

```text
src/features/tribute-badges/api.ts
src/features/tribute-badges/cache.ts
src/features/tribute-badges/native-chat.ts
src/features/tribute-badges/seventv-chat.ts
src/features/tribute-badges/usercard.ts
src/features/tribute-badges/index.ts
```

Replace behavior currently spread across:

```text
src/tribute-alerts/content/core.js
src/tribute-alerts/content/twitch.js
src/tribute-alerts/content/seventv.js
src/tribute-alerts/content/usercard.js
```

- [ ] Fetch badges through:
  - `GET /api/v3/channels/<channel>/viewers/<viewer>/badges`
  - `GET /api/v3/channels/<channel>/badges?viewers=<comma-list>`
- [ ] Normalize `tra_badges` and `tsr_badges`.
- [ ] Render subscriber badges in native Twitch chat.
- [ ] Render subscriber badges in 7TV chat.
- [ ] Render subscriber badges in usercards.
- [ ] Preserve existing DOM safety checks and avoid duplicate badge injection.
- [ ] Add a per-channel/per-viewer cache with TTL.
- [ ] Batch visible chat users where possible.
- [ ] Subscriber badges must not depend on Social Rating toggle.

Verification:

- [ ] In a channel with known grants, badge appears in native chat.
- [ ] In a channel with 7TV chat active, badge appears there too.
- [ ] Usercard badge appears for known viewer.
- [ ] Turning Social Rating off does not remove subscriber badges.

---

## Task 6: Port Social Rating Feature To Structured TypeScript

Create:

```text
src/features/social-rating/api.ts
src/features/social-rating/cache.ts
src/features/social-rating/cards.ts
src/features/social-rating/chat-badges.ts
src/features/social-rating/aliases.ts
src/features/social-rating/ws.ts
src/features/social-rating/index.ts
```

Replace behavior currently spread across:

```text
src/social-rating/content/*.ts
src/social-rating/background/shared.ts
```

- [ ] Read `settings.socialRatingEnabled` before starting.
- [ ] If disabled, do not fetch ratings, inject rating UI, open rating websocket, or attach vote controls.
- [ ] Use:
  - `GET /api/v3/social/channels/<channel>/status`
  - `GET /api/v3/social/channels/<channel>/viewers/<viewer>/rating`
  - `POST /api/v3/social/channels/<channel>/votes`
  - `/api/v3/social/aliases...`
- [ ] Render labels as `Свагометр` and `Соц. рейтинг`.
- [ ] Use `tsr_badges` from v3 badge payload for rating badges.
- [ ] Vote/write actions require `ViewerAccount.token`.
- [ ] Read-only display may work without token only if backend endpoint allows it.
- [ ] React to settings-changed messages and remove injected Social Rating UI when disabled.

Verification:

- [ ] Social badges render when enabled.
- [ ] Social UI disappears or stops updating when disabled.
- [ ] Vote request includes viewer JWT.
- [ ] No old `/ratings/` endpoint is called.

---

## Task 7: Collapse App Entry Points And Manifests

Modify:

```text
manifest.json
manifest.firefox.json
webpack.config.js
src/app/content.ts
src/app/background.ts
```

- [ ] Manifest popup points to `src/popup/popup.html` build output.
- [ ] Manifest content script points to one content bundle.
- [ ] Manifest background points to one background bundle per browser target.
- [ ] Remove direct loading of raw legacy JS files from manifests.
- [ ] Keep Chrome/Firefox differences in manifest config and `shared/browser.ts`, not feature code.
- [ ] Update branding:
  - Extension name: `Свага+`
  - Description: no `Tribute Alerts`
  - Icon path remains stable until the compressed new icon is added.

Verification:

- [ ] `npm run build`
- [ ] `npm run build:firefox`
- [ ] Inspect built manifests and ensure correct popup/background/content files.

---

## Task 8: Remove Or Quarantine Legacy Code

- [ ] Delete replaced raw JS modules only after the TypeScript feature modules work.
- [ ] If deletion is too risky in one pass, move legacy imports out of manifests and leave files unreferenced temporarily.
- [ ] Remove user-facing old copy from:
  - `README.md`
  - manifests
  - popup HTML/TS
  - content UI strings
- [ ] Keep docs/migration notes if useful, but do not let old endpoints remain in live code.

Search checks:

```bash
rg -n "Tribute Alerts|\\bSwag\\b|\\bSocial\\b|/api/v2/badges|/ratings/|/channels/.*/badge-grants|/auth/twitch" src manifest.json manifest.firefox.json README.md
```

Expected: no matches in live extension source, except deliberate internal compatibility comments if still needed.

---

## Task 9: Manual End-To-End Verification

Build:

```bash
npm run build
npm run build:firefox
```

Manual browser checks:

- [ ] Fresh install, no token: popup shows one `Подключить аккаунт` action.
- [ ] Connect through `/viewer-connect`: extension stores viewer token and shows account.
- [ ] Telegram not linked: popup shows pending/linked state accurately.
- [ ] Token expired/invalid: extension clears account and returns to disconnected state.
- [ ] Twitch channel page: subscriber badges render.
- [ ] Twitch channel page: Social Rating badges render when enabled.
- [ ] Toggle `Соц. рейтинг` off: rating requests and rating UI stop.
- [ ] Toggle `Соц. рейтинг` on: rating feature starts again.
- [ ] Usercard: badges and rating data render without duplicates.
- [ ] 7TV chat: badges render if the old extension supported it.

Network checks:

- [ ] Badge requests use `/api/v3/channels/...`.
- [ ] Rating requests use `/api/v3/social/...`.
- [ ] Viewer profile uses `/api/viewer/me`.
- [ ] Telegram linking uses `/api/extension/link-initiate`.
- [ ] No visible user action calls old `/auth/twitch`.

---

## Task 10: Code Quality Review Handoff

Before asking for review:

- [ ] Run `git diff --check`.
- [ ] Run both builds.
- [ ] Include screenshots or a short visual state list for popup states.
- [ ] Include the endpoint grep output.
- [ ] Ask reviewer to focus on:
  - single-auth correctness,
  - token handling,
  - old endpoint removal,
  - social toggle behavior,
  - duplicate DOM injection,
  - Chrome/Firefox manifest parity,
  - UI consistency with `DESIGN-variant-3.md`.

Do not claim completion if the frontend extension handoff is not implemented. In that case, report the extension as having an interim connect button only, and mark Social Rating write actions blocked by missing token handoff.

