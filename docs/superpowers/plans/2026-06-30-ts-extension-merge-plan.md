# Svaga+ TS Extension Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the former Tribute Alerts and Twitch Social Rating extension code into one TypeScript Svaga+ extension with one auth flow, one content entrypoint, and popup settings for Social Rating.

**Architecture:** Keep the implementation boring. Preserve existing working behavior, move owned JS to TypeScript, remove user-facing legacy auth, and avoid a full popup redesign. `socket.io.js` stays as vendor JS; everything else owned by the extension should be TS.

**Tech Stack:** Browser extension Manifest V3, TypeScript, Webpack, plain HTML/CSS popup, `webextension-polyfill`.

---

## Source Of Truth

- Spec: `docs/superpowers/specs/2026-06-30-ts-extension-merge-spec.md`
- Current older auth reference: `docs/superpowers/specs/2026-06-29-extension-unified-popup-auth-spec.md`
- Design reference for naming/style only: `/mnt/data/dev/Other projects/SvagaPlus/DESIGN-variant-3.md`

The current worktree is dirty from previous attempts. Do not revert unrelated files blindly. Keep useful current TS foundations, but remove live coupling to rejected flows.

## Target File Ownership

Create/keep:

```text
src/app/background.ts
src/app/content.ts
src/app/viewer-auth-callback.html
src/app/viewer-auth-callback.ts
src/popup/popup.html
src/popup/popup.ts
src/popup/popup.css
src/shared/api.ts
src/shared/browser.ts
src/shared/config.ts
src/shared/storage.ts
src/shared/twitch.ts
src/shared/types.ts
src/features/tribute-badges/*
src/features/social-rating/*
src/vendor/socket.io.js
```

Remove from live manifests:

```text
src/tribute-alerts/content/*
src/tribute-alerts/popup/*
src/social-rating/background/callback.html
```

Legacy `src/social-rating/background/service-worker.ts` and `src/social-rating/background/messages.ts` should either be deleted or become unreferenced compatibility code. They must not own app-level auth.

---

## Task 1: Tighten Viewer Auth Callback

**Files:**

- Modify: `src/app/background.ts`
- Modify: `src/app/viewer-auth-callback.ts`
- Modify: `src/shared/config.ts`

- [ ] In `src/app/background.ts`, accept `viewer:completeConnect` only from `viewer-auth-callback.html`.

Use this helper shape:

```ts
function isViewerAuthCallbackSender(sender: browser.Runtime.MessageSender): boolean {
  const senderUrl = sender.url || '';
  const expectedUrl = browser.runtime.getURL(VIEWER_AUTH_CALLBACK_PATH);
  return senderUrl.split('#')[0].split('?')[0] === expectedUrl;
}
```

- [ ] In the `viewer:completeConnect` case, reject non-callback senders:

```ts
if (!isViewerAuthCallbackSender(sender)) {
  return Promise.resolve({ ok: false, error: 'forbidden_sender' });
}
```

- [ ] In `src/app/viewer-auth-callback.ts`, clear the hash immediately after reading token:

```ts
const params = new URLSearchParams(globalThis.location.hash.replace(/^#/, ''));
const token = params.get('token');
if (globalThis.location.hash) {
  history.replaceState(null, '', globalThis.location.pathname);
}
```

- [ ] Run:

```bash
npm run build
```

Expected: build succeeds.

---

## Task 2: Move Popup To TypeScript Without Redesign

**Files:**

- Create: `src/popup/popup.html`
- Create: `src/popup/popup.ts`
- Create: `src/popup/popup.css`
- Modify: `manifest.json`
- Modify: `manifest.firefox.json`
- Modify: `webpack.config.js`

- [ ] Copy the useful current popup markup/style into `src/popup/popup.html` and `src/popup/popup.css`, but keep it smaller if the current file is bloated.
- [ ] Implement popup behavior in `src/popup/popup.ts`.
- [ ] Use shared background messages:

```ts
type PopupMessage =
  | { type: 'viewer:startConnect' }
  | { type: 'viewer:getAccount' }
  | { type: 'viewer:refreshAccount' }
  | { type: 'viewer:disconnect' }
  | { type: 'settings:get' }
  | { type: 'settings:update'; settings: { socialRatingEnabled?: boolean } };
```

- [ ] Popup disconnected state:
  - show one button: `Подключить аккаунт`;
  - click sends `viewer:startConnect`.
- [ ] Popup connected state:
  - show Twitch avatar/login from `viewer:getAccount`;
  - show Telegram linked/pending;
  - show `Открыть настройки`, opening `${FRONTEND_URL}/viewer/settings`;
  - show disconnect/switch only as secondary text button.
- [ ] Popup settings:
  - `Бейджи подписчиков`: enabled/read-only;
  - `Цвета ников`: enabled/read-only;
  - `Соц. рейтинг`: checkbox/toggle bound to `settings.socialRatingEnabled`.
- [ ] On toggle, send `settings:update`.
- [ ] Update manifests:

```json
"action": {
  "default_popup": "src/popup/popup.html"
}
```

- [ ] Update webpack entries:

```js
'src/popup/popup': './src/popup/popup.ts'
```

- [ ] Run:

```bash
npm run build
npm run build:firefox
```

Expected: both succeed.

---

## Task 3: Remove User-Facing Legacy TSR Auth

**Files:**

- Modify: `src/app/background.ts`
- Modify or delete from live path: `src/social-rating/background/service-worker.ts`
- Modify or delete from live path: `src/social-rating/background/messages.ts`
- Modify: `webpack.config.js`
- Modify: `manifest.firefox.json`

- [ ] `src/app/background.ts` should not import old `../social-rating/background/service-worker`.
- [ ] Move any still-needed social-rating API calls into `src/features/social-rating/api.ts` or `src/shared/api.ts`.
- [ ] Remove popup/UI paths that send:
  - `LOGIN`
  - `LOGOUT`
  - `OAUTH_CALLBACK`
  - `GET_AUTH`
- [ ] If old files remain, ensure webpack/manifest no longer reference them as active background auth.
- [ ] Search:

```bash
rg -n "LOGIN|LOGOUT|OAUTH_CALLBACK|GET_AUTH|/auth/twitch" src manifest.json manifest.firefox.json webpack.config.js
```

Expected: no live popup/background auth usage. Comments/docs are acceptable only if clearly marked as legacy and unreferenced.

---

## Task 4: Gate Social Rating By One Setting

**Files:**

- Modify: `src/app/content.ts`
- Modify: `src/shared/storage.ts`
- Modify: `src/platform/storage.ts` if it remains used
- Modify: `src/social-rating/content/index.ts` or move to `src/features/social-rating/index.ts`

- [ ] Use one settings source: `ExtensionSettings.socialRatingEnabled`.
- [ ] Default is true:

```ts
export const DEFAULT_EXTENSION_SETTINGS = {
  socialRatingEnabled: true,
};
```

- [ ] `src/app/content.ts` should do:

```ts
startTributeBadgesContent();

getExtensionSettings()
  .then((settings) => {
    if (settings.socialRatingEnabled) return startSocialRatingContent();
    return undefined;
  })
  .catch(() => undefined);
```

- [ ] If existing Social Rating cannot stop cleanly, popup text may say setting applies after page refresh.
- [ ] Search for old feature flag key:

```bash
rg -n "svagaplus_feature_flags|socialRating\\)" src
```

Expected: old flag either removed or compatibility-migrated to `ExtensionSettings.socialRatingEnabled`.

---

## Task 5: Finish Tribute Badges TS Split

**Files:**

- Modify/create under `src/features/tribute-badges/`

- [ ] Keep `src/vendor/socket.io.js` as the only JS content dependency.
- [ ] Ensure `src/features/tribute-badges/index.ts` is not one giant permanent file if easy. Minimum split:
  - `api.ts`
  - `dom.ts`
  - `native-chat.ts`
  - `seventv-chat.ts`
  - `usercard.ts`
  - `index.ts`
- [ ] Do not change behavior while splitting.
- [ ] Manifest content scripts must be:

```json
"js": [
  "src/vendor/socket.io.js",
  "src/app/content.js"
]
```

- [ ] Run:

```bash
npm run build
```

Expected: build succeeds.

---

## Task 6: Final Cleanup And Verification

**Files:**

- Modify: `README.md` only if it has old user-facing branding.
- Modify: manifests if needed.
- Delete: old unreferenced `src/tribute-alerts/popup/*` after popup has moved.
- Delete: old unreferenced `src/tribute-alerts/content/*` if present.

- [ ] Run:

```bash
npm run build
npm run build:firefox
git diff --check
```

Expected: all succeed.

- [ ] Run endpoint/branding grep:

```bash
rg -n "Tribute Alerts|\\bSwag\\b|\\bSocial\\b|/api/v2/badges|/ratings/|/channels/.*/badge-grants|/auth/twitch" src manifest.json manifest.firefox.json README.md
```

Expected:

- no user-facing popup text with old branding;
- no old endpoints in live code;
- `Social` may appear only in TypeScript identifiers such as `SocialRating`, not UI labels.

- [ ] Inspect built manifests:

```bash
rg -n "src/vendor/socket.io.js|src/app/content.js|src/popup/popup.html|tribute-alerts/content|tribute-alerts/popup" dist_chrome/manifest.json dist_firefox/manifest.json
```

Expected:

- contains `src/vendor/socket.io.js`;
- contains `src/app/content.js`;
- contains `src/popup/popup.html`;
- does not contain `tribute-alerts/content`;
- does not contain `tribute-alerts/popup`.

---

## Worker Stop Conditions

Stop and report `BLOCKED` if:

- full unified auth requires editing `/mnt/data/dev/Other projects/SvagaPlus Server`, because this plan is extension-repo only;
- Social Rating content cannot be gated without a larger rewrite;
- build failures come from unrelated dirty worktree changes.

Report changed files and exact verification output.

