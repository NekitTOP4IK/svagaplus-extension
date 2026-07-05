import { subscribeRealtimeChannel } from '../tribute-badges';

const LOGIN_RE = /^[a-z0-9_]{3,25}$/;

export type RatingUpdateCallback = (login: string, score: number, socialScore?: number) => void;
export type BadgeGrantsUpdateCallback = (channelLogin: string) => void;

let activeChannel: string | null = null;
let onUpdateCb: RatingUpdateCallback | null = null;
let onBadgeGrantsUpdateCb: BadgeGrantsUpdateCallback | null = null;
let unsubscribe: (() => void) | null = null;

function normalizeChannel(channelLogin: string): string {
  return channelLogin.trim().toLowerCase();
}

function isValidLogin(value: unknown): value is string {
  return typeof value === 'string' && LOGIN_RE.test(value);
}

function isValidScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(value);
}

export function connectWebSocket(
  channelLogin: string,
  onUpdate: RatingUpdateCallback,
  onBadgeGrantsUpdate?: BadgeGrantsUpdateCallback,
): void {
  const normalizedChannel = normalizeChannel(channelLogin);
  if (!LOGIN_RE.test(normalizedChannel)) return;
  if (unsubscribe && activeChannel === normalizedChannel) return;
  disconnectWebSocket();
  activeChannel = normalizedChannel;
  onUpdateCb = onUpdate;
  onBadgeGrantsUpdateCb = onBadgeGrantsUpdate ?? null;
  unsubscribe = subscribeRealtimeChannel({
    onSocialRatingUpdate: (data) => {
      if (activeChannel !== normalizedChannel || !onUpdateCb) return;
      if (data.channel !== normalizedChannel || !isValidLogin(data.login) || !isValidScore(data.score)) return;
      onUpdateCb(data.login, data.score, isValidScore(data.social_score) ? data.social_score : undefined);
    },
    onBadgeGrantsUpdated: (data) => {
      if (activeChannel !== normalizedChannel || !onBadgeGrantsUpdateCb) return;
      if (data.channel !== normalizedChannel) return;
      onBadgeGrantsUpdateCb(data.channel);
    },
  });
}

export function disconnectWebSocket(): void {
  activeChannel = null;
  onUpdateCb = null;
  onBadgeGrantsUpdateCb = null;
  unsubscribe?.();
  unsubscribe = null;
}
