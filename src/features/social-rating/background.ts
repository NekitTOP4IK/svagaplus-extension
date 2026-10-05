import browser from 'webextension-polyfill';
import { getViewerMe } from '../../shared/api';
import { apiCooldown, ratingKey } from '../../shared/request-cooldown';
import { clearViewerAccount, getViewerAccount, setViewerAccount } from '../../shared/storage';
import { debug, error } from './logger';

// Единый источник: shared/config срезает хвостовой слэш, локальное объявление — нет.
export { BACKEND_URL } from '../../shared/config';
import { BACKEND_URL } from '../../shared/config';
const API_V3_SOCIAL_CHANNELS_PATH = '/api/v3/social/channels';
const API_TIMEOUT_MS = 8_000;
const RATING_CACHE_TTL_MS = 10 * 60 * 1000;

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

function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${BACKEND_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

function unwrapApiData<T>(data: any): T {
  return (data?.data ?? data) as T;
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

function setRatingCache(channelLogin: string, login: string, score: number, socialScore = 0): void {
  ratingCache.set(ratingCacheKey(channelLogin, login), {
    expiresAt: Date.now() + RATING_CACHE_TTL_MS,
    value: { login: login.toLowerCase(), score, swag_score: score, social_score: socialScore, isLowRating: score < 0 },
  });
}

function clearAuthCaches(): void {
  ratingCache.clear();
  ratingInflight.clear();
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
    const authRes = await apiFetchWithAuth(url);
    if (!authRes) return null;
    const { res } = authRes;
    if (!res.ok) {
      error('shared', 'getUserRating failed:', res.status, url);
      return null;
    }
    const data = unwrapApiData<any>(await res.json());
    const swagScore = Number(data.swag_score ?? data.score);
    const socialScore = Number(data.social_score);
    const rating: { score?: number; swag_score?: number; social_score?: number; enabled?: boolean } = {};
    if (Number.isSafeInteger(swagScore)) {
      rating.score = swagScore;
      rating.swag_score = swagScore;
    }
    if (Number.isSafeInteger(socialScore)) rating.social_score = socialScore;
    if (typeof data.enabled === 'boolean') rating.enabled = data.enabled;
    return rating;
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
  const coolKey = ratingKey(channelLogin, login);
  if (apiCooldown.isBlocked(coolKey)) return null;

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
        apiCooldown.markFromStatus(coolKey, res.status);
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
      apiCooldown.markFromStatus(coolKey, 'network');
      return null;
    } finally {
      ratingInflight.delete(key);
    }
  })();

  ratingInflight.set(key, request);
  return request;
}

export function parseNextVoteAtMs(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return undefined;
    return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  }
  const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const ms = Date.parse(hasTz ? trimmed : `${trimmed}Z`);
  return Number.isNaN(ms) ? undefined : ms;
}

export function extractVoteErrorPayload(
  err: unknown,
  status: number,
): { error: string; nextVoteAt?: number } {
  const body = err && typeof err === 'object' && !Array.isArray(err)
    ? (err as Record<string, unknown>)
    : {};
  const detail = body.detail;
  let message: string | undefined;
  let rawNext: unknown;

  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const d = detail as Record<string, unknown>;
    if (typeof d.message === 'string') message = d.message;
    else if (typeof d.msg === 'string') message = d.msg;
    rawNext = d.next_vote_at;
  } else if (typeof detail === 'string') {
    message = detail;
  }

  if (!message && typeof body.message === 'string') message = body.message;
  if (rawNext == null && body.next_vote_at != null) rawNext = body.next_vote_at;

  return {
    error: message ?? String(status),
    nextVoteAt: parseNextVoteAtMs(rawNext),
  };
}

export async function castVote(
  login: string,
  channelLogin: string,
  value: 1 | -1,
): Promise<{ ok: boolean; score?: number; social_score?: number; error?: string; nextVoteAt?: number }> {
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
      return { ok: false, ...extractVoteErrorPayload(err, res.status) };
    }
    const data = unwrapApiData<any>(await res.json());
    const score = Number(data.swag_score ?? data.score);
    const socialScore = Number(data.social_score ?? 0);
    if (Number.isSafeInteger(score)) setRatingCache(channelLogin, login, score, Number.isSafeInteger(socialScore) ? socialScore : 0);
    return {
      ok: true,
      score,
      social_score: Number.isSafeInteger(socialScore) ? socialScore : undefined,
      nextVoteAt: parseNextVoteAtMs(data.next_vote_at),
    };
  } catch (e) {
    error('shared', 'castVote error:', e);
    return { ok: false, error: 'network_error' };
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

// Service worker MV3 просыпается на каждое сообщение после простоя, и каждый раз
// зовёт validateStoredAccount. Без порога синхронизация шла бы десятки раз в час.
export const ALIAS_SYNC_MIN_INTERVAL_MS = 15 * 60 * 1000;

/** Синхронизирует алиасы, если с прошлой успешной синхронизации прошло больше `minIntervalMs`. */
export async function syncAliasesIfStale(
  minIntervalMs = ALIAS_SYNC_MIN_INTERVAL_MS,
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const { accessToken, aliasesSyncedAt } = await getStored();
  if (!accessToken) return { ok: false, error: 'not_authenticated' };
  if (aliasesSyncedAt && Date.now() - aliasesSyncedAt < minIntervalMs) return { ok: true, skipped: true };
  return syncAliasesWithServer();
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
