import { BACKEND_URL } from './config';
import type { SocialChannelStatus, SocialRating, V3Badge, V3ViewerBadges } from './types';

type JsonObject = Record<string, any>;
const CHANNELS_PATH = '/channels';
const API_V3_CHANNELS_PATH = '/api/v3' + CHANNELS_PATH;
const API_V3_SOCIAL_CHANNELS_PATH = '/api/v3/social' + CHANNELS_PATH;

function apiUrl(path: string): string {
  return new URL(path, BACKEND_URL).toString();
}

async function requestJson<T>(path: string, init: RequestInit = {}, token?: string): Promise<T | null> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');

  const res = await fetch(apiUrl(path), { ...init, headers });
  if (!res.ok) return null;

  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function absoluteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return new URL(url, BACKEND_URL).toString();
}

function normalizeBadge(item: JsonObject | null | undefined, source: 'tra' | 'tsr'): V3Badge | null {
  if (!item || item.active === false) return null;
  const id = typeof item.id === 'string' || typeof item.id === 'number' ? String(item.id) : '';
  const title = typeof item.title === 'string' ? item.title : '';
  const kind = typeof item.kind === 'string' ? item.kind : null;
  const rank = typeof item.rank === 'number' && Number.isFinite(item.rank) ? item.rank : null;
  const periodId =
    typeof item.period_id === 'string' || typeof item.period_id === 'number' ? String(item.period_id) : null;
  if (!id || !title) return null;
  return {
    id,
    source,
    title,
    url: absoluteUrl(typeof item.url === 'string' ? item.url : null),
    kind,
    rank,
    periodId,
    active: true,
  };
}

function normalizeViewerBadges(entry: JsonObject | null | undefined): V3ViewerBadges | null {
  if (!entry || typeof entry !== 'object') return null;
  const viewer = entry.viewer as JsonObject | undefined;
  const login = typeof viewer?.login === 'string' ? viewer.login.trim().toLowerCase() : '';
  if (!login) return null;

  const traBadges = Array.isArray(entry.tra_badges)
    ? entry.tra_badges.map((badge) => normalizeBadge(badge as JsonObject, 'tra')).filter(Boolean) as V3Badge[]
    : [];
  const tsrBadges = Array.isArray(entry.tsr_badges)
    ? entry.tsr_badges.map((badge) => normalizeBadge(badge as JsonObject, 'tsr')).filter(Boolean) as V3Badge[]
    : [];

  return {
    viewer: {
      id: typeof viewer?.id === 'string' ? viewer.id : null,
      login,
      twitchId: typeof viewer?.twitch_id === 'string' ? viewer.twitch_id : null,
    },
    badges: [...traBadges, ...tsrBadges],
    traBadges,
    tsrBadges,
  };
}

function normalizeChannelBadgesResponse(payload: JsonObject | null | undefined): V3ViewerBadges | null {
  if (!payload) return null;
  return normalizeViewerBadges(payload);
}

function unwrapData<T>(payload: any): T {
  return (payload?.data ?? payload) as T;
}

export interface ViewerMeResponse {
  twitch_username: string;
  avatar_url: string | null;
  is_linked: boolean;
  telegram_linked?: boolean;
  color_banned?: boolean;
  color_ban_reason?: string | null;
}

export interface ViewerMeResult {
  ok: boolean;
  status: number;
  unauthorized: boolean;
  data: ViewerMeResponse | null;
}

export interface V3ChannelBadgesResponse {
  channel: {
    id: string | null;
    login: string;
    twitch_channel_id: string | null;
  };
  viewers: Record<string, V3ViewerBadges>;
}

export async function getViewerMe(token: string): Promise<ViewerMeResult> {
  const res = await fetch(apiUrl('/api/viewer/me'), {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (res.status === 401) {
    return { ok: false, status: res.status, unauthorized: true, data: null };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, unauthorized: false, data: null };
  }

  const text = await res.text();
  if (!text) return { ok: true, status: res.status, unauthorized: false, data: null };

  try {
    return {
      ok: true,
      status: res.status,
      unauthorized: false,
      data: unwrapData<ViewerMeResponse>(JSON.parse(text)),
    };
  } catch {
    return { ok: false, status: res.status, unauthorized: false, data: null };
  }
}

export async function getChannelViewerBadges(channel: string, viewer: string): Promise<V3ViewerBadges | null> {
  const response = await requestJson<JsonObject>(
    `${API_V3_CHANNELS_PATH}/${encodeURIComponent(channel)}/viewers/${encodeURIComponent(viewer)}/badges`,
  );
  return response ? normalizeChannelBadgesResponse(unwrapData<JsonObject>(response)) : null;
}

export async function getChannelBadges(channel: string, viewers: string[]): Promise<V3ChannelBadgesResponse | null> {
  const normalizedViewers = Array.from(new Set(viewers.map((viewer) => viewer.trim().toLowerCase()).filter(Boolean)));
  if (!normalizedViewers.length) return null;

  const response = await requestJson<JsonObject>(
    `${API_V3_CHANNELS_PATH}/${encodeURIComponent(channel)}/badges?${new URLSearchParams({ viewers: normalizedViewers.join(',') }).toString()}`,
  );
  if (!response) return null;

  const data = unwrapData<JsonObject>(response);
  const viewersMap: Record<string, V3ViewerBadges> = {};
  const rawViewers = data.viewers as Record<string, JsonObject> | undefined;
  if (rawViewers) {
    for (const [key, entry] of Object.entries(rawViewers)) {
      const normalized = normalizeViewerBadges(entry);
      if (normalized) viewersMap[key.toLowerCase()] = normalized;
    }
  }

  const fallbackViewer = normalizeViewerBadges(data);
  if (fallbackViewer && !Object.keys(viewersMap).length) {
    viewersMap[fallbackViewer.viewer.login] = fallbackViewer;
  }

  return {
    channel: {
      id: typeof data.channel?.id === 'string' ? data.channel.id : null,
      login: typeof data.channel?.login === 'string' ? data.channel.login : channel.trim().toLowerCase(),
      twitch_channel_id: typeof data.channel?.twitch_channel_id === 'string' ? data.channel.twitch_channel_id : null,
    },
    viewers: viewersMap,
  };
}

export async function getSocialChannelStatus(channel: string, token?: string): Promise<SocialChannelStatus | null> {
  const response = await requestJson<JsonObject>(
    `${API_V3_SOCIAL_CHANNELS_PATH}/${encodeURIComponent(channel)}/status`,
    {},
    token,
  );
  if (!response) return null;
  const data = unwrapData<JsonObject>(response);
  return {
    channelLogin: typeof data.channel?.login === 'string' ? data.channel.login : channel.trim().toLowerCase(),
    ratingEnabled: Boolean(data.channel?.rating_enabled),
    activityPublic: Boolean(data.channel?.activity_public),
  };
}

export async function getSocialRating(channel: string, viewer: string, token?: string): Promise<SocialRating | null> {
  const response = await requestJson<JsonObject>(
    `${API_V3_SOCIAL_CHANNELS_PATH}/${encodeURIComponent(channel)}/viewers/${encodeURIComponent(viewer)}/rating`,
    {},
    token,
  );
  if (!response) return null;
  const data = unwrapData<JsonObject>(response);
  const swagScore = Number(data.swag_score ?? data.score);
  const socialScore = Number(data.social_score ?? 0);
  if (!Number.isFinite(swagScore)) return null;
  return {
    channelLogin: typeof data.channel?.login === 'string' ? data.channel.login : channel.trim().toLowerCase(),
    viewerLogin: typeof data.viewer?.login === 'string' ? data.viewer.login : viewer.trim().toLowerCase(),
    swagScore,
    socialScore,
    enabled: data.enabled !== false,
  };
}

export async function postSocialVote(
  channel: string,
  targetLogin: string,
  value: 1 | -1,
  token: string,
): Promise<SocialRating | null> {
  const response = await requestJson<JsonObject>(
    `${API_V3_SOCIAL_CHANNELS_PATH}/${encodeURIComponent(channel)}/votes`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_login: targetLogin, value }),
    },
    token,
  );
  return response ? getSocialRating(channel, targetLogin, token) : null;
}

export async function getSocialAliases(token?: string): Promise<unknown | null> {
  return requestJson('/api/v3/social/aliases', {}, token);
}

export async function upsertSocialAlias(alias: string, login: string, token: string): Promise<unknown | null> {
  return requestJson(
    '/api/v3/social/aliases',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias, login }),
    },
    token,
  );
}

export async function deleteSocialAlias(alias: string, token: string): Promise<unknown | null> {
  return requestJson(
    `/api/v3/social/aliases/${encodeURIComponent(alias)}`,
    { method: 'DELETE' },
    token,
  );
}
