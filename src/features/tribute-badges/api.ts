import browser from '../../shared/browser';
import { BACKEND_URL } from '../../shared/config';
import type { Badge } from './types';

const LOG_PREFIX = '[Svaga+ badges]';

interface V3BadgePayload {
  url?: unknown;
  title?: unknown;
  source?: unknown;
  rank?: unknown;
  image_url?: unknown;
  active?: unknown;
}

interface V3ViewerPayload {
  badge_ids?: unknown[];
  name_color?: unknown;
  name_gradient?: unknown;
  name_css?: unknown;
  name_preset_name?: unknown;
  font_preset_id?: unknown;
  tra_badges?: Array<Record<string, unknown>>;
  tsr_badges?: Array<Record<string, unknown>>;
}

interface V3FontPresetPayload {
  [key: string]: unknown;
}

interface V3ChannelBadgesPayload {
  badges?: Record<string, V3BadgePayload>;
  font_presets?: Record<string, V3FontPresetPayload>;
  viewers?: Record<string, V3ViewerPayload>;
}

function absoluteUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return new URL(url, BACKEND_URL).toString();
}

function normalizeBadge(raw: V3BadgePayload | null | undefined, fallbackRank: number): Badge | null {
  if (raw?.active === false) return null;
  const url = absoluteUrl(raw?.image_url ?? raw?.url);
  if (!url) return null;
  const source = raw?.source === 'social_rating' ? 'tsr' : 'tra';
  return {
    url,
    image_url: url,
    title: typeof raw?.title === 'string' ? raw.title : 'Badge',
    rank: Number.isSafeInteger(raw?.rank) ? Number(raw?.rank) : fallbackRank,
    source,
  };
}

export function normalizeViewerBadges(payload: V3ChannelBadgesPayload | V3ViewerPayload | null | undefined, login?: string): Badge[] {
  if (!login) {
    const legacyPayload = payload as V3ViewerPayload | null | undefined;
    const legacyBadges = [
      ...(Array.isArray(legacyPayload?.tra_badges) ? legacyPayload.tra_badges : []),
      ...(Array.isArray(legacyPayload?.tsr_badges) ? legacyPayload.tsr_badges : []),
    ];
    const normalized = legacyBadges
      .map((badge, index) => normalizeBadge(badge, index + 1))
      .filter((badge): badge is Badge => badge !== null);
    console.debug(LOG_PREFIX, 'legacy socket badges', { count: normalized.length });
    return normalized;
  }

  const channelPayload = payload as V3ChannelBadgesPayload | null | undefined;
  const viewer = channelPayload?.viewers?.[login] || channelPayload?.viewers?.[login.toLowerCase()];
  const badgeIds = Array.isArray(viewer?.badge_ids) ? viewer.badge_ids : [];
  const badges = channelPayload?.badges || {};

  const normalized = badgeIds
    .map((badgeId: unknown, index: number) => {
      const key = typeof badgeId === 'string' || typeof badgeId === 'number' ? String(badgeId) : '';
      return normalizeBadge(key ? badges[key] : null, index + 1);
    })
    .filter((badge: Badge | null): badge is Badge => badge !== null);
  console.debug(LOG_PREFIX, 'resolved viewer badges', {
    login,
    badgeIds: badgeIds.map((badgeId) => String(badgeId)),
    count: normalized.length,
  });
  return normalized;
}

export async function fetchChannelBadges(channel: string, logins: string[], force = false): Promise<V3ChannelBadgesPayload | null> {
  if (!channel || logins.length === 0) return { badges: {}, font_presets: {}, viewers: {} };
  console.debug(LOG_PREFIX, 'request batch', { channel, logins, force });
  try {
    const response = await browser.runtime.sendMessage({
      type: 'FETCH_CHANNEL_BADGES',
      channelLogin: channel,
      logins,
      force,
    }) as { ok?: boolean; badges?: Record<string, V3BadgePayload>; font_presets?: Record<string, V3FontPresetPayload>; viewers?: Record<string, V3ViewerPayload> } | null;

    if (!response?.ok) return null;

    const payload = {
      badges: response.badges || {},
      font_presets: response.font_presets || {},
      viewers: response.viewers || {},
    };
    console.debug(LOG_PREFIX, 'batch response', {
      channel,
      viewers: Object.keys(payload.viewers || {}),
      badges: Object.keys(payload.badges || {}),
      fontPresets: Object.keys(payload.font_presets || {}),
    });
    return payload;
  } catch (error) {
    console.warn(LOG_PREFIX, 'batch request failed', { channel, logins, error });
    return null;
  }
}
