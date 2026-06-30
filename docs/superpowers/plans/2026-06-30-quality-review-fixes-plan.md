# Svaga+ Quality Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the quality-review blockers from the TS extension merge before manual browser testing.

**Architecture:** Keep the repair small. Fix extension auth callback access, validate runtime messages at the background boundary, and remove live non-v3 admin/moderator routes instead of inventing new backend contracts. Do not redesign popup or refactor unrelated Social Rating UI.

**Tech Stack:** Browser extension Manifest V3, TypeScript, Webpack, plain popup HTML/CSS, `webextension-polyfill`.

---

## Source Of Truth

Primary plan:

- `docs/superpowers/plans/2026-06-30-ts-extension-merge-plan.md`

Quality review findings to fix:

1. `src/app/viewer-auth-callback.html` is not web-accessible, so `viewer-connect` may fail to redirect into the extension.
2. Live non-v3 `/channels/...` routes remain in `src/social-rating/background/shared.ts`.
3. `src/app/background.ts` accepts loosely-shaped messages and casts them with `as`.

Do not expand scope beyond these fixes. Manual browser testing happens after this plan.

## Subagent Development Instructions

Use `superpowers:subagent-driven-development` like this:

1. Dispatch one `gpt-5.4-mini` worker with this plan and the current spec.
2. Worker implements all tasks in this file.
3. When worker reports done, do not trust the report.
4. Run the verification commands locally.
5. Dispatch one `gpt-5.5` code-quality reviewer with this plan and the resulting diff.
6. Fix any P1/P2 review findings before manual browser testing.

Worker prompt must include:

```text
Work only in /mnt/data/dev/Other projects/SvagaPlus Extension.
Do not edit Server repo.
Do not redesign popup.
Do not reintroduce old TSR /auth/twitch auth.
Do not add dependencies.
Fix only the three quality-review findings.
```

---

## Task 1: Make Viewer Auth Callback Reachable

**Files:**

- Modify: `manifest.json`
- Modify: `manifest.firefox.json`

- [ ] **Step 1: Add callback HTML to `web_accessible_resources`**

In both manifests, change the resources array from:

```json
"resources": [
  "icons/*"
]
```

to:

```json
"resources": [
  "icons/*",
  "src/app/viewer-auth-callback.html"
]
```

Keep the existing Twitch matches:

```json
"matches": [
  "*://*.twitch.tv/*"
]
```

Add the frontend/backend origin match used by the extension build. Because manifests use placeholders before Webpack transforms them, include:

```json
"matches": [
  "*://*.twitch.tv/*",
  "__FRONTEND_URL__/*"
]
```

- [ ] **Step 2: Update `webpack.config.js` placeholder replacement if needed**

If `__FRONTEND_URL__` is not replaced in manifests, add this replacement in the manifest transform:

```js
.replace(/__FRONTEND_URL__/g, frontend)
```

Place it next to the existing `__BACKEND_URL__` replacement.

- [ ] **Step 3: Build and inspect manifests**

Run:

```bash
npm run build
npm run build:firefox
rg -n "viewer-auth-callback.html|__FRONTEND_URL__" dist_chrome/manifest.json dist_firefox/manifest.json
```

Expected:

- both built manifests contain `src/app/viewer-auth-callback.html`;
- neither built manifest contains literal `__FRONTEND_URL__`.

---

## Task 2: Add Minimal Runtime Message Validation

**Files:**

- Modify: `src/app/background.ts`
- Modify: `src/shared/storage.ts`

- [ ] **Step 1: Add small validators in `src/app/background.ts`**

Add these helpers near the top of the file:

```ts
const LOGIN_RE = /^[a-z0-9_]{3,25}$/;
const MAX_ALIAS_LENGTH = 64;
const MAX_IMPORT_ALIASES = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeLogin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const login = value.trim().toLowerCase();
  return LOGIN_RE.test(login) ? login : null;
}

function normalizeAlias(value: unknown, allowEmpty = true): string | null {
  if (typeof value !== 'string') return null;
  const alias = value.trim();
  if (!allowEmpty && alias.length === 0) return null;
  return alias.length <= MAX_ALIAS_LENGTH ? alias : null;
}

function badRequest(): Promise<{ ok: false; error: 'bad_request' }> {
  return Promise.resolve({ ok: false, error: 'bad_request' });
}
```

- [ ] **Step 2: Validate `settings:update`**

Replace the current unchecked settings patch handling with:

```ts
case 'settings:update': {
  const patch = (message as { settings?: unknown }).settings;
  if (!isRecord(patch)) return badRequest();

  const nextPatch: Partial<ExtensionSettings> = {};
  if ('socialRatingEnabled' in patch) {
    if (typeof patch.socialRatingEnabled !== 'boolean') return badRequest();
    nextPatch.socialRatingEnabled = patch.socialRatingEnabled;
  }

  return setExtensionSettings(nextPatch).then(async (settings) => {
    await broadcastSettingsChanged(settings);
    return { ok: true, settings };
  });
}
```

- [ ] **Step 3: Validate social-rating message parameters before calling handlers**

Use this pattern in each case:

```ts
case 'FETCH_RATING': {
  const login = normalizeLogin((message as { login?: unknown }).login);
  const channelLogin = normalizeLogin((message as { channelLogin?: unknown }).channelLogin);
  if (!login || !channelLogin) return badRequest();
  return fetchRatingForCard(login, channelLogin);
}
```

Required cases:

- `GET_USER_RATING`: validate `channelLogin`
- `FETCH_RATING`: validate `login`, `channelLogin`
- `FETCH_BADGE_GRANTS`: validate `channelLogin`, `logins` array, max 100, every login valid
- `PREFETCH_CHANNEL_BADGE_GRANTS`: validate `channelLogin`
- `REFRESH_CHANNEL_BADGE_GRANTS`: validate `channelLogin`
- `GET_CHANNEL_BADGE_GRANTS_FOR_LOGIN`: validate `channelLogin`, `login`
- `CAST_VOTE`: validate `channelLogin`, `login`, `value === 1 || value === -1`
- `SET_ALIAS`: validate `login`, alias length <= 64
- `DELETE_ALIAS`: validate `login`
- `IMPORT_ALIASES`: validate array max 1000 and every `{ login, alias }`

Do not keep casts that can pass `undefined` into backend URLs.

- [ ] **Step 4: Harden stored settings in `src/shared/storage.ts`**

Change `getExtensionSettings()` so stored garbage cannot enable Social Rating by truthiness:

```ts
export async function getExtensionSettings(): Promise<ExtensionSettings> {
  const stored = await readValue<unknown>(SETTINGS_KEY);
  if (!isRecord(stored)) return { ...DEFAULT_EXTENSION_SETTINGS };
  return {
    socialRatingEnabled: typeof stored.socialRatingEnabled === 'boolean'
      ? stored.socialRatingEnabled
      : DEFAULT_EXTENSION_SETTINGS.socialRatingEnabled,
  };
}
```

Change `setExtensionSettings()` so it writes only known typed fields:

```ts
export async function setExtensionSettings(patch: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const current = await getExtensionSettings();
  const next: ExtensionSettings = {
    socialRatingEnabled: typeof patch.socialRatingEnabled === 'boolean'
      ? patch.socialRatingEnabled
      : current.socialRatingEnabled,
  };
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
```

- [ ] **Step 5: Build**

Run:

```bash
npm run build
```

Expected: build succeeds.

---

## Task 3: Remove Live Non-v3 Admin/Moderator Routes

**Files:**

- Modify: `src/app/background.ts`
- Modify: `src/social-rating/background/shared.ts`
- Modify: `src/social-rating/content/card-injector.ts`

Current bad routes:

- `GET /channels/<channel>/me/permissions`
- `GET /channels/<channel>/moderators`
- `POST /channels/<channel>/moderators`
- `DELETE /channels/<channel>/moderators/<target>`

This plan does not have confirmed v3 replacements. The safe repair is to disable this admin/moderator UI until backend contracts are confirmed.

- [ ] **Step 1: Remove live background message cases for admin/moderator controls**

In `src/app/background.ts`, remove these cases:

- `GET_CHANNEL_PERMISSIONS`
- `ADJUST_CHANNEL_RATING`
- `GET_CHANNEL_MODERATORS`
- `ADD_CHANNEL_MODERATOR`
- `REMOVE_CHANNEL_MODERATOR`

Also remove their imports from `../social-rating/background/shared`.

- [ ] **Step 2: Replace old route functions with disabled stubs or delete them**

In `src/social-rating/background/shared.ts`, remove functions that call `/channels/...`, or replace them with disabled stubs that do not call network:

```ts
export async function getChannelPermissions(): Promise<null> {
  return null;
}

export async function getChannelModerators(): Promise<null> {
  return null;
}

export async function addChannelModerator(): Promise<{ ok: false; error: 'admin_disabled' }> {
  return { ok: false, error: 'admin_disabled' };
}

export async function removeChannelModerator(): Promise<{ ok: false; error: 'admin_disabled' }> {
  return { ok: false, error: 'admin_disabled' };
}
```

Prefer deletion if TypeScript consumers no longer need these exports.

- [ ] **Step 3: Remove admin/moderator UI calls from `card-injector.ts`**

Remove or disable:

- `getChannelPermissions(...)`
- `getChannelModerators(...)`
- `sendModeratorAction(...)`
- pencil rating adjustment UI if it depends on `GET_CHANNEL_PERMISSIONS`
- sword moderator toggle UI

Keep normal rating display and vote buttons.

The intended result: usercards still show rating and voting, but do not show admin pencil/sword controls until v3 admin APIs are specified.

- [ ] **Step 4: Verify route removal**

Run:

```bash
rg -n "/channels/|GET_CHANNEL_PERMISSIONS|GET_CHANNEL_MODERATORS|ADD_CHANNEL_MODERATOR|REMOVE_CHANNEL_MODERATOR|ADJUST_CHANNEL_RATING" src
```

Expected: no matches in live source, except type names/comments if the worker deliberately leaves an explanatory compatibility comment. Prefer no matches.

- [ ] **Step 5: Build**

Run:

```bash
npm run build
```

Expected: build succeeds.

---

## Task 4: Final Automated Quality Gate

**Files:** no new files expected.

- [ ] **Step 1: Run builds**

Run:

```bash
npm run build
npm run build:firefox
```

Expected: both compile successfully.

- [ ] **Step 2: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no output, exit code 0.

- [ ] **Step 3: Run endpoint and branding grep**

Run:

```bash
rg -n "Tribute Alerts|\\bSwag\\b|\\bSocial\\b|/api/v2/badges|/ratings/|/channels/.*/badge-grants|/auth/twitch|/channels/" src manifest.json manifest.firefox.json README.md
```

Expected:

- no old endpoints;
- no `/channels/` live route usage;
- no user-facing old branding.

If `SocialRating` appears as a TypeScript identifier, it is acceptable. If `Social` appears in popup text, fix it to `Соц. рейтинг`.

- [ ] **Step 4: Inspect built manifests**

Run:

```bash
rg -n "src/vendor/socket.io.js|src/app/content.js|src/popup/popup.html|src/app/viewer-auth-callback.html|__FRONTEND_URL__|tribute-alerts/content|tribute-alerts/popup" dist_chrome/manifest.json dist_firefox/manifest.json
```

Expected:

- contains `src/vendor/socket.io.js`;
- contains `src/app/content.js`;
- contains `src/popup/popup.html`;
- contains `src/app/viewer-auth-callback.html`;
- does not contain `__FRONTEND_URL__`;
- does not contain `tribute-alerts/content`;
- does not contain `tribute-alerts/popup`.

---

## After This Plan: Manual Test Plan

Do not start manual testing until all automated checks pass and a 5.5 reviewer has no P1/P2 findings.

Manual browser checklist:

- Fresh install extension.
- Open popup on non-Twitch tab: popup does not crash.
- Open Twitch channel tab: subscriber badge feature starts.
- Popup disconnected state shows one primary `Подключить аккаунт`.
- Click connect: opens `/viewer-connect?extension=1&return=...viewer-auth-callback.html`.
- Complete viewer-connect on frontend.
- Extension callback loads, clears URL hash, stores account.
- Popup connected state shows Twitch login/avatar and Telegram status.
- Toggle `Соц. рейтинг` off.
- Refresh Twitch page: Social Rating content does not start.
- Toggle `Соц. рейтинг` on.
- Refresh Twitch page: Social Rating content starts.
- Subscriber badges still render regardless of Social Rating toggle.
- Vote button sends `/api/v3/social/.../votes` with viewer JWT.
- No request is made to old `/auth/twitch`, `/api/v2/badges`, `/ratings`, or `/channels/...`.

## Review Handoff Prompt

After worker implementation, dispatch a `gpt-5.5` reviewer with:

```text
Review only. Do not edit files.
Repo: /mnt/data/dev/Other projects/SvagaPlus Extension
Plan: docs/superpowers/plans/2026-06-30-quality-review-fixes-plan.md

Focus:
1. viewer-auth-callback is web-accessible and manifest placeholders are replaced;
2. viewer token is not exposed to popup/content and callback hash is cleared;
3. settings/social messages are runtime-validated;
4. no live /channels/... routes remain;
5. builds and grep checks are meaningful.

Return P1/P2 findings first with file/line refs.
```

