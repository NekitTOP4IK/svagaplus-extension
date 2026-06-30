import browser from 'webextension-polyfill';
import { getViewerMe } from '../../shared/api';
import { clearViewerAccount, getViewerAccount, setViewerAccount } from '../../shared/storage';
import { ActiveBadgeGrant } from './types';
import { debug, error } from './logger';

declare const __BACKEND_URL__: string;
export const BACKEND_URL = __BACKEND_URL__;
const CHANNELS_PATH = '/channels';
const API_V3_CHANNELS_PATH = '/api/v3' + CHANNELS_PATH;
const API_V3_SOCIAL_CHANNELS_PATH = '/api/v3/social' + CHANNELS_PATH;
const API_TIMEOUT_MS = 8_000;
const RATING_CACHE_TTL_MS = 30_000;
const BADGE_GRANTS_CACHE_TTL_MS = 60_000;

export interface StoredAuth {
  accessToken?: string;
  userLogin?: string;
  avatarUrl?: string;
}

export interface StoredAliases {
  aliases?: Record<string, string>;
  aliasesSyncedAt?: number;
}

type CardRating = { login: string; score: number; swag_score: number; social_score: number; isLowRating: boolean };

const ratingCache = new Map<string, { expiresAt: number; value: CardRating }>();
const ratingInflight = new Map<string, Promise<CardRating | null>>();
const badgeGrantCache = new Map<string, { expiresAt: number; value: ActiveBadgeGrant[] }>();
const badgeGrantInflight = new Map<string, Promise<ActiveBadgeGrant[]>>();

const CHANNEL_GRANTS_TTL_MS = 120_000; // 2 min
const channelGrantsMap = new Map<string, { expiresAt: number; byLogin: Map<string, ActiveBadgeGrant[]> }>();
const channelGrantsInflight = new Map<string, Promise<void>>();
const channelGrantBatches = new Map<string, {
  pending: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
  waiters: Map<string, Array<(value: ActiveBadgeGrant[]) => void>>;
}>();

function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${BACKEND_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

function absoluteUrl(url: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${new URL(BACKEND_URL).origin}${url.startsWith('/') ? url : `/${url}`}`;
}

function unwrapApiData<T>(data: any): T {
  return (data?.data ?? data) as T;
}

function normalizeTsrBadge(item: any): ActiveBadgeGrant | null {
  if (!item || typeof item !== 'object') return null;
  if (!Number.isSafeInteger(item.rank)) return null;
  if (item.source !== 'social_rating') return null;

  const imageUrl = absoluteUrl(typeof item.url === 'string' ? item.url : null);
  return {
    login: '',
    kind: item.kind === 'low' ? 'low' : 'high',
    rank: item.rank,
    image_url: imageUrl,
    title: typeof item.title === 'string' ? item.title : `Топ-${item.rank} чатер на канале`,
    period_label: typeof item.period_id === 'string' || typeof item.period_id === 'number'
      ? String(item.period_id)
      : '',
  };
}

function normalizeChannelBadgeGrants(payload: any, logins: string[]): Map<string, ActiveBadgeGrant[]> {
  const byLogin = new Map<string, ActiveBadgeGrant[]>();
  const viewers = payload?.viewers ?? {};
  const badges = payload?.badges ?? {};
  for (const login of logins) {
    const entry = viewers?.[login] ?? viewers?.[login.toLowerCase()];
    const badgeIds = Array.isArray(entry?.badge_ids) ? entry.badge_ids : [];
    const grants = badgeIds
      .map((badgeId: any) => {
        const key = typeof badgeId === 'string' || typeof badgeId === 'number' ? String(badgeId) : '';
        return normalizeTsrBadge(key ? badges[key] : null);
      })
      .filter((badge: ActiveBadgeGrant | null): badge is ActiveBadgeGrant => badge !== null)
      .map((badge: ActiveBadgeGrant) => ({ ...badge, login: login.toLowerCase() }));
    byLogin.set(login.toLowerCase(), grants);
  }
  return byLogin;
}

function getCachedChannelGrantsForLogin(channelLogin: string, login: string): ActiveBadgeGrant[] | null {
  const key = channelLogin.trim().toLowerCase();
  const cached = channelGrantsMap.get(key);
  if (!cached || cached.expiresAt <= Date.now()) return null;
  const normalizedLogin = login.trim().toLowerCase();
  return cached.byLogin.has(normalizedLogin) ? (cached.byLogin.get(normalizedLogin) ?? []) : null;
}

function getChannelGrantBatch(channelLogin: string): {
  pending: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
  waiters: Map<string, Array<(value: ActiveBadgeGrant[]) => void>>;
} {
  const key = channelLogin.trim().toLowerCase();
  let batch = channelGrantBatches.get(key);
  if (!batch) {
    batch = { pending: new Set(), timer: null, waiters: new Map() };
    channelGrantBatches.set(key, batch);
  }
  return batch;
}

async function flushChannelGrantBatch(channelLogin: string): Promise<void> {
  const channelKey = channelLogin.trim().toLowerCase();
  const batch = channelGrantBatches.get(channelKey);
  if (!batch || batch.pending.size === 0) return;

  if (batch.timer) {
    clearTimeout(batch.timer);
    batch.timer = null;
  }

  const logins = Array.from(batch.pending);
  batch.pending.clear();
  await fetchBadgeGrants(channelLogin, logins);

  for (const login of logins) {
    const grants = getChannelGrantsForLogin(channelLogin, login);
    const waiters = batch.waiters.get(login) ?? [];
    batch.waiters.delete(login);
    for (const resolve of waiters) resolve(grants);
  }
}

async function apiFetch(path: string, init: RequestInit = {}, timeoutMs = API_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(apiUrl(path), { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function withAuthorization(init: RequestInit, token: string): RequestInit {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
}

async function apiFetchWithAuth(
  path: string,
  init: RequestInit = {},
  timeoutMs = API_TIMEOUT_MS,
): Promise<{ res: Response; authInvalid: boolean } | null> {
  const token = await getValidToken();
  if (!token) return null;

  const res = await apiFetch(path, withAuthorization(init, token), timeoutMs);
  return { res, authInvalid: res.status === 401 };
}

function ratingCacheKey(channelLogin: string, login: string): string {
  return `${channelLogin.trim().toLowerCase()}:${login.trim().toLowerCase()}`;
}

function setRatingCache(channelLogin: string, login: string, score: number): void {
  ratingCache.set(ratingCacheKey(channelLogin, login), {
    expiresAt: Date.now() + RATING_CACHE_TTL_MS,
    value: { login: login.toLowerCase(), score, swag_score: score, social_score: 0, isLowRating: score < 0 },
  });
}

function clearAuthCaches(): void {
  ratingCache.clear();
  ratingInflight.clear();
  badgeGrantCache.clear();
  badgeGrantInflight.clear();
  channelGrantsMap.clear();
  channelGrantsInflight.clear();
  channelGrantBatches.clear();
}

export async function getStored(): Promise<StoredAuth & StoredAliases> {
  const [account, data] = await Promise.all([
    getViewerAccount(),
    browser.storage.local.get(['aliases', 'aliasesSyncedAt']) as Promise<StoredAliases>,
  ]);
  const stored = {
    accessToken: account?.token,
    userLogin: account?.twitchLogin,
    avatarUrl: account?.avatarUrl ?? undefined,
    ...data,
  };
  debug('shared', 'getStored accessToken=', !!stored.accessToken, 'userLogin=', stored.userLogin);
  return stored;
}

export async function storeTokens(
  accessToken: string,
  userLogin: string | undefined,
  avatarUrl: string | undefined,
): Promise<void> {
  debug('shared', 'storeTokens userLogin=', userLogin);
  await setViewerAccount({
    token: accessToken,
    twitchLogin: userLogin ?? '',
    avatarUrl: avatarUrl ?? null,
    telegramLinked: false,
    lastCheckedAt: Date.now(),
  });
  await browser.storage.local.set({
    userLogin,
    avatarUrl,
  });
}

export async function clearTokens(): Promise<void> {
  clearAuthCaches();
  await clearViewerAccount();
  await browser.storage.local.remove(['userLogin', 'avatarUrl']);
}

export async function logoutServer(): Promise<void> {
  await clearTokens();
}

export async function getValidToken(): Promise<string | null> {
  const { accessToken } = await getStored();
  debug('shared', 'getValidToken hasToken=', !!accessToken);
  return accessToken ?? null;
}

export async function refreshMe(): Promise<{ ok: boolean; avatarUrl?: string; login?: string; error?: string }> {
  const { accessToken } = await getStored();
  if (!accessToken) return { ok: false, error: 'not_authenticated' };
  const result = await getViewerMe(accessToken);
  if (!result.ok || !result.data) {
    if (result.unauthorized) await clearViewerAccount();
    return { ok: false, error: result.unauthorized ? 'not_authenticated' : 'lookup_failed' };
  }
  const avatarUrl = result.data.avatar_url ?? undefined;
  const login = result.data.twitch_username ?? undefined;
  await setViewerAccount({
    token: accessToken,
    twitchLogin: login ?? '',
    avatarUrl: avatarUrl ?? null,
    telegramLinked: Boolean(result.data.telegram_linked ?? result.data.is_linked),
    lastCheckedAt: Date.now(),
  });
  await browser.storage.local.set({ userLogin: login, avatarUrl });
  return { ok: true, avatarUrl, login };
}

export async function getUserRating(channelLogin: string): Promise<{ score?: number; swag_score?: number; social_score?: number; enabled?: boolean } | null> {
  const { userLogin } = await getStored();
  if (!userLogin) return null;
  try {
    const url = `${API_V3_SOCIAL_CHANNELS_PATH}/${encodeURIComponent(channelLogin)}/viewers/${encodeURIComponent(userLogin)}/rating`;
    const res = await apiFetch(url);
    if (!res.ok) {
      error('shared', 'getUserRating failed:', res.status, url);
      return null;
    }
    const data = unwrapApiData<any>(await res.json());
    const swagScore = Number(data.swag_score ?? data.score ?? 0);
    const socialScore = Number(data.social_score ?? 0);
    return {
      score: swagScore,
      swag_score: swagScore,
      social_score: socialScore,
      enabled: data.enabled,
    };
  } catch (e) {
    error('shared', 'getUserRating network error:', e);
    return null;
  }
}

export async function fetchRatingForCard(
  login: string,
  channelLogin: string,
): Promise<CardRating | null> {
  const key = ratingCacheKey(channelLogin, login);
  const cached = ratingCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const existing = ratingInflight.get(key);
  if (existing) return existing;

  const request = (async (): Promise<CardRating | null> => {
    try {
      const url = `${API_V3_SOCIAL_CHANNELS_PATH}/${encodeURIComponent(channelLogin)}/viewers/${encodeURIComponent(login)}/rating`;
      const res = await apiFetch(url);
      if (!res.ok) {
        error('shared', 'fetchRatingForCard failed:', res.status, url);
        return null;
      }
      const data = unwrapApiData<any>(await res.json());
      if (data.enabled === false) return null;
      const score = Number(data.swag_score ?? data.score);
      const socialScore = Number(data.social_score ?? 0);
      const responseLogin = typeof data.viewer?.login === 'string' ? data.viewer.login : login;
      if (!Number.isSafeInteger(score)) return null;
      const value = { login: responseLogin, score, swag_score: score, social_score: socialScore, isLowRating: score < 0 };
      ratingCache.set(key, { expiresAt: Date.now() + RATING_CACHE_TTL_MS, value });
      return value;
    } catch (e) {
      error('shared', 'fetchRatingForCard network error:', e);
      return null;
    } finally {
      ratingInflight.delete(key);
    }
  })();

  ratingInflight.set(key, request);
  return request;
}

export async function castVote(
  login: string,
  channelLogin: string,
  value: 1 | -1,
): Promise<{ ok: boolean; score?: number; error?: string; nextVoteAt?: number }> {
  debug('shared', 'castVote login=', login, 'channel=', channelLogin, 'value=', value);
  try {
    const url = `${API_V3_SOCIAL_CHANNELS_PATH}/${encodeURIComponent(channelLogin)}/votes`;
    const authRes = await apiFetchWithAuth(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_login: login, value }),
    });
    if (!authRes) return { ok: false, error: 'not_authenticated' };
    const { res, authInvalid } = authRes;
    debug('shared', 'castVote res.ok=', res.ok, 'status=', res.status);
    if (res.status === 401 && authInvalid) return { ok: false, error: 'not_authenticated' };
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const detail = err.detail;
      if (detail && typeof detail === 'object' && detail.next_vote_at) {
        return { ok: false, error: detail.message ?? String(res.status), nextVoteAt: detail.next_vote_at };
      }
      return { ok: false, error: err.detail ?? String(res.status) };
    }
    const data = unwrapApiData<any>(await res.json());
    const score = Number(data.swag_score ?? data.score);
    if (Number.isSafeInteger(score)) setRatingCache(channelLogin, login, score);
    return { ok: true, score, nextVoteAt: data.next_vote_at };
  } catch (e) {
    error('shared', 'castVote error:', e);
    return { ok: false, error: 'network_error' };
  }
}

export async function fetchBadgeGrants(
  channelLogin: string,
  logins: string[],
): Promise<ActiveBadgeGrant[]> {
  const normalizedLogins = Array.from(new Set(logins.map((login) => login.trim().toLowerCase()).filter(Boolean))).sort();
  if (normalizedLogins.length === 0) return [];
  const key = `${channelLogin.trim().toLowerCase()}:${normalizedLogins.join(',')}`;
  const cached = badgeGrantCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const existing = badgeGrantInflight.get(key);
  if (existing) return existing;

  const request = (async (): Promise<ActiveBadgeGrant[]> => {
    try {
      const params = new URLSearchParams({ viewers: normalizedLogins.join(',') });
      const res = await apiFetch(`${API_V3_CHANNELS_PATH}/${encodeURIComponent(channelLogin)}/badges?${params.toString()}`);
      if (!res.ok) {
        if (res.status === 404) {
          badgeGrantCache.set(key, { expiresAt: Date.now() + BADGE_GRANTS_CACHE_TTL_MS, value: [] });
        }
        return [];
      }
      const payload = unwrapApiData<any>(await res.json());
      const grantsByLogin = normalizeChannelBadgeGrants(payload, normalizedLogins);
      const grants = normalizedLogins.flatMap((login) => grantsByLogin.get(login) ?? []);
      const channelKey = channelLogin.trim().toLowerCase();
      const existingChannelCache = channelGrantsMap.get(channelKey);
      const byLogin = existingChannelCache && existingChannelCache.expiresAt > Date.now()
        ? new Map(existingChannelCache.byLogin)
        : new Map<string, ActiveBadgeGrant[]>();
      for (const login of normalizedLogins) {
        const loginGrants = grantsByLogin.get(login) ?? [];
        byLogin.set(login, loginGrants);
        badgeGrantCache.set(`${channelKey}:${login}`, {
          expiresAt: Date.now() + BADGE_GRANTS_CACHE_TTL_MS,
          value: loginGrants,
        });
      }
      channelGrantsMap.set(channelKey, {
        expiresAt: Date.now() + CHANNEL_GRANTS_TTL_MS,
        byLogin,
      });
      badgeGrantCache.set(key, { expiresAt: Date.now() + BADGE_GRANTS_CACHE_TTL_MS, value: grants });
      return grants;
    } catch (e) {
      error('shared', 'fetchBadgeGrants error:', e);
      return [];
    } finally {
      badgeGrantInflight.delete(key);
    }
  })();

  badgeGrantInflight.set(key, request);
  return request;
}

export async function prefetchChannelBadgeGrants(channelLogin: string): Promise<void> {
  const channelKey = channelLogin.trim().toLowerCase();
  const cached = channelGrantsMap.get(channelKey);
  if (cached && cached.expiresAt > Date.now()) return;
}

export function getChannelGrantsForLogin(channelLogin: string, login: string): ActiveBadgeGrant[] {
  const key = channelLogin.trim().toLowerCase();
  const cached = channelGrantsMap.get(key);
  if (!cached || cached.expiresAt <= Date.now()) return [];
  return cached.byLogin.get(login.trim().toLowerCase()) ?? [];
}

export async function getOrFetchChannelGrantsForLogin(
  channelLogin: string,
  login: string,
): Promise<ActiveBadgeGrant[]> {
  const key = `${channelLogin.trim().toLowerCase()}:${login.trim().toLowerCase()}`;
  const cached = badgeGrantCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const cachedByChannel = getCachedChannelGrantsForLogin(channelLogin, login);
  if (cachedByChannel !== null) return cachedByChannel;

  const channelKey = channelLogin.trim().toLowerCase();
  const normalizedLogin = login.trim().toLowerCase();
  const batch = getChannelGrantBatch(channelKey);

  return new Promise((resolve) => {
    const waiters = batch.waiters.get(normalizedLogin) ?? [];
    waiters.push(resolve);
    batch.waiters.set(normalizedLogin, waiters);
    batch.pending.add(normalizedLogin);

    if (!batch.timer) {
      batch.timer = setTimeout(() => {
        batch.timer = null;
        flushChannelGrantBatch(channelKey).catch(() => {
          const failedWaiters = batch.waiters.get(normalizedLogin) ?? [];
          batch.waiters.delete(normalizedLogin);
          for (const waiter of failedWaiters) waiter([]);
        });
      }, 80);
    }
  });
}

export function invalidateChannelBadgeGrants(channelLogin?: string): void {
  if (!channelLogin) {
    badgeGrantCache.clear();
    badgeGrantInflight.clear();
    channelGrantsMap.clear();
    channelGrantsInflight.clear();
    channelGrantBatches.clear();
    return;
  }

  const key = channelLogin.trim().toLowerCase();
  channelGrantsMap.delete(key);
  channelGrantsInflight.delete(key);
  channelGrantBatches.delete(key);
  for (const cacheKey of Array.from(badgeGrantCache.keys())) {
    if (cacheKey.startsWith(`${key}:`)) badgeGrantCache.delete(cacheKey);
  }
  for (const inflightKey of Array.from(badgeGrantInflight.keys())) {
    if (inflightKey.startsWith(`${key}:`)) badgeGrantInflight.delete(inflightKey);
  }
}

export async function getAliases(): Promise<Record<string, string>> {
  const { aliases } = await getStored();
  return aliases ?? {};
}

export async function setAlias(
  login: string,
  alias: string,
): Promise<{ ok: boolean; error?: string }> {
  const normalizedLogin = login.toLowerCase().trim();
  const trimmedAlias = alias.trim();

  const { aliases } = await getStored();
  const next = { ...(aliases ?? {}) };
  if (!trimmedAlias || trimmedAlias.toLowerCase() === normalizedLogin) {
    delete next[normalizedLogin];
  } else {
    next[normalizedLogin] = trimmedAlias;
  }
  await browser.storage.local.set({ aliases: next });

  const { accessToken } = await getStored();
  if (accessToken) {
    try {
      const authRes = await apiFetchWithAuth('/api/v3/social/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_login: normalizedLogin, alias: trimmedAlias }),
      });
      if (!authRes) return { ok: true };
      const { res, authInvalid } = authRes;
      if (!res.ok) {
        if (res.status === 401 && authInvalid) return { ok: false, error: 'not_authenticated' };
        const err = await res.json().catch(() => ({}));
        return { ok: false, error: err.detail ?? String(res.status) };
      }
    } catch { /* local saved, will sync later */ }
  }
  return { ok: true };
}

export async function deleteAlias(login: string): Promise<{ ok: boolean; error?: string }> {
  const normalizedLogin = login.toLowerCase().trim();
  const { aliases } = await getStored();
  const next = { ...(aliases ?? {}) };
  delete next[normalizedLogin];
  await browser.storage.local.set({ aliases: next });

  const { accessToken } = await getStored();
  if (accessToken) {
    try {
      const authRes = await apiFetchWithAuth(`/api/v3/social/aliases/${encodeURIComponent(normalizedLogin)}`, {
        method: 'DELETE',
      });
      if (!authRes) return { ok: true };
      const { res, authInvalid } = authRes;
      if (res.status === 401 && authInvalid) return { ok: false, error: 'not_authenticated' };
      if (!res.ok && res.status !== 404) {
        const err = await res.json().catch(() => ({}));
        return { ok: false, error: err.detail ?? String(res.status) };
      }
    } catch { /* local removed, will sync later */ }
  }
  return { ok: true };
}

export async function exportAliases(): Promise<{
  data: Array<{ login: string; alias: string }>;
  count: number;
}> {
  const aliases = await getAliases();
  const data = Object.entries(aliases).map(([login, alias]) => ({ login, alias }));
  return { data, count: data.length };
}

export async function importAliases(
  items: Array<{ login: string; alias: string }>,
): Promise<{ ok: boolean; imported: number; error?: string }> {
  const aliases = await getAliases();
  const next = { ...aliases };
  let imported = 0;

  for (const item of items) {
    const login = item.login.toLowerCase().trim();
    const alias = item.alias.trim();
    if (!login || !alias) continue;
    next[login] = alias;
    imported++;
  }
  await browser.storage.local.set({ aliases: next });

  const { accessToken } = await getStored();
  if (accessToken) {
    try {
      const payload = Object.entries(next).map(([login, alias]) => ({ target_login: login, alias }));
      const authRes = await apiFetchWithAuth('/api/v3/social/aliases/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aliases: payload }),
      });
      if (!authRes) return { ok: true, imported };
      const { res, authInvalid } = authRes;
      if (!res.ok) {
        if (res.status === 401 && authInvalid) return { ok: false, error: 'not_authenticated', imported };
        const err = await res.json().catch(() => ({}));
        return { ok: false, error: err.detail ?? String(res.status), imported };
      }
      await browser.storage.local.set({ aliasesSyncedAt: Date.now() });
    } catch {
      return { ok: true, imported };
    }
  }
  return { ok: true, imported };
}

export async function syncAliasesWithServer(): Promise<{ ok: boolean; error?: string }> {
  try {
    const authRes = await apiFetchWithAuth('/api/v3/social/aliases');
    if (!authRes) return { ok: false, error: 'not_authenticated' };
    const { res, authInvalid } = authRes;
    if (!res.ok) {
      if (res.status === 401 && authInvalid) return { ok: false, error: 'not_authenticated' };
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err.detail ?? String(res.status) };
    }
    const aliasesPayload = await res.json();
    const serverData = Array.isArray(aliasesPayload)
      ? aliasesPayload
      : (aliasesPayload?.data?.items ?? aliasesPayload?.data?.aliases ?? []) as Array<{ target_login: string; alias: string }>;

    const merged: Record<string, string> = {};
    for (const item of serverData) {
      if (item.target_login && item.alias) merged[item.target_login.toLowerCase()] = item.alias;
    }

    const { aliases: localAliases } = await getStored();
    const toPush: Array<{ target_login: string; alias: string }> = [];
    if (localAliases) {
      for (const [login, alias] of Object.entries(localAliases)) {
        if (!merged[login]) {
          merged[login] = alias;
          toPush.push({ target_login: login, alias });
        }
      }
    }

    if (toPush.length > 0) {
      await apiFetchWithAuth('/api/v3/social/aliases/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aliases: toPush }),
      }).catch(() => {});
    }

    await browser.storage.local.set({ aliases: merged, aliasesSyncedAt: Date.now() });
    return { ok: true };
  } catch {
    return { ok: false, error: 'network_error' };
  }
}
