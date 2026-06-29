import browser from 'webextension-polyfill';
import { debug, error } from '../utils/logger';
import { RatingData } from '../types';
import { ActiveBadgeGrant } from '../types';

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
      type: 'FETCH_BADGE_GRANTS',
      channelLogin,
      logins,
    });
    return Array.isArray(result) ? result as ActiveBadgeGrant[] : [];
  } catch (e) {
    error('api', 'fetchBadgeGrants error:', e);
    return [];
  }
}

export async function prefetchChannelBadgeGrants(channelLogin: string): Promise<void> {
  try {
    await browser.runtime.sendMessage({
      type: 'PREFETCH_CHANNEL_BADGE_GRANTS',
      channelLogin,
    });
  } catch (e) {
    error('api', 'prefetchChannelBadgeGrants error:', e);
  }
}

export async function refreshChannelBadgeGrants(channelLogin: string): Promise<void> {
  try {
    await browser.runtime.sendMessage({
      type: 'REFRESH_CHANNEL_BADGE_GRANTS',
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
  try {
    const result = await browser.runtime.sendMessage({
      type: 'GET_CHANNEL_BADGE_GRANTS_FOR_LOGIN',
      channelLogin,
      login,
    });
    return Array.isArray(result) ? result as ActiveBadgeGrant[] : [];
  } catch (e) {
    error('api', 'getChannelGrantsForLogin error:', e);
    return [];
  }
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
