import browser from 'webextension-polyfill';
import { debug, error } from './logger';
import { RatingData } from './types';
import { ActiveBadgeGrant } from './types';

type ChannelBadgesResponse = {
  ok?: boolean;
  badges?: Record<string, Record<string, unknown>>;
  viewers?: Record<string, { badge_ids?: unknown[] }>;
};

function normalizeBadgeGrants(payload: ChannelBadgesResponse | null, logins: string[]): ActiveBadgeGrant[] {
  if (!payload?.ok) return [];
  const badges = payload.badges ?? {};
  const viewers = payload.viewers ?? {};

  return logins.flatMap((login) => {
    const normalizedLogin = login.trim().toLowerCase();
    const viewer = viewers[login] ?? viewers[normalizedLogin];
    const badgeIds = Array.isArray(viewer?.badge_ids) ? viewer.badge_ids : [];
    return badgeIds.flatMap((badgeId) => {
      const badge = badges[String(badgeId)];
      const rank = typeof badge?.rank === 'number' && Number.isSafeInteger(badge.rank) ? badge.rank : null;
      if (!badge || badge.source !== 'social_rating' || rank === null) return [];
      const rawUrl = typeof badge.url === 'string' ? badge.url : null;
      if (!rawUrl) return [];
      const imageUrl = /^https?:\/\//i.test(rawUrl)
        ? rawUrl
        : new URL(rawUrl, require('../../shared/config').BACKEND_URL).toString();
      return [{
        login: normalizedLogin,
        kind: badge.kind === 'low' ? 'low' : 'high',
        rank,
        image_url: imageUrl,
        title: typeof badge.title === 'string' ? badge.title : `Топ-${rank} чатер на канале`,
        period_label: typeof badge.period_id === 'string' || typeof badge.period_id === 'number'
          ? String(badge.period_id)
          : '',
      }];
    });
  });
}

export async function fetchRating(
  login: string,
  channelLogin: string,
): Promise<RatingData | null> {
  debug('api', 'fetchRating login=', login, 'channel=', channelLogin);
  try {
    const result = await browser.runtime.sendMessage({
      type: 'FETCH_RATING',
      login,
      channelLogin,
    });
    debug('api', 'fetchRating result=', result);
    return (result as RatingData | null) ?? null;
  } catch (e) {
    error('api', 'fetchRating error:', e);
    return null;
  }
}

export async function fetchBadgeGrants(
  channelLogin: string,
  logins: string[],
): Promise<ActiveBadgeGrant[]> {
  try {
    const result = await browser.runtime.sendMessage({
      type: 'FETCH_CHANNEL_BADGES',
      channelLogin,
      logins,
    });
    return normalizeBadgeGrants(result as ChannelBadgesResponse | null, logins);
  } catch (e) {
    error('api', 'fetchBadgeGrants error:', e);
    return [];
  }
}

export async function prefetchChannelBadgeGrants(channelLogin: string): Promise<void> {
  // Fetching on demand lets Social Rating share Tribute's cache and inflight
  // requests instead of issuing its own channel-wide /badges request.
  void channelLogin;
}

export async function refreshChannelBadgeGrants(channelLogin: string): Promise<void> {
  try {
    await browser.runtime.sendMessage({
      type: 'INVALIDATE_TRIBUTE_BADGE_CACHE',
      channelLogin,
    });
  } catch (e) {
    error('api', 'refreshChannelBadgeGrants error:', e);
  }
}

export async function getChannelGrantsForLogin(
  channelLogin: string,
  login: string,
): Promise<ActiveBadgeGrant[]> {
  return fetchBadgeGrants(channelLogin, [login]);
}

export async function getAliases(): Promise<Record<string, string>> {
  try {
    const result = (await browser.runtime.sendMessage({ type: 'GET_ALIASES' })) as {
      aliases?: Record<string, string>;
    } | null;
    return result?.aliases ?? {};
  } catch {
    return {};
  }
}

export async function setAlias(
  login: string,
  alias: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    return (await browser.runtime.sendMessage({
      type: 'SET_ALIAS',
      login,
      alias,
    })) as { ok: boolean; error?: string };
  } catch {
    return { ok: false, error: 'network_error' };
  }
}

export async function deleteAlias(
  login: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    return (await browser.runtime.sendMessage({
      type: 'DELETE_ALIAS',
      login,
    })) as { ok: boolean; error?: string };
  } catch {
    return { ok: false, error: 'network_error' };
  }
}

export async function exportAliases(): Promise<{
  data: Array<{ login: string; alias: string }>;
  count: number;
}> {
  try {
    return (await browser.runtime.sendMessage({
      type: 'EXPORT_ALIASES',
    })) as { data: Array<{ login: string; alias: string }>; count: number };
  } catch {
    return { data: [], count: 0 };
  }
}

export async function importAliases(
  data: Array<{ login: string; alias: string }>,
): Promise<{ ok: boolean; imported: number; error?: string }> {
  try {
    return (await browser.runtime.sendMessage({
      type: 'IMPORT_ALIASES',
      data,
    })) as { ok: boolean; imported: number; error?: string };
  } catch {
    return { ok: false, imported: 0, error: 'network_error' };
  }
}

export async function syncAliases(): Promise<{ ok: boolean; error?: string }> {
  try {
    return (await browser.runtime.sendMessage({ type: 'SYNC_ALIASES' })) as {
      ok: boolean;
      error?: string;
    };
  } catch {
    return { ok: false, error: 'network_error' };
  }
}
