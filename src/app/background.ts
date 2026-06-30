import browser from '../shared/browser';
import {
  BACKEND_URL,
  FRONTEND_URL,
  VIEWER_AUTH_CALLBACK_PATH,
  VIEWER_CONNECT_PATH,
} from '../shared/config';
import { getViewerMe } from '../shared/api';
import {
  clearViewerAccount,
  getExtensionSettings,
  getViewerAccount,
  setExtensionSettings,
  setViewerAccount,
} from '../shared/storage';
import type { ExtensionSettings, ViewerAccount } from '../shared/types';
import {
  castVote,
  deleteAlias,
  exportAliases,
  fetchBadgeGrants,
  fetchRatingForCard,
  getAliases,
  getOrFetchChannelGrantsForLogin,
  getUserRating,
  importAliases,
  invalidateChannelBadgeGrants,
  prefetchChannelBadgeGrants,
  refreshMe,
  setAlias,
  syncAliasesWithServer,
} from '../features/social-rating/background';

type ViewerAccountResponse = {
  ok: true;
  account: Omit<ViewerAccount, 'token'> | null;
} | {
  ok: false;
  error: string;
};

const LOGIN_RE = /^[a-z0-9_]{3,25}$/;
const MAX_ALIAS_LENGTH = 64;
const MAX_IMPORT_ALIASES = 1000;
const CHANNEL_BADGES_CACHE_TTL_MS = 15_000;

type ChannelBadgeViewerEntry = {
  expiresAt: number;
  data: Record<string, unknown>;
};

type ChannelBadgesResponse = {
  ok: boolean;
  badges: Record<string, unknown>;
  font_presets: Record<string, unknown>;
  viewers: Record<string, unknown>;
};

const channelBadgeViewersCache = new Map<string, ChannelBadgeViewerEntry>();
const channelBadgeAssetsCache = new Map<string, { expiresAt: number; data: unknown }>();
const channelBadgeFontPresetsCache = new Map<string, { expiresAt: number; data: unknown }>();
const channelBadgeInflight = new Map<string, Promise<ChannelBadgesResponse>>();

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

function channelViewerKey(channelLogin: string, login: string): string {
  return `${channelLogin}:${login}`;
}

function uniqueSortedLogins(logins: string[]): string[] {
  return Array.from(new Set(logins.map((login) => login.trim().toLowerCase()).filter(Boolean))).sort();
}

function getCachedChannelBadges(channelLogin: string, logins: string[]): ChannelBadgesResponse | null {
  const now = Date.now();
  const badges: Record<string, unknown> = {};
  const font_presets: Record<string, unknown> = {};
  const viewers: Record<string, unknown> = {};

  for (const login of logins) {
    const viewer = channelBadgeViewersCache.get(channelViewerKey(channelLogin, login));
    if (!viewer || viewer.expiresAt <= now) return null;
    const badgeIds = Array.isArray(viewer.data.badge_ids)
      ? viewer.data.badge_ids
        .map((badgeId) => (typeof badgeId === 'string' || typeof badgeId === 'number' ? String(badgeId) : ''))
        .filter(Boolean)
      : [];

    for (const badgeId of badgeIds) {
      const badge = channelBadgeAssetsCache.get(badgeId);
      if (!badge || badge.expiresAt <= now) return null;
      badges[badgeId] = badge.data;
    }

    const fontPresetId = viewer.data.font_preset_id;
    const fontPresetKey = typeof fontPresetId === 'string' || typeof fontPresetId === 'number' ? String(fontPresetId) : '';
    if (fontPresetKey) {
      const fontPreset = channelBadgeFontPresetsCache.get(fontPresetKey);
      if (!fontPreset || fontPreset.expiresAt <= now) return null;
      font_presets[fontPresetKey] = fontPreset.data;
    }

    viewers[login] = viewer.data;
  }

  return { ok: true, badges, font_presets, viewers };
}

function cacheChannelBadges(channelLogin: string, response: ChannelBadgesResponse): void {
  if (!response.ok) return;
  const expiresAt = Date.now() + CHANNEL_BADGES_CACHE_TTL_MS;

  for (const [badgeId, badge] of Object.entries(response.badges)) {
    channelBadgeAssetsCache.set(badgeId, { expiresAt, data: badge });
  }

  for (const [fontPresetId, fontPreset] of Object.entries(response.font_presets)) {
    channelBadgeFontPresetsCache.set(fontPresetId, { expiresAt, data: fontPreset });
  }

  for (const [login, viewer] of Object.entries(response.viewers)) {
    const viewerData = isRecord(viewer) ? { ...viewer } : {};
    const badgeIds = Array.isArray((viewer as { badge_ids?: unknown[] }).badge_ids)
      ? ((viewer as { badge_ids: unknown[] }).badge_ids)
        .map((badgeId) => (typeof badgeId === 'string' || typeof badgeId === 'number' ? String(badgeId) : ''))
        .filter(Boolean)
      : [];
    viewerData.badge_ids = badgeIds;
    channelBadgeViewersCache.set(channelViewerKey(channelLogin, login.toLowerCase()), {
      expiresAt,
      data: viewerData,
    });
  }
}

async function fetchChannelBadgesFromBackend(channelLogin: string, logins: string[]): Promise<ChannelBadgesResponse> {
  const requestKey = `${channelLogin}:${logins.join(',')}`;
  const inflight = channelBadgeInflight.get(requestKey);
  if (inflight) return inflight;

  const request = (async (): Promise<ChannelBadgesResponse> => {
    try {
      const params = new URLSearchParams({ viewers: logins.join(',') });
      const res = await fetch(`${BACKEND_URL}/api/v3/channels/${encodeURIComponent(channelLogin)}/badges?${params.toString()}`);
      if (!res.ok) return { ok: false, badges: {}, font_presets: {}, viewers: {} };
      const payload = await res.json();
      const data = payload?.data ?? payload;
      const response = {
        ok: true,
        badges: data?.badges && typeof data.badges === 'object' ? data.badges : {},
        font_presets: data?.font_presets && typeof data.font_presets === 'object' ? data.font_presets : {},
        viewers: data?.viewers && typeof data.viewers === 'object' ? data.viewers : {},
      };
      cacheChannelBadges(channelLogin, response);
      return response;
    } catch {
      return { ok: false, badges: {}, font_presets: {}, viewers: {} };
    } finally {
      channelBadgeInflight.delete(requestKey);
    }
  })();

  channelBadgeInflight.set(requestKey, request);
  return request;
}

async function fetchImageAsDataUrl(url: string): Promise<{ dataUrl: string | null }> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { dataUrl: null };
    const res = await fetch(parsed.toString());
    if (!res.ok) return { dataUrl: null };
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ dataUrl: reader.result as string });
      reader.onerror = () => resolve({ dataUrl: null });
      reader.readAsDataURL(blob);
    });
  } catch {
    return { dataUrl: null };
  }
}

async function fetchChannelBadges(channelLogin: string, logins: string[]): Promise<ChannelBadgesResponse> {
  const normalizedLogins = uniqueSortedLogins(logins);
  if (normalizedLogins.length === 0) return { ok: true, badges: {}, font_presets: {}, viewers: {} };

  const cached = getCachedChannelBadges(channelLogin, normalizedLogins);
  if (cached) return cached;

  const missing = normalizedLogins.filter((login) => {
    const viewer = getCachedChannelBadges(channelLogin, [login]);
    return !viewer;
  });

  if (missing.length > 0) {
    const fetched = await fetchChannelBadgesFromBackend(channelLogin, missing);
    if (!fetched.ok && missing.length === normalizedLogins.length) return fetched;
  }

  return getCachedChannelBadges(channelLogin, normalizedLogins) ?? { ok: false, badges: {}, font_presets: {}, viewers: {} };
}

function sanitizeViewerAccount(account: ViewerAccount | null): Omit<ViewerAccount, 'token'> | null {
  if (!account) return null;
  return {
    twitchLogin: account.twitchLogin,
    avatarUrl: account.avatarUrl,
    telegramLinked: account.telegramLinked,
    lastCheckedAt: account.lastCheckedAt,
  };
}

function viewerAuthCallbackUrl(): string {
  return browser.runtime.getURL(VIEWER_AUTH_CALLBACK_PATH);
}

function startConnectUrl(): string {
  const url = new URL(VIEWER_CONNECT_PATH, FRONTEND_URL);
  url.searchParams.set('extension', '1');
  url.searchParams.set('return', viewerAuthCallbackUrl());
  return url.toString();
}

function isViewerAuthCallbackSender(sender: browser.Runtime.MessageSender): boolean {
  const senderUrl = sender.url || '';
  const expectedUrl = browser.runtime.getURL(VIEWER_AUTH_CALLBACK_PATH);
  return senderUrl.split('#')[0].split('?')[0] === expectedUrl;
}

async function openConnect(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await browser.tabs.create({ url: startConnectUrl(), active: true });
    return { ok: true };
  } catch {
    return { ok: false, error: 'tab_open_failed' };
  }
}

async function hydrateAccount(token: string): Promise<ViewerAccountResponse> {
  const me = await getViewerMe(token);
  if (!me.ok || !me.data) {
    if (me.unauthorized) await clearViewerAccount();
    return { ok: false, error: me.unauthorized ? 'invalid_token' : 'account_lookup_failed' };
  }

  const account: ViewerAccount = {
    token,
    twitchLogin: me.data.twitch_username,
    avatarUrl: me.data.avatar_url ?? null,
    telegramLinked: Boolean(me.data.telegram_linked ?? me.data.is_linked),
    lastCheckedAt: Date.now(),
  };
  await setViewerAccount(account);
  return { ok: true, account: sanitizeViewerAccount(account) };
}

async function validateStoredAccount(): Promise<void> {
  const account = await getViewerAccount();
  if (!account?.token) return;
  try {
    await hydrateAccount(account.token);
  } catch {
    await clearViewerAccount();
  }
}

async function broadcastSettingsChanged(settings: ExtensionSettings): Promise<void> {
  const tabs = await browser.tabs.query({});
  await Promise.all(tabs.map(async (tab) => {
    const url = tab.url || '';
    if (!url.includes('twitch.tv')) return;
    if (tab.id == null) return;
    try {
      await browser.tabs.sendMessage(tab.id, { type: 'settings:changed', settings });
    } catch {
      /* best effort */
    }
  }));
}

browser.runtime.onMessage.addListener((message: unknown, sender: browser.Runtime.MessageSender): Promise<unknown> | undefined => {
  if (sender.id && sender.id !== browser.runtime.id) return undefined;
  if (!message || typeof message !== 'object' || typeof (message as { type?: unknown }).type !== 'string') return undefined;

  switch ((message as { type: string }).type) {
    case 'viewer:startConnect':
      return openConnect();
    case 'viewer:completeConnect': {
      if (!isViewerAuthCallbackSender(sender)) {
        return Promise.resolve({ ok: false, error: 'forbidden_sender' });
      }
      const token = typeof (message as { token?: unknown }).token === 'string' ? (message as { token: string }).token : '';
      return token ? hydrateAccount(token) : Promise.resolve({ ok: false, error: 'missing_token' });
    }
    case 'viewer:getAccount':
      return getViewerAccount().then((account) => ({ ok: true, account: sanitizeViewerAccount(account) }));
    case 'viewer:refreshAccount':
      return (async (): Promise<ViewerAccountResponse> => {
        const account = await getViewerAccount();
        if (!account?.token) return { ok: false, error: 'missing_token' };
        return hydrateAccount(account.token);
      })();
    case 'viewer:disconnect':
      return clearViewerAccount().then(() => ({ ok: true }));
    case 'settings:get':
      return getExtensionSettings().then((settings) => ({ ok: true, settings }));
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
    case 'GET_USER_RATING': {
      const channelLogin = normalizeLogin((message as { channelLogin?: unknown }).channelLogin);
      if (!channelLogin) return badRequest();
      return getUserRating(channelLogin);
    }
    case 'FETCH_RATING': {
      const login = normalizeLogin((message as { login?: unknown }).login);
      const channelLogin = normalizeLogin((message as { channelLogin?: unknown }).channelLogin);
      if (!login || !channelLogin) return badRequest();
      return fetchRatingForCard(login, channelLogin);
    }
    case 'FETCH_BADGE_GRANTS': {
      const channelLogin = normalizeLogin((message as { channelLogin?: unknown }).channelLogin);
      const loginsValue = (message as { logins?: unknown }).logins;
      if (!channelLogin || !Array.isArray(loginsValue) || loginsValue.length > 100) return badRequest();

      const logins: string[] = [];
      for (const value of loginsValue) {
        const login = normalizeLogin(value);
        if (!login) return badRequest();
        logins.push(login);
      }

      return fetchBadgeGrants(channelLogin, logins);
    }
    case 'FETCH_CHANNEL_BADGES': {
      const channelLogin = normalizeLogin((message as { channelLogin?: unknown }).channelLogin);
      const loginsValue = (message as { logins?: unknown }).logins;
      if (!channelLogin || !Array.isArray(loginsValue) || loginsValue.length > 100) return badRequest();

      const logins: string[] = [];
      for (const value of loginsValue) {
        const login = normalizeLogin(value);
        if (!login) return badRequest();
        logins.push(login);
      }

      return fetchChannelBadges(channelLogin, logins);
    }
    case 'PREFETCH_CHANNEL_BADGE_GRANTS': {
      const channelLogin = normalizeLogin((message as { channelLogin?: unknown }).channelLogin);
      if (!channelLogin) return badRequest();
      return prefetchChannelBadgeGrants(channelLogin).then(() => ({ ok: true }));
    }
    case 'REFRESH_CHANNEL_BADGE_GRANTS': {
      const channelLogin = normalizeLogin((message as { channelLogin?: unknown }).channelLogin);
      if (!channelLogin) return badRequest();
      invalidateChannelBadgeGrants(channelLogin);
      return prefetchChannelBadgeGrants(channelLogin).then(() => ({ ok: true }));
    }
    case 'GET_CHANNEL_BADGE_GRANTS_FOR_LOGIN': {
      const channelLogin = normalizeLogin((message as { channelLogin?: unknown }).channelLogin);
      const login = normalizeLogin((message as { login?: unknown }).login);
      if (!channelLogin || !login) return badRequest();
      return getOrFetchChannelGrantsForLogin(channelLogin, login);
    }
    case 'CAST_VOTE': {
      const login = normalizeLogin((message as { login?: unknown }).login);
      const channelLogin = normalizeLogin((message as { channelLogin?: unknown }).channelLogin);
      const value = (message as { value?: unknown }).value;
      if (!login || !channelLogin || (value !== 1 && value !== -1)) return badRequest();
      return castVote(login, channelLogin, value as 1 | -1);
    }
    case 'GET_ALIASES':
      return getAliases().then((aliases) => ({ aliases }));
    case 'SET_ALIAS': {
      const login = normalizeLogin((message as { login?: unknown }).login);
      const alias = normalizeAlias((message as { alias?: unknown }).alias);
      if (!login || alias === null) return badRequest();
      return setAlias(login, alias);
    }
    case 'DELETE_ALIAS': {
      const login = normalizeLogin((message as { login?: unknown }).login);
      if (!login) return badRequest();
      return deleteAlias(login);
    }
    case 'EXPORT_ALIASES':
      return exportAliases();
    case 'IMPORT_ALIASES': {
      const data = (message as { data?: unknown }).data;
      if (!Array.isArray(data) || data.length > MAX_IMPORT_ALIASES) return badRequest();

      const items: Array<{ login: string; alias: string }> = [];
      for (const item of data) {
        if (!isRecord(item)) return badRequest();
        const login = normalizeLogin(item.login);
        const alias = normalizeAlias(item.alias, false);
        if (!login || alias === null) return badRequest();
        items.push({ login, alias });
      }

      return importAliases(items);
    }
    case 'SYNC_ALIASES':
      return syncAliasesWithServer();
    case 'REFRESH_ME':
      return refreshMe();
    case 'FETCH_IMAGE': {
      const url = (message as { url?: unknown }).url;
      return typeof url === 'string' ? fetchImageAsDataUrl(url) : badRequest();
    }
    default:
      return undefined;
  }
});

browser.runtime.onInstalled.addListener(() => {
  void validateStoredAccount();
});

browser.runtime.onStartup.addListener(() => {
  void validateStoredAccount();
});

void validateStoredAccount();
