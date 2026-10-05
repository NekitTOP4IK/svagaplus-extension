import browser from '../shared/browser';
import {
  BACKEND_URL,
  FRONTEND_URL,
  VIEWER_AUTH_REDIRECT_PATH,
} from '../shared/config';
import { getTwitchAuthorizeUrl, getViewerMe, linkViewerTwitch } from '../shared/api';
import {
  clearViewerAccount,
  clearViewerAuthFeedback,
  getExtensionSettings,
  getViewerAuthFeedback,
  getViewerAccount,
  setExtensionSettings,
  setViewerAuthFeedback,
  setViewerAccount,
} from '../shared/storage';
import type { ExtensionSettings, ViewerAccount, ViewerAuthFeedback } from '../shared/types';
import {
  castVote,
  deleteAlias,
  exportAliases,
  fetchRatingForCard,
  getAliases,
  getUserRating,
  importAliases,
  refreshMe,
  setAlias,
  syncAliasesIfStale,
  syncAliasesWithServer,
} from '../features/social-rating/background';
import { apiCooldown, channelBadgesKey } from '../shared/request-cooldown';

type ViewerAccountResponse = {
  ok: true;
  account: Omit<ViewerAccount, 'token'> | null;
} | {
  ok: false;
  error: string;
};

type ViewerConnectResponse =
  | { ok: true }
  | {
    ok: false;
    error: string;
    details?: string;
    redirectUri?: string;
    actualRedirectUri?: string;
    source?: ViewerAuthFeedback['source'];
    stage?: ViewerAuthFeedback['stage'];
  };

const LOGIN_RE = /^[a-z0-9_]{3,25}$/;
const MAX_ALIAS_LENGTH = 64;
const MAX_IMPORT_ALIASES = 1000;
const CHANNEL_BADGES_CACHE_TTL_MS = 10 * 60 * 1000;
const CHANNEL_BADGES_REQUEST_TIMEOUT_MS = 10_000;
const CHANNEL_BADGES_BATCH_MAX = 100;
const CHANNEL_BADGES_PRUNE_INTERVAL_MS = 60_000;
const COOLDOWN_STORAGE_KEY = 'apiCooldown';

type ChannelBadgeViewerEntry = {
  expiresAt: number;
  // Order in which the data was observed: a request's start, or the moment of a realtime upsert.
  // A response that resolves late must not overwrite data observed after it was sent.
  seq: number;
  data: Record<string, unknown>;
};

type ChannelBadgesResponse = {
  ok: boolean;
  badges: Record<string, unknown>;
  font_presets: Record<string, unknown>;
  viewers: Record<string, unknown>;
  stale?: true;
};

type ChannelBadgeViewerInflightEntry = {
  request: Promise<ChannelBadgesResponse>;
  generationSnapshot: Map<string, number>;
};

const channelBadgeViewersCache = new Map<string, ChannelBadgeViewerEntry>();
const channelBadgeViewerIndex = new Map<string, Set<string>>();
const channelBadgeAssetsCache = new Map<string, { expiresAt: number; data: unknown }>();
const channelBadgeFontPresetsCache = new Map<string, { expiresAt: number; data: unknown }>();
const channelBadgeInflight = new Map<string, Promise<ChannelBadgesResponse>>();
const channelBadgeViewerInflight = new Map<string, ChannelBadgeViewerInflightEntry>();
const channelBadgeGenerations = new Map<string, number>();
const channelBadgeGenerationSnapshotRefs = new Map<string, number>();
type ChannelBadgeFetchWaiter = {
  remaining: Set<string>;
  ok: boolean;
  stale: boolean;
  resolve: (response: ChannelBadgesResponse) => void;
};

const channelBadgeFetchBatches = new Map<string, {
  pending: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  waiters: Map<string, ChannelBadgeFetchWaiter[]>;
}>();
let channelBadgeSeq = 0;
let lastChannelBadgesPruneAt = 0;

// MV3 service worker засыпает после ~30 с простоя и теряет память. Без этого
// 10-минутный cooldown на 404 для каналов без бэкенда сбрасывался бы при
// каждом пробуждении.
const apiCooldownRestored = restoreApiCooldown();

async function restoreApiCooldown(): Promise<void> {
  const area = browser.storage?.session;
  if (!area) return;
  try {
    const stored = await area.get(COOLDOWN_STORAGE_KEY);
    apiCooldown.restore(stored?.[COOLDOWN_STORAGE_KEY]);
  } catch {
    return;
  }
  const persist = (entries: Record<string, unknown>) => {
    area.set({ [COOLDOWN_STORAGE_KEY]: entries }).catch(() => {});
  };
  apiCooldown.setChangeListener(persist);
  persist(apiCooldown.snapshot());
}

function nextChannelBadgeSeq(): number {
  channelBadgeSeq += 1;
  return channelBadgeSeq;
}

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

const BADGE_PAGE_RE = /^\/badges\/(collectible|service|sub|social)\/[A-Za-z0-9-]{1,64}$/;
const BADGE_CARD_TTL_MS = 5 * 60 * 1000;
const BADGE_CARD_CACHE_MAX = 200;
const badgeCardCache = new Map<string, { at: number; card: unknown }>();

type BadgeCardResponse = { ok: true; card: unknown; url: string } | { ok: false; error: string };

async function fetchBadgeCard(page: string): Promise<BadgeCardResponse> {
  const url = `${FRONTEND_URL}${page}`;
  const cached = badgeCardCache.get(page);
  if (cached && Date.now() - cached.at < BADGE_CARD_TTL_MS) return { ok: true, card: cached.card, url };
  try {
    const res = await fetch(`${BACKEND_URL}/api/v3${page}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const body = await res.json() as { success?: boolean; data?: unknown };
    if (!body?.success || !body.data) return { ok: false, error: 'bad_response' };
    if (badgeCardCache.size >= BADGE_CARD_CACHE_MAX) {
      const oldest = badgeCardCache.keys().next().value;
      if (oldest !== undefined) badgeCardCache.delete(oldest);
    }
    badgeCardCache.set(page, { at: Date.now(), card: body.data });
    return { ok: true, card: body.data, url };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export function __fetchBadgeCard(page: string): Promise<BadgeCardResponse> {
  return fetchBadgeCard(page);
}

function channelViewerKey(channelLogin: string, login: string): string {
  return `${channelLogin}:${login}`;
}

function normalizedChannelViewerKey(channelLogin: string, login: string): string {
  return channelViewerKey(channelLogin.trim().toLowerCase(), login.trim().toLowerCase());
}

function channelBadgeGeneration(channelLogin: string, login: string): number {
  return channelBadgeGenerations.get(normalizedChannelViewerKey(channelLogin, login)) ?? 0;
}

function bumpChannelBadgeGeneration(channelLogin: string, login: string): void {
  const key = normalizedChannelViewerKey(channelLogin, login);
  if ((channelBadgeGenerationSnapshotRefs.get(key) ?? 0) > 0) {
    channelBadgeGenerations.set(key, channelBadgeGeneration(channelLogin, login) + 1);
  } else {
    channelBadgeGenerations.delete(key);
  }
  channelBadgeViewerInflight.delete(key);
}

function channelBadgeGenerationSnapshot(channelLogin: string, logins: string[]): Map<string, number> {
  return new Map(logins.map((login) => [login, channelBadgeGeneration(channelLogin, login)]));
}

function retainChannelBadgeGenerationSnapshot(
  channelLogin: string,
  snapshot: Map<string, number>,
): void {
  for (const login of snapshot.keys()) {
    const key = normalizedChannelViewerKey(channelLogin, login);
    channelBadgeGenerationSnapshotRefs.set(key, (channelBadgeGenerationSnapshotRefs.get(key) ?? 0) + 1);
  }
}

function releaseChannelBadgeGenerationSnapshot(
  channelLogin: string,
  snapshot: Map<string, number>,
): void {
  for (const login of snapshot.keys()) {
    const key = normalizedChannelViewerKey(channelLogin, login);
    const refs = channelBadgeGenerationSnapshotRefs.get(key) ?? 0;
    if (refs <= 1) {
      channelBadgeGenerationSnapshotRefs.delete(key);
      channelBadgeGenerations.delete(key);
    } else {
      channelBadgeGenerationSnapshotRefs.set(key, refs - 1);
    }
  }
}

function isChannelBadgeGenerationCurrent(
  channelLogin: string,
  snapshot: Map<string, number>,
): boolean {
  for (const [login, generation] of snapshot) {
    if (channelBadgeGeneration(channelLogin, login) !== generation) return false;
  }
  return true;
}

function staleChannelBadgesResponse(): ChannelBadgesResponse {
  return { ok: false, badges: {}, font_presets: {}, viewers: {}, stale: true };
}

function cacheViewerEntry(channelLogin: string, login: string, entry: ChannelBadgeViewerEntry): void {
  const normalizedChannel = channelLogin.toLowerCase();
  const normalizedLogin = login.toLowerCase();
  const key = channelViewerKey(normalizedChannel, normalizedLogin);
  const existing = channelBadgeViewersCache.get(key);
  if (existing && existing.seq > entry.seq) return;
  channelBadgeViewersCache.set(key, entry);
  let keys = channelBadgeViewerIndex.get(normalizedLogin);
  if (!keys) {
    keys = new Set<string>();
    channelBadgeViewerIndex.set(normalizedLogin, keys);
  }
  keys.add(key);
}

function deleteViewerEntry(key: string): void {
  channelBadgeViewersCache.delete(key);
  const separator = key.indexOf(':');
  if (separator < 0) return;
  const login = key.slice(separator + 1);
  const keys = channelBadgeViewerIndex.get(login);
  keys?.delete(key);
  if (keys?.size === 0) channelBadgeViewerIndex.delete(login);
}

// Firefox event page может жить часами, а записи иначе удаляются только при
// перезаписи — карты росли бы на каждого уникального чаттера.
function pruneExpiredChannelBadges(now = Date.now()): void {
  if (now - lastChannelBadgesPruneAt < CHANNEL_BADGES_PRUNE_INTERVAL_MS) return;
  lastChannelBadgesPruneAt = now;
  for (const [key, entry] of Array.from(channelBadgeViewersCache)) {
    if (entry.expiresAt <= now) deleteViewerEntry(key);
  }
  for (const cache of [channelBadgeAssetsCache, channelBadgeFontPresetsCache]) {
    for (const [key, entry] of Array.from(cache)) {
      if (entry.expiresAt <= now) cache.delete(key);
    }
  }
}

function emptyChannelBadgesResponse(logins: string[]): ChannelBadgesResponse {
  const viewers: Record<string, unknown> = {};
  for (const login of logins) {
    viewers[login] = { badge_ids: [] };
  }
  return { ok: true, badges: {}, font_presets: {}, viewers };
}

function uniqueSortedLogins(logins: string[]): string[] {
  return Array.from(new Set(logins.map((login) => login.trim().toLowerCase()).filter(Boolean))).sort();
}

function getCachedChannelBadges(channelLogin: string, logins: string[], requireAll = true): ChannelBadgesResponse | null {
  const now = Date.now();
  const badges: Record<string, unknown> = {};
  const font_presets: Record<string, unknown> = {};
  const viewers: Record<string, unknown> = {};
  let allFresh = true;

  for (const login of logins) {
    const viewer = channelBadgeViewersCache.get(channelViewerKey(channelLogin, login));
    if (!viewer || viewer.expiresAt <= now) {
      allFresh = false;
      continue;
    }
    const badgeIds = Array.isArray(viewer.data.badge_ids)
      ? viewer.data.badge_ids
        .map((badgeId) => (typeof badgeId === 'string' || typeof badgeId === 'number' ? String(badgeId) : ''))
        .filter(Boolean)
      : [];

    let viewerAssetsFresh = true;
    for (const badgeId of badgeIds) {
      const badge = channelBadgeAssetsCache.get(badgeId);
      if (!badge || badge.expiresAt <= now) {
        viewerAssetsFresh = false;
        break;
      }
      badges[badgeId] = badge.data;
    }
    if (!viewerAssetsFresh) {
      allFresh = false;
      continue;
    }

    const fontPresetId = viewer.data.font_preset_id;
    const fontPresetKey = typeof fontPresetId === 'string' || typeof fontPresetId === 'number' ? String(fontPresetId) : '';
    if (fontPresetKey) {
      const fontPreset = channelBadgeFontPresetsCache.get(fontPresetKey);
      if (!fontPreset || fontPreset.expiresAt <= now) {
        allFresh = false;
        continue;
      }
      font_presets[fontPresetKey] = fontPreset.data;
    }

    viewers[login] = viewer.data;
  }

  // requireAll различает два вызова с РАЗНОЙ семантикой:
  //
  // - до запроса («есть ли в кэше полный ответ?») — строго. Раньше хватало
  //   одного закэшированного логина из N, вызывающий коротко замыкался,
  //   и остальные оставались без бейджей на весь TTL.
  // - после успешного запроса («отдай что есть») — нестрого. cacheChannelBadges
  //   материализует пропущенных бэкендом запрошенных чаттеров как authoritative
  //   empty, поэтому они считаются свежими на TTL. Нестрогий fallback сохраняет
  //   ранее доступные данные, если запрос завершился ошибкой или частично.
  if (requireAll && (!allFresh || Object.keys(viewers).length !== logins.length)) return null;
  return { ok: true, badges, font_presets, viewers };
}

/** Только для тестов. */
export function __getCachedChannelBadges(channelLogin: string, logins: string[]): ChannelBadgesResponse | null {
  return getCachedChannelBadges(channelLogin, logins);
}

/** Только для тестов. */
export function __fetchChannelBadges(channelLogin: string, logins: string[], force = false): Promise<ChannelBadgesResponse> {
  return fetchChannelBadges(channelLogin, logins, force);
}

/** Только для тестов. */
export function __seedChannelViewer(channelLogin: string, login: string, data: Record<string, unknown>): void {
  cacheViewerEntry(channelLogin, login, {
    expiresAt: Date.now() + 600_000,
    seq: nextChannelBadgeSeq(),
    data: data as never,
  });
}

function cacheChannelBadges(
  channelLogin: string,
  response: ChannelBadgesResponse,
  requestedLogins: string[],
  seq: number,
): void {
  if (!response.ok) return;
  const now = Date.now();
  pruneExpiredChannelBadges(now);
  const expiresAt = now + CHANNEL_BADGES_CACHE_TTL_MS;

  for (const [badgeId, badge] of Object.entries(response.badges)) {
    channelBadgeAssetsCache.set(badgeId, { expiresAt, data: badge });
  }

  for (const [fontPresetId, fontPreset] of Object.entries(response.font_presets)) {
    channelBadgeFontPresetsCache.set(fontPresetId, { expiresAt, data: fontPreset });
  }

  for (const login of requestedLogins) {
    const viewer = response.viewers[login] ?? response.viewers[login.toLowerCase()];
    const viewerData: Record<string, unknown> = isRecord(viewer) ? { ...viewer } : { badge_ids: [] };
    viewerData.badge_ids = Array.isArray(viewerData.badge_ids)
      ? viewerData.badge_ids
        .map((badgeId) => (typeof badgeId === 'string' || typeof badgeId === 'number' ? String(badgeId) : ''))
        .filter(Boolean)
      : [];
    cacheViewerEntry(channelLogin, login, { expiresAt, seq, data: viewerData });
  }
}

function upsertChannelBadgeViewer(
  channelLogin: string,
  login: string,
  viewer: Record<string, unknown>,
  badges?: Record<string, unknown>,
  fontPresets?: Record<string, unknown>,
): void {
  const now = Date.now();
  pruneExpiredChannelBadges(now);
  const expiresAt = now + CHANNEL_BADGES_CACHE_TTL_MS;
  const normalizedLogin = login.toLowerCase();
  const viewerData = { ...viewer };
  const badgeIds = Array.isArray(viewerData.badge_ids)
    ? viewerData.badge_ids
        .map((badgeId) => (typeof badgeId === 'string' || typeof badgeId === 'number' ? String(badgeId) : ''))
        .filter(Boolean)
    : [];
  viewerData.badge_ids = badgeIds;
  cacheViewerEntry(channelLogin, normalizedLogin, {
    expiresAt,
    seq: nextChannelBadgeSeq(),
    data: viewerData,
  });
  if (badges && typeof badges === 'object') {
    for (const [badgeId, badge] of Object.entries(badges)) {
      channelBadgeAssetsCache.set(badgeId, { expiresAt, data: badge });
    }
  }
  if (fontPresets && typeof fontPresets === 'object') {
    for (const [fontPresetId, fontPreset] of Object.entries(fontPresets)) {
      channelBadgeFontPresetsCache.set(fontPresetId, { expiresAt, data: fontPreset });
    }
  }
}

async function fetchChannelBadgesFromBackendNow(channelLogin: string, logins: string[]): Promise<ChannelBadgesResponse> {
  await apiCooldownRestored;
  const coolKey = channelBadgesKey(channelLogin);
  if (apiCooldown.isBlocked(coolKey)) {
    return emptyChannelBadgesResponse(logins);
  }

  const generationSnapshot = channelBadgeGenerationSnapshot(channelLogin, logins);
  const requestKey = `${channelLogin}:${logins
    .map((login) => `${login}@${generationSnapshot.get(login) ?? 0}`)
    .join(',')}`;
  const inflight = channelBadgeInflight.get(requestKey);
  if (inflight) return inflight;

  retainChannelBadgeGenerationSnapshot(channelLogin, generationSnapshot);
  const seq = nextChannelBadgeSeq();
  let request!: Promise<ChannelBadgesResponse>;
  request = (async (): Promise<ChannelBadgesResponse> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CHANNEL_BADGES_REQUEST_TIMEOUT_MS);
      try {
        const params = new URLSearchParams({ viewers: logins.join(',') });
        const res = await fetch(
          `${BACKEND_URL}/api/v3/channels/${encodeURIComponent(channelLogin)}/badges?${params.toString()}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          if (!isChannelBadgeGenerationCurrent(channelLogin, generationSnapshot)) {
            return staleChannelBadgesResponse();
          }
          apiCooldown.markFromStatus(coolKey, res.status);
          const empty = emptyChannelBadgesResponse(logins);
          // cacheChannelBadges only stores when ok:true — empty has ok:true
          if (res.status === 404) {
            cacheChannelBadges(channelLogin, empty, logins, seq);
          }
          return empty;
        }
        const payload = await res.json();
        const data = payload?.data ?? payload;
        const response = {
          ok: true,
          badges: data?.badges && typeof data.badges === 'object' ? data.badges : {},
          font_presets: data?.font_presets && typeof data.font_presets === 'object' ? data.font_presets : {},
          viewers: data?.viewers && typeof data.viewers === 'object' ? data.viewers : {},
        };
        // Инвалидация одного зрителя не должна выбрасывать ответ на весь батч:
        // иначе один WS-апдейт во время запроса на 100 логинов перезапрашивал всех.
        const currentLogins = logins.filter(
          (login) => channelBadgeGeneration(channelLogin, login) === generationSnapshot.get(login),
        );
        if (currentLogins.length === 0) return staleChannelBadgesResponse();
        cacheChannelBadges(channelLogin, response, currentLogins, seq);
        return currentLogins.length === logins.length ? response : { ...response, stale: true };
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      if (!isChannelBadgeGenerationCurrent(channelLogin, generationSnapshot)) {
        return staleChannelBadgesResponse();
      }
      apiCooldown.markFromStatus(coolKey, 'network');
      return emptyChannelBadgesResponse(logins);
    } finally {
      channelBadgeInflight.delete(requestKey);
      for (const login of logins) {
        const key = channelViewerKey(channelLogin, login);
        if (channelBadgeViewerInflight.get(key)?.request === request) channelBadgeViewerInflight.delete(key);
      }
      releaseChannelBadgeGenerationSnapshot(channelLogin, generationSnapshot);
    }
  })();

  channelBadgeInflight.set(requestKey, request);
  for (const login of logins) {
    channelBadgeViewerInflight.set(channelViewerKey(channelLogin, login), { request, generationSnapshot });
  }
  return request;
}

function getChannelBadgeFetchBatch(channelLogin: string) {
  let batch = channelBadgeFetchBatches.get(channelLogin);
  if (!batch) {
    batch = { pending: new Set(), timer: null, running: false, waiters: new Map() };
    channelBadgeFetchBatches.set(channelLogin, batch);
  }
  return batch;
}

async function flushChannelBadgeFetchBatch(channelLogin: string): Promise<void> {
  const batch = getChannelBadgeFetchBatch(channelLogin);
  if (batch.running || batch.pending.size === 0) return;
  if (batch.timer) clearTimeout(batch.timer);
  batch.timer = null;
  batch.running = true;
  if (channelBadgeFetchBatches.get(channelLogin) === batch) {
    channelBadgeFetchBatches.delete(channelLogin);
  }

  try {
    while (batch.pending.size > 0) {
      const logins = Array.from(batch.pending).slice(0, CHANNEL_BADGES_BATCH_MAX);
      for (const login of logins) batch.pending.delete(login);
      const response = await fetchChannelBadgesFromBackendNow(channelLogin, logins);
      for (const login of logins) {
        const waiters = batch.waiters.get(login) ?? [];
        batch.waiters.delete(login);
        for (const waiter of waiters) settleChannelBadgeFetchWaiter(waiter, login, response);
      }
    }
  } finally {
    batch.running = false;
  }
}

// Логины одного вызывающего могут попасть в разные чанки по 100, если в окно
// дебаунса набились чужие. Резолв по первому чанку отдавал бы вызывающему
// неполный кэш, и он принимал недогруженных зрителей за сбой.
function settleChannelBadgeFetchWaiter(
  waiter: ChannelBadgeFetchWaiter,
  login: string,
  response: ChannelBadgesResponse,
): void {
  waiter.remaining.delete(login);
  if (response.ok) waiter.ok = true;
  if (response.stale) waiter.stale = true;
  if (waiter.remaining.size > 0) return;
  if (waiter.stale) waiter.resolve(staleChannelBadgesResponse());
  else waiter.resolve({ ok: waiter.ok, badges: {}, font_presets: {}, viewers: {} });
}

function queueChannelBadgeFetch(channelLogin: string, logins: string[]): Promise<ChannelBadgesResponse> {
  const batch = getChannelBadgeFetchBatch(channelLogin);
  return new Promise((resolve) => {
    const waiter: ChannelBadgeFetchWaiter = { remaining: new Set(logins), ok: false, stale: false, resolve };
    for (const login of logins) {
      batch.pending.add(login);
      const waiters = batch.waiters.get(login) ?? [];
      waiters.push(waiter);
      batch.waiters.set(login, waiters);
    }
    if (!batch.running && !batch.timer) {
      batch.timer = setTimeout(() => void flushChannelBadgeFetchBatch(channelLogin), 80);
    }
  });
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

async function fetchChannelBadges(channelLogin: string, logins: string[], force = false): Promise<ChannelBadgesResponse> {
  const normalizedLogins = uniqueSortedLogins(logins);
  if (normalizedLogins.length === 0) return { ok: true, badges: {}, font_presets: {}, viewers: {} };

  if (force) {
    for (const login of normalizedLogins) {
      const key = channelViewerKey(channelLogin, login);
      deleteViewerEntry(key);
    }
  }

  const cached = getCachedChannelBadges(channelLogin, normalizedLogins);
  if (cached && !force) return cached;

  let missing = normalizedLogins.filter((login) => {
    if (force) return true;
    const viewer = getCachedChannelBadges(channelLogin, [login]);
    return !viewer;
  });

  let networkRounds = 0;

  // Different batch shapes can overlap: [alice] may still be fetching when
  // [alice, bob] arrives. The old batch-level key only deduplicated identical
  // arrays, so both requests included alice. Wait for the per-viewer request,
  // then request only logins that are still absent from the cache.
  if (!force) {
    const inFlight = Array.from(new Set(
      missing
        .map((login) => {
          const key = channelViewerKey(channelLogin, login);
          const entry = channelBadgeViewerInflight.get(key);
          if (!entry) return null;
          if (!isChannelBadgeGenerationCurrent(channelLogin, entry.generationSnapshot)) {
            if (channelBadgeViewerInflight.get(key) === entry) channelBadgeViewerInflight.delete(key);
            return null;
          }
          return entry.request;
        })
        .filter((request): request is Promise<ChannelBadgesResponse> => request != null),
    ));
    if (inFlight.length > 0) {
      await Promise.all(inFlight);
      networkRounds = 1;
      missing = normalizedLogins.filter((login) => !getCachedChannelBadges(channelLogin, [login]));
    }
  }

  if (missing.length > 0) {
    const fetched = await queueChannelBadgeFetch(channelLogin, missing);
    networkRounds += 1;
    if (fetched.stale) {
      missing = normalizedLogins.filter((login) => !getCachedChannelBadges(channelLogin, [login]));
      if (missing.length > 0 && networkRounds < 2) {
        const refreshed = await queueChannelBadgeFetch(channelLogin, missing);
        networkRounds += 1;
        if (refreshed.stale) {
          return { ok: false, badges: {}, font_presets: {}, viewers: {} };
        }
        if (!refreshed.ok && missing.length === normalizedLogins.length) return refreshed;
      } else if (missing.length > 0) {
        return { ok: false, badges: {}, font_presets: {}, viewers: {} };
      }
    } else if (!fetched.ok && missing.length === normalizedLogins.length) {
      return fetched;
    }
  }

  // Успешный ответ уже закэшировал каждого запрошенного чаттера, включая
  // authoritative empty. Неполное покрытие означает transient failure: иначе
  // content-скрипт принял бы отсутствующих в частичном кэше за authoritative empty.
  return getCachedChannelBadges(channelLogin, normalizedLogins)
    ?? { ok: false, badges: {}, font_presets: {}, viewers: {} };
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

function getViewerAuthRedirectUrl(): string | null {
  if (!browser.identity?.getRedirectURL) return null;
  return browser.identity.getRedirectURL(VIEWER_AUTH_REDIRECT_PATH);
}

function logViewerAuthFailure(context: {
  error: string;
  details?: string;
  redirectUri?: string;
  actualRedirectUri?: string;
  source?: ViewerAuthFeedback['source'];
  stage?: ViewerAuthFeedback['stage'];
}): void {
  console.error('[svagaplus][auth]', context);
}

async function failViewerConnect(result: Extract<ViewerConnectResponse, { ok: false }>): Promise<ViewerConnectResponse> {
  logViewerAuthFailure(result);
  await setViewerAuthFeedback({
    error: result.error,
    details: result.details ?? null,
    redirectUri: result.redirectUri ?? null,
    actualRedirectUri: result.actualRedirectUri ?? null,
    source: result.source ?? 'oauth',
    stage: result.stage ?? null,
  });
  return result;
}

async function openConnect(): Promise<ViewerConnectResponse> {
  try {
    await clearViewerAuthFeedback();
    const redirectUri = getViewerAuthRedirectUrl();
    if (!redirectUri) {
      return failViewerConnect({
        ok: false,
        error: 'identity_unavailable',
        source: 'background',
        stage: 'launch_web_auth_flow',
      });
    }

    const state = crypto.randomUUID();
    const authorize = await getTwitchAuthorizeUrl(redirectUri, undefined, state);
    if (!authorize.ok || !authorize.url) {
      return failViewerConnect({
        ok: false,
        error: 'authorize_url_failed',
        redirectUri,
        source: 'api',
        stage: 'authorize_url',
      });
    }

    const authorizeUrl = new URL(authorize.url);
    const actualRedirectUri = authorizeUrl.searchParams.get('redirect_uri');
    if (actualRedirectUri && actualRedirectUri !== redirectUri) {
      return failViewerConnect({
        ok: false,
        error: 'redirect_uri_mismatch',
        details: 'Сервер авторизации вернул другой redirect URI.',
        redirectUri,
        actualRedirectUri,
        source: 'api',
        stage: 'redirect_uri_validation',
      });
    }

    const callbackUrl = await browser.identity.launchWebAuthFlow({
      interactive: true,
      url: authorize.url,
    });
    if (!callbackUrl) {
      return failViewerConnect({
        ok: false,
        error: 'oauth_cancelled',
        source: 'oauth',
        stage: 'launch_web_auth_flow',
      });
    }

    const callback = new URL(callbackUrl);
    if (callback.searchParams.get('state') !== state) {
      return failViewerConnect({
        ok: false,
        error: 'state_mismatch',
        source: 'oauth',
        stage: 'oauth_callback_validation',
      });
    }

    const error = callback.searchParams.get('error');
    if (error) {
      return failViewerConnect({
        ok: false,
        error,
        details: callback.searchParams.get('error_description') ?? undefined,
        redirectUri,
        actualRedirectUri: `${callback.origin}${callback.pathname}`,
        source: 'oauth',
        stage: 'oauth_callback_validation',
      });
    }

    const code = callback.searchParams.get('code');
    if (!code) {
      return failViewerConnect({
        ok: false,
        error: 'missing_code',
        source: 'oauth',
        stage: 'oauth_callback_validation',
      });
    }

    const auth = await linkViewerTwitch(code, redirectUri);
    if (!auth.ok || !auth.token) {
      return failViewerConnect({
        ok: false,
        error: 'token_exchange_failed',
        source: 'api',
        stage: 'token_exchange',
      });
    }

    const hydrated = await hydrateAccount(auth.token);
    if (!hydrated.ok) {
      return failViewerConnect({
        ok: false,
        error: hydrated.error,
        source: hydrated.error === 'invalid_token' ? 'background' : 'api',
        stage: 'viewer_hydration',
      });
    }
    await clearViewerAuthFeedback();
    // Свежий вход: забрать алиасы с сервера и отдать локальные, накопленные до входа.
    void syncAliasesWithServer().catch(() => {});
    return { ok: true };
  } catch (error) {
    return failViewerConnect({
      ok: false,
      error: 'oauth_failed',
      details: error instanceof Error ? error.message : undefined,
      source: 'oauth',
      stage: 'launch_web_auth_flow',
    });
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
  await clearViewerAuthFeedback();
  return { ok: true, account: sanitizeViewerAccount(account) };
}

async function validateStoredAccount(): Promise<void> {
  const account = await getViewerAccount();
  if (!account?.token) return;
  try {
    const hydrated = await hydrateAccount(account.token);
    if (hydrated.ok) void syncAliasesIfStale().catch(() => {});
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
    case 'viewer:getAccount':
      return getViewerAccount().then((account) => ({ ok: true, account: sanitizeViewerAccount(account) }));
    case 'viewer:getAuthFeedback':
      return getViewerAuthFeedback().then((feedback) => ({ ok: true, feedback }));
    case 'viewer:refreshAccount':
      return (async (): Promise<ViewerAccountResponse> => {
        const account = await getViewerAccount();
        if (!account?.token) return { ok: false, error: 'missing_token' };
        return hydrateAccount(account.token);
      })();
    case 'viewer:disconnect':
      return Promise.all([clearViewerAccount(), clearViewerAuthFeedback()]).then(() => ({ ok: true }));
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
      if ('customNicknamesEnabled' in patch) {
        if (typeof patch.customNicknamesEnabled !== 'boolean') return badRequest();
        nextPatch.customNicknamesEnabled = patch.customNicknamesEnabled;
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
    case 'FETCH_BADGE_CARD': {
      const page = (message as { page?: unknown }).page;
      if (typeof page !== 'string' || !BADGE_PAGE_RE.test(page)) return badRequest();
      return fetchBadgeCard(page);
    }
    case 'FETCH_CHANNEL_BADGES': {
      const channelLogin = normalizeLogin((message as { channelLogin?: unknown }).channelLogin);
      const loginsValue = (message as { logins?: unknown }).logins;
      const force = !!(message as { force?: unknown }).force;
      if (!channelLogin || !Array.isArray(loginsValue) || loginsValue.length > CHANNEL_BADGES_BATCH_MAX) return badRequest();

      const logins: string[] = [];
      for (const value of loginsValue) {
        const login = normalizeLogin(value);
        if (!login) return badRequest();
        logins.push(login);
      }

      return fetchChannelBadges(channelLogin, logins, force);
    }
    case 'INVALIDATE_TRIBUTE_BADGE_CACHE': {
      const channelLogin = normalizeLogin((message as { channelLogin?: unknown }).channelLogin);
      const login = normalizeLogin((message as { login?: unknown }).login);
      if (!channelLogin && !login) return badRequest();
      if (channelLogin && login) {
        bumpChannelBadgeGeneration(channelLogin, login);
      } else if (login) {
        const suffix = `:${login}`;
        const keys = new Set<string>(channelBadgeViewerIndex.get(login) || []);
        for (const key of channelBadgeViewerInflight.keys()) {
          if (key.endsWith(suffix)) keys.add(key);
        }
        for (const key of keys) {
          const separator = key.indexOf(':');
          if (separator >= 0) bumpChannelBadgeGeneration(key.slice(0, separator), login);
        }
      } else if (channelLogin) {
        const prefix = `${channelLogin}:`;
        const keys = new Set<string>();
        for (const key of channelBadgeViewersCache.keys()) {
          if (key.startsWith(prefix)) keys.add(key);
        }
        for (const key of channelBadgeViewerInflight.keys()) {
          if (key.startsWith(prefix)) keys.add(key);
        }
        for (const key of keys) bumpChannelBadgeGeneration(channelLogin, key.slice(prefix.length));
      }
      if (channelLogin && login) {
        deleteViewerEntry(channelViewerKey(channelLogin, login));
      } else if (login) {
        for (const key of Array.from(channelBadgeViewerIndex.get(login) || [])) deleteViewerEntry(key);
      } else {
        const prefix = `${channelLogin}:`;
        for (const key of Array.from(channelBadgeViewersCache.keys())) {
          if (key.startsWith(prefix)) deleteViewerEntry(key);
        }
      }
      if (channelLogin) apiCooldown.clear(channelBadgesKey(channelLogin));
      return Promise.resolve({ ok: true });
    }
    case 'UPSERT_TRIBUTE_BADGE_CACHE': {
      const channelLogin = normalizeLogin((message as { channelLogin?: unknown }).channelLogin);
      const login = normalizeLogin((message as { login?: unknown }).login);
      const viewer = (message as { viewer?: unknown }).viewer;
      if (!channelLogin || !login || !isRecord(viewer)) return badRequest();
      const badges = (message as { badges?: unknown }).badges;
      const font_presets = (message as { font_presets?: unknown }).font_presets;
      upsertChannelBadgeViewer(
        channelLogin,
        login,
        viewer,
        isRecord(badges) ? badges : undefined,
        isRecord(font_presets) ? font_presets : undefined,
      );
      return Promise.resolve({ ok: true });
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
