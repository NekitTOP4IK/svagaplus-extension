# Svaga+ Extension Popup And V3 Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the extension popup for Svaga+ branding, move extension badge calls to the current v3 backend contracts, and make Social Rating visibly usable without breaking existing subscriber badges.

**Architecture:** Keep the current extension structure. Do not port the TSR React popup. Update the plain HTML popup and the existing TypeScript background/content modules. Replace old badge URL assumptions with small v3 helpers and lazy per-viewer/bulk caches.

**Tech Stack:** Browser extension Manifest V3, TypeScript, Webpack, plain popup HTML/CSS/JS, `webextension-polyfill`, backend Flask API.

---

## Backend Contracts To Use

Checked on 2026-06-29 in `/mnt/data/dev/Other projects/SvagaPlus Server/backend`.

Registered prefixes:

- `routes.badges_v3` is mounted at `/api/v3`.
- `routes.social` is mounted at both `/api/social` and `/api/v3/social`; use `/api/v3/social`.
- `routes.extension` is mounted at `/api/extension`.

Badge v3 routes:

- `GET /api/v3/channels/<channel_identifier>/viewers/<viewer_identifier>/badges`
- `GET /api/v3/channels/<channel_identifier>/badges?viewers=<login1>,<login2>`

Badge v3 response shape:

```json
{
  "success": true,
  "data": {
    "channel": { "id": "uuid", "login": "streamer", "twitch_channel_id": "2001" },
    "viewers": {
      "viewer": {
        "viewer": { "id": "uuid", "login": "viewer", "twitch_id": "1001" },
        "tra_badges": [{ "id": "svc_uuid", "title": "Founder badge", "url": "/svc.png" }],
        "tsr_badges": [{ "id": "tsr_uuid", "kind": "swag", "rank": 1, "period_id": "uuid", "url": "/swag.png", "active": true }]
      }
    }
  }
}
```

Social v3 routes:

- `GET /api/v3/social/channels/<channel>/status`
- `GET /api/v3/social/channels/<channel>/viewers/<viewer>/rating`
- `POST /api/v3/social/channels/<channel>/votes` with viewer JWT and JSON `{ "target_login": "viewer", "value": 1 }`
- `GET /api/v3/social/aliases`, `POST /api/v3/social/aliases`, `GET /api/v3/social/aliases/export`, `POST /api/v3/social/aliases/import`, `DELETE /api/v3/social/aliases/<target_login>`

Social rating response shape:

```json
{
  "success": true,
  "data": {
    "channel": {
      "id": "uuid",
      "twitch_channel_id": "2001",
      "login": "streamer",
      "avatar_url": null,
      "rating_enabled": true,
      "activity_public": true
    },
    "viewer": {
      "id": "uuid",
      "twitch_id": "1002",
      "login": "target",
      "avatar_url": null
    },
    "swag_score": 7,
    "social_score": 2,
    "enabled": true
  }
}
```

Do not use these old URLs for new code:

- `/api/v2/badges/<channel>/status/<login>`
- `/api/v2/badges/<channel>/all`
- `/ratings/<channel>/<login>`
- `/channels/<channel>/badge-grants`
- `/channels/<channel>/ratings/<login>/adjust`

## File Structure

Modify:

- `manifest.json`: Svaga+ name/description.
- `manifest.firefox.json`: Svaga+ name/description.
- `README.md`: branding only if it still says Tribute Alerts.
- `src/tribute-alerts/popup/popup.html`: Mercury visual refresh, Svaga+ copy, Social Rating section markup.
- `src/tribute-alerts/popup/popup.js`: popup state, v3 subscriber badge status, Social Rating auth/rating/toggle.
- `src/app/popup.ts`: delete or shrink the injected toggle so the popup has one source of truth.
- `src/tribute-alerts/content/core.js`: replace v2 all-channel badge fetch with v3 lazy/bulk badge cache.
- `src/tribute-alerts/content/twitch.js`: ensure native chat badge rendering works from the new per-user cache.
- `src/tribute-alerts/content/seventv.js`: ensure 7TV chat badge rendering works from the new per-user cache.
- `src/tribute-alerts/content/usercard.js`: ensure usercard badge rendering works from the new per-user cache.
- `src/social-rating/background/shared.ts`: replace old social endpoints with `/api/v3/social/*` and badge v3 helpers.
- `src/social-rating/content/chat-badge-injector.ts`: adapt to v3 badge payload, or reuse the shared v3 helper.
- `src/social-rating/types/index.ts`: align badge/rating types with v3 payload.

Do not create a new React popup. Do not add a new dependency.

## Visual Spec

Use `/mnt/data/dev/Other projects/SvagaPlus/DESIGN-variant-3.md`.

Popup target:

- Background: `#171721` outer, `#1e1e2a` surface, `#272735` interactive.
- Text: `#ededf3` primary, `#c3c3cc` secondary, `#70707d` borders.
- Primary CTA only: `#5266eb` with white text.
- Buttons: pill radius `32px` or `40px`.
- Cards/panels: radius `0px` or `4px`; no shadows.
- Remove purple/green decorative gradients, glows, large rounded cards, and emoji-as-icons.
- Header brand text: `Свага+`.
- Extension descriptions: replace `Tribute Alerts` with `Свага+`.
- Icon: keep current file path for now (`icons/icon64.png` and `src/tribute-alerts/popup/tribute-alerts.svg`) until the compressed new icon is added. When the new icon arrives, replace the asset only, not the markup contract.

## Task 1: Add A Tiny V3 Badge Normalizer

**Files:**

- Modify: `src/tribute-alerts/content/core.js`
- Modify: `src/social-rating/types/index.ts`

- [ ] **Step 1: Add a normalized badge shape in `src/tribute-alerts/content/core.js`**

Add this near the existing badge globals:

```js
var viewerBadgeCache = {};
var viewerBadgeInflight = {};
var viewerBadgeBatchTimer = null;
var viewerBadgeBatchLogins = new Set();

function normalizeV3Badge(raw, source) {
  if (!raw || !raw.url) return null;
  return {
    id: raw.id,
    image_url: raw.url,
    title: raw.title || (source === 'tsr' ? `Social Rating #${raw.rank || ''}`.trim() : 'Свага+ badge'),
    kind: raw.kind || source,
    rank: raw.rank || null,
    source
  };
}

function normalizeV3ViewerBadges(entry) {
  if (!entry) return [];
  const tra = Array.isArray(entry.tra_badges) ? entry.tra_badges : [];
  const tsr = Array.isArray(entry.tsr_badges) ? entry.tsr_badges : [];
  return [
    ...tra.map((badge) => normalizeV3Badge(badge, 'tra')),
    ...tsr.map((badge) => normalizeV3Badge(badge, 'tsr'))
  ].filter(Boolean);
}
```

- [ ] **Step 2: Add the TypeScript type in `src/social-rating/types/index.ts`**

Use this exported type if the file does not already have an equivalent:

```ts
export interface V3Badge {
  id: string;
  title?: string;
  kind?: string;
  rank?: number;
  period_id?: string;
  url: string | null;
  active?: boolean;
}

export interface V3ViewerBadges {
  viewer: {
    id: string;
    login: string;
    twitch_id: string | null;
  };
  tra_badges: V3Badge[];
  tsr_badges: V3Badge[];
}
```

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: build succeeds or fails only on pre-existing unrelated TypeScript errors. If it fails on duplicate exported type names, reuse the existing names and update later tasks to match.

## Task 2: Replace TRA V2 All-Channel Badge Fetch With V3 Lazy Bulk Fetch

**Files:**

- Modify: `src/tribute-alerts/content/core.js`
- Modify: `src/tribute-alerts/content/twitch.js`
- Modify: `src/tribute-alerts/content/seventv.js`
- Modify: `src/tribute-alerts/content/usercard.js`

- [ ] **Step 1: Replace `fetchBadges(channelName)` internals**

Keep the function name if callers depend on it, but stop calling `/api/v2/badges/<channel>/all`.

Use this helper in `src/tribute-alerts/content/core.js`:

```js
function cacheKey(channelName, login) {
  return `${String(channelName || '').toLowerCase()}:${String(login || '').toLowerCase()}`;
}

async function fetchViewerBadges(channelName, logins) {
  const cleanLogins = Array.from(new Set(
    (logins || [])
      .map((login) => String(login || '').trim().replace(/^@/, '').toLowerCase())
      .filter(Boolean)
  )).slice(0, 100);
  if (!channelName || cleanLogins.length === 0) return;

  const missing = cleanLogins.filter((login) => !viewerBadgeCache[cacheKey(channelName, login)]);
  if (missing.length === 0) return;

  const inflightKey = `${channelName.toLowerCase()}:${missing.sort().join(',')}`;
  if (viewerBadgeInflight[inflightKey]) return viewerBadgeInflight[inflightKey];

  viewerBadgeInflight[inflightKey] = (async () => {
    try {
      const qs = new URLSearchParams({ viewers: missing.join(',') });
      const response = await fetch(`${CONFIG.BACKEND_URL}/api/v3/channels/${encodeURIComponent(channelName)}/badges?${qs}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      const viewers = json && json.success && json.data ? (json.data.viewers || {}) : {};
      for (const login of missing) {
        const entry = viewers[login] || null;
        viewerBadgeCache[cacheKey(channelName, login)] = {
          ts: Date.now(),
          badges: normalizeV3ViewerBadges(entry)
        };
      }
      refreshChat();
    } catch {
      for (const login of missing) {
        viewerBadgeCache[cacheKey(channelName, login)] = { ts: Date.now(), badges: [] };
      }
    } finally {
      delete viewerBadgeInflight[inflightKey];
    }
  })();

  return viewerBadgeInflight[inflightKey];
}

function queueViewerBadgeFetch(channelName, login) {
  const normalized = String(login || '').trim().replace(/^@/, '').toLowerCase();
  if (!channelName || !normalized) return;
  const key = cacheKey(channelName, normalized);
  if (viewerBadgeCache[key]) return;
  viewerBadgeBatchLogins.add(normalized);
  if (viewerBadgeBatchTimer) return;
  viewerBadgeBatchTimer = setTimeout(() => {
    const batch = Array.from(viewerBadgeBatchLogins);
    viewerBadgeBatchLogins.clear();
    viewerBadgeBatchTimer = null;
    fetchViewerBadges(channelName, batch);
  }, 80);
}

function resolveBadgesForLogin(channelName, login) {
  const normalized = String(login || '').trim().replace(/^@/, '').toLowerCase();
  const cached = viewerBadgeCache[cacheKey(channelName, normalized)];
  if (!cached) {
    queueViewerBadgeFetch(channelName, normalized);
    return [];
  }
  return cached.badges || [];
}
```

- [ ] **Step 2: Keep `resolveBadgesForUser` as compatibility wrapper**

Replace the current `resolveBadgesForUser(userEntry)` with:

```js
function resolveBadgesForUser(userEntry) {
  if (!userEntry) return [];
  if (Array.isArray(userEntry.badges)) return userEntry.badges;
  if (userEntry.twitch_username) return resolveBadgesForLogin(currentChannelName, userEntry.twitch_username);
  return [];
}
```

- [ ] **Step 3: Update chat renderers to request by login**

In `src/tribute-alerts/content/twitch.js`, wherever it currently does:

```js
const userConfig = cachedUsers[login];
const badges = typeof resolveBadgesForUser !== 'undefined' ? resolveBadgesForUser(userConfig) : [];
```

change it to:

```js
const badges = typeof resolveBadgesForLogin !== 'undefined'
  ? resolveBadgesForLogin(currentChannelName, login)
  : [];
```

Repeat the same replacement in `src/tribute-alerts/content/seventv.js` and `src/tribute-alerts/content/usercard.js`.

- [ ] **Step 4: Preserve name color behavior only if data still exists**

Do not invent a new v3 name-color endpoint. Leave `updateDynamicStyles()` in place, but it will only style users already present in `cachedUsers`. Add this comment above `updateDynamicStyles()`:

```js
// ponytail: v3 badge API does not return name CSS/font presets; keep old styling only when legacy data already exists.
```

- [ ] **Step 5: Build Chrome**

Run:

```bash
npm run build
```

Expected: build succeeds and `dist_chrome/src/tribute-alerts/content/core.js` contains `/api/v3/channels/`.

## Task 3: Update Social Rating Background API To V3

**Files:**

- Modify: `src/social-rating/background/shared.ts`
- Modify: `src/social-rating/content/api.ts`
- Modify: `src/social-rating/content/chat-badge-injector.ts`

- [ ] **Step 1: Change rating read URLs**

In `getUserRating()` and `fetchRatingForCard()`, replace:

```ts
const url = `/ratings/${encodeURIComponent(channelLogin)}/${encodeURIComponent(userLogin)}`;
```

and:

```ts
const url = `/ratings/${encodeURIComponent(channelLogin)}/${encodeURIComponent(login)}`;
```

with:

```ts
const url = `/api/v3/social/channels/${encodeURIComponent(channelLogin)}/viewers/${encodeURIComponent(userLogin)}/rating`;
```

and:

```ts
const url = `/api/v3/social/channels/${encodeURIComponent(channelLogin)}/viewers/${encodeURIComponent(login)}/rating`;
```

Because `apiUrl()` already prefixes `BACKEND_URL`, absolute API paths starting with `/api/v3` are valid.

- [ ] **Step 2: Map v3 rating payload**

In both functions, read score fields from `data.data` first:

```ts
const payload = data.data ?? data;
const swagScore = Number(payload.swag_score ?? payload.score ?? 0);
const socialScore = Number(payload.social_score ?? 0);
const enabled = payload.enabled !== false;
```

For card ratings, return `null` when `enabled` is false.

- [ ] **Step 3: Change vote URL and payload**

In `castVote()`, replace:

```ts
const url = `/ratings/${encodeURIComponent(channelLogin)}/${encodeURIComponent(login)}/vote`;
```

with:

```ts
const url = `/api/v3/social/channels/${encodeURIComponent(channelLogin)}/votes`;
```

and replace the body with:

```ts
body: JSON.stringify({ target_login: login, value }),
```

Read response scores from `data.data`:

```ts
const payload = data.data ?? data;
const score = Number(payload.swag_score ?? payload.score);
```

- [ ] **Step 4: Change aliases URLs to v3**

Replace:

```ts
'/aliases'
'/aliases/import'
`/aliases/${encodeURIComponent(normalizedLogin)}`
```

with:

```ts
'/api/v3/social/aliases'
'/api/v3/social/aliases/import'
`/api/v3/social/aliases/${encodeURIComponent(normalizedLogin)}`
```

For alias imports, backend expects:

```ts
body: JSON.stringify({ aliases: payload }),
```

where each item has `{ target_login, alias }`.

- [ ] **Step 5: Replace social badge grant fetches with badge v3**

Replace old grant URLs:

```ts
`/channels/${encodeURIComponent(channelLogin)}/badge-grants?${params.toString()}`
`/channels/${encodeURIComponent(channelLogin)}/badge-grants`
```

with:

```ts
`/api/v3/channels/${encodeURIComponent(channelLogin)}/badges?${params.toString()}`
```

Do not keep the no-query all-channel request. v3 requires `viewers=...`.

- [ ] **Step 6: Normalize v3 badges into existing `ActiveBadgeGrant`**

Use this mapper in `shared.ts`:

```ts
function normalizeV3BadgeGrants(data: unknown): ActiveBadgeGrant[] {
  const root = data as { data?: { viewers?: Record<string, { tsr_badges?: any[] }> } };
  const viewers = root.data?.viewers ?? {};
  const grants: ActiveBadgeGrant[] = [];
  for (const [login, entry] of Object.entries(viewers)) {
    for (const badge of entry.tsr_badges ?? []) {
      if (!badge || (badge.kind !== 'swag' && badge.kind !== 'social' && badge.kind !== 'high' && badge.kind !== 'low')) continue;
      grants.push({
        login: login.toLowerCase(),
        kind: badge.kind === 'social' ? 'high' : badge.kind === 'swag' ? 'high' : badge.kind,
        rank: Number(badge.rank ?? 0),
        image_url: absoluteUrl(typeof badge.url === 'string' ? badge.url : null),
        title: typeof badge.title === 'string' ? badge.title : `Social Rating #${badge.rank ?? ''}`.trim(),
        period_label: typeof badge.period_id === 'string' ? badge.period_id : '',
      });
    }
  }
  return grants;
}
```

Use the existing `ActiveBadgeGrant` shape to avoid changing every injector.

- [ ] **Step 7: Build Chrome**

Run:

```bash
npm run build
```

Expected: build succeeds and generated background bundle contains `/api/v3/social/channels/`.

## Task 4: Redesign Popup And Add Social Rating Status

**Files:**

- Modify: `src/tribute-alerts/popup/popup.html`
- Modify: `src/tribute-alerts/popup/popup.js`
- Modify: `src/app/popup.ts`

- [ ] **Step 1: Replace visible brand strings**

In `popup.html`:

```html
<title>Свага+</title>
...
<span class="header-title">Свага+</span>
```

Replace user-facing `Tribute Alerts` mentions with `Свага+`.

- [ ] **Step 2: Apply Mercury CSS tokens**

At the top of the popup `<style>`, add:

```css
:root {
  --color-mercury-blue: #5266eb;
  --color-ghost-blue: #cdddff;
  --color-deep-space: #171721;
  --color-midnight-slate: #1e1e2a;
  --color-graphite: #272735;
  --color-lead: #70707d;
  --color-starlight: #ededf3;
  --color-silver: #c3c3cc;
  --color-pure-white: #ffffff;
}
```

Then replace the old purple/green popup look:

```css
body {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: var(--color-deep-space);
  color: var(--color-starlight);
  min-width: 340px;
  min-height: 220px;
}

.app {
  background: var(--color-midnight-slate);
}

.header,
.info-card,
.unlink-card,
.polling-card,
.user-card,
.sub-card {
  background: var(--color-midnight-slate);
  border: 1px solid rgba(112, 112, 125, 0.45);
  border-radius: 4px;
  box-shadow: none;
}

.btn {
  border-radius: 32px;
  font-weight: 480;
}

.btn-primary {
  background: var(--color-mercury-blue);
  color: var(--color-pure-white);
  border: 1px solid var(--color-mercury-blue);
  box-shadow: none;
}

.btn-secondary {
  background: rgba(205, 221, 255, 0.14);
  color: var(--color-starlight);
  border: 1px solid rgba(205, 221, 255, 0.2);
}
```

Remove decorative radial gradients, purple glows, card shadows, and green status pills. Keep small animations only where they explain loading.

- [ ] **Step 3: Add Social Rating markup**

Add this block after the subscription status rows in the linked state:

```html
<section class="social-panel" id="socialPanel">
  <div class="social-panel-head">
    <div>
      <div class="social-kicker">Social Rating</div>
      <div class="social-title" id="socialChannel">Текущий канал</div>
    </div>
    <label class="switch">
      <input type="checkbox" id="socialEnabled">
      <span></span>
    </label>
  </div>
  <div class="social-auth" id="socialAuthState">Проверяем вход...</div>
  <div class="social-metrics" id="socialMetrics" hidden>
    <div><span>Swag</span><strong id="socialSwag">0</strong></div>
    <div><span>Social</span><strong id="socialScore">0</strong></div>
  </div>
  <button class="btn btn-secondary" id="socialLoginBtn" type="button">Войти через Twitch</button>
  <button class="btn btn-secondary" id="socialLogoutBtn" type="button" hidden>Выйти</button>
</section>
```

Add compact CSS for it:

```css
.social-panel {
  border-top: 1px solid rgba(112, 112, 125, 0.45);
  padding-top: 14px;
  display: grid;
  gap: 12px;
}

.social-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.social-kicker {
  color: var(--color-silver);
  font-size: 11px;
  letter-spacing: 0.02em;
}

.social-title {
  color: var(--color-starlight);
  font-size: 14px;
  line-height: 1.35;
}

.social-auth {
  color: var(--color-silver);
  font-size: 12px;
  line-height: 1.45;
}

.social-metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.social-metrics div {
  background: var(--color-graphite);
  border: 1px solid rgba(112, 112, 125, 0.35);
  border-radius: 4px;
  padding: 10px 12px;
}

.social-metrics span {
  display: block;
  color: var(--color-silver);
  font-size: 11px;
}

.social-metrics strong {
  color: var(--color-starlight);
  font-size: 18px;
  font-weight: 480;
}
```

- [ ] **Step 4: Add popup JS helpers**

At the top of `popup.js`, add:

```js
const FEATURE_FLAGS_KEY = 'svagaplus_feature_flags';

async function getFeatureFlags() {
  const stored = await chrome.storage.local.get(FEATURE_FLAGS_KEY);
  return { socialRating: false, ...(stored[FEATURE_FLAGS_KEY] || {}) };
}

async function setSocialRatingEnabled(enabled) {
  const flags = await getFeatureFlags();
  await chrome.storage.local.set({ [FEATURE_FLAGS_KEY]: { ...flags, socialRating: enabled } });
}

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) return resolve(null);
      resolve(response || null);
    });
  });
}
```

- [ ] **Step 5: Add social panel render function**

Add this in `popup.js`:

```js
async function renderSocialPanel(login, channel) {
  const enabledEl = $('socialEnabled');
  const authEl = $('socialAuthState');
  const channelEl = $('socialChannel');
  const metricsEl = $('socialMetrics');
  const swagEl = $('socialSwag');
  const socialEl = $('socialScore');
  const loginBtn = $('socialLoginBtn');
  const logoutBtn = $('socialLogoutBtn');
  if (!enabledEl || !authEl) return;

  const flags = await getFeatureFlags();
  enabledEl.checked = !!flags.socialRating;
  enabledEl.onchange = () => setSocialRatingEnabled(enabledEl.checked);
  if (channelEl) channelEl.textContent = channel ? `#${channel}` : 'Откройте канал Twitch';

  const auth = await sendRuntimeMessage({ type: 'GET_AUTH' });
  const authenticated = !!auth && !!auth.authenticated;
  loginBtn.hidden = authenticated;
  logoutBtn.hidden = !authenticated;
  authEl.textContent = authenticated
    ? `Вход: ${auth.userLogin || login || 'Twitch'}`
    : 'Войдите через Twitch, чтобы видеть свой рейтинг и голосовать.';

  loginBtn.onclick = async () => {
    loginBtn.disabled = true;
    await sendRuntimeMessage({ type: 'LOGIN' });
    loginBtn.disabled = false;
    renderSocialPanel(login, channel);
  };
  logoutBtn.onclick = async () => {
    await sendRuntimeMessage({ type: 'LOGOUT' });
    renderSocialPanel(login, channel);
  };

  if (!authenticated || !channel) {
    if (metricsEl) metricsEl.hidden = true;
    return;
  }

  const rating = await sendRuntimeMessage({ type: 'GET_USER_RATING', channelLogin: channel });
  if (rating && metricsEl) {
    metricsEl.hidden = false;
    swagEl.textContent = String(rating.swag_score ?? rating.score ?? 0);
    socialEl.textContent = String(rating.social_score ?? 0);
  }
}
```

- [ ] **Step 6: Call social panel from current popup state**

In `renderState()`, after `const { login, channel } = tabInfo;`, call:

```js
renderSocialPanel(login, channel).catch(() => {});
```

Also call it in non-linked and linked states after channel/login are known. The panel must not depend on the Telegram viewer-link flow.

- [ ] **Step 7: Remove the injected toggle from `src/app/popup.ts`**

Replace the file contents with:

```ts
export {};
```

The popup HTML now owns the toggle. This avoids two different Social Rating controls fighting each other.

- [ ] **Step 8: Build Chrome**

Run:

```bash
npm run build
```

Expected: popup bundle builds and the generated popup contains `Свага+`.

## Task 5: Update Manifest Branding

**Files:**

- Modify: `manifest.json`
- Modify: `manifest.firefox.json`
- Modify: `README.md`

- [ ] **Step 1: Update manifest names and descriptions**

Use:

```json
"name": "Свага+",
"description": "Расширение Свага+ для Twitch: подписочные баджи, Social Rating и локальные улучшения чата."
```

Keep extension ids and paths unchanged.

- [ ] **Step 2: Keep icon paths stable**

Do not rename icon paths yet. When the compressed new icon arrives, replace:

- `icons/icon64.png`
- `src/tribute-alerts/popup/tribute-alerts.svg` if a popup SVG is provided

- [ ] **Step 3: Update README title**

Replace:

```md
# Tribute Alerts Twitch Extension
```

with:

```md
# Свага+ Twitch Extension
```

Replace public links only if the Svaga+ production URL is already known in `webpack.config.js`; otherwise leave URLs as backend deployment URLs.

## Task 6: Verification

**Files:**

- No new files.

- [ ] **Step 1: Search for stale endpoint usage**

Run:

```bash
rg -n "/api/v2/badges|/ratings/|/badge-grants|Tribute Alerts" src manifest.json manifest.firefox.json README.md
```

Expected:

- No `/api/v2/badges` in `src`.
- No `/ratings/` in `src/social-rating`.
- No `/badge-grants` in `src/social-rating`.
- `Tribute Alerts` appears only in legacy folder names or changelog history, not current popup/manifest copy.

- [ ] **Step 2: Build Chrome and Firefox**

Run:

```bash
npm run build
npm run build:firefox
```

Expected:

- Both commands exit 0.
- `dist_chrome/manifest.json` and `dist_firefox/manifest.json` contain `"name": "Свага+"`.

- [ ] **Step 3: Manual browser check**

Load `dist_chrome` as unpacked extension.

On a Twitch channel:

- Popup opens with Mercury dark style and `Свага+` header.
- Subscriber section still shows linked/unlinked state.
- Social Rating toggle persists after closing/reopening popup.
- Social Rating login button opens Twitch OAuth flow.
- After login, popup shows current `Swag` and `Social` values for the active channel.
- Native Twitch chat shows subscriber badges from v3 when users with `tra_badges` appear.
- Native Twitch chat shows social rating period badges from v3 when users with `tsr_badges` appear.
- 7TV chat still gets badges before usernames.
- User cards still show badges when opened.

- [ ] **Step 4: Backend smoke URLs**

With backend running, test these URLs in a browser or curl:

```bash
curl -i "$BACKEND_URL/api/v3/channels/streamer/badges?viewers=viewer"
curl -i "$BACKEND_URL/api/v3/social/channels/streamer/viewers/viewer/rating"
curl -i "$BACKEND_URL/api/extension/info"
```

Expected:

- Existing channel/viewer returns `200`.
- Missing channel/viewer returns `404`, not extension crash.
- Extension popup handles server errors with the existing error state.

## Self-Review

- Spec coverage: includes popup redesign, Svaga+ branding, icon handling, v3 subscriber badges, v3 social rating, v3 social badge grants, and verification.
- Scope intentionally skipped: React popup, alias manager UI in popup, new backend routes, new dependencies.
- Risk: v3 badge API does not expose legacy name color/font payload from `/api/v2/badges/<channel>/all`; this plan keeps badge rendering working and preserves old styling only where old data is already present.
