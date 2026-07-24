import { BACKEND_URL } from '../../shared/config';
import browser from '../../shared/browser';
import { fetchChannelBadges, normalizeViewerBadges } from './api';
import { normalizeLogin, updateDynamicStyles } from './dom';
import { processNativeMessage } from './native-chat';
import { processSevenTVMessage } from './seventv-chat';
import { processUserCard } from './usercard';
import { clearBadgeRenderState, getBadgeRenderState, isTributeMessageHealthy } from './render-state';
import type { Badge, FontPreset, ViewerConfig } from './types';

const LOG_PREFIX = '[Svaga+ badges]';
const TRIBUTE_NAME_SELECTORS = '.chat-author__display-name, .message-author__display-name, .chatter-name';

declare const io: undefined | ((url: string, options: Record<string, unknown>) => {
  emit(event: string, payload?: unknown): void;
  on(event: string, handler: (payload?: any) => void): void;
  disconnect(): void;
});

interface CacheEntry {
  expiresAt: number;
  badges: Badge[];
}

const cachedUsers: Record<string, ViewerConfig> = {};
const fontPresets: Record<string, FontPreset> = {};
const viewerBadgeCache: Record<string, CacheEntry> = {};
const viewerBadgeInflight: Record<string, {
  promise: Promise<Badge[]>;
  resolve: (badges: Badge[]) => void;
  reject: (error: Error) => void;
}> = {};
const viewerBadgeBatchState: Record<string, { pending: Set<string>; timer: number | null; running: boolean }> = {};
const socialRatingListeners = new Set<(payload: { channel: string; login: string; score: number; swag_score?: number; social_score?: number }) => void>();
const badgeGrantListeners = new Set<(payload: { channel: string }) => void>();
const STARTUP_SCAN_DELAYS_MS = [0, 100, 300, 700, 1500, 3000];

let currentChannelName: string | null = null;
let socket: ReturnType<NonNullable<typeof io>> | null = null;
let styleRafPending = false;
let initialFetchSucceeded = false;
let channelRefreshTimer: number | null = null;
let startupScanTimer: number | null = null;
let startupScanGeneration = 0;
let startupScanSeenLogins = new Set<string>();
let lastUrl = location.href;
let lastVisibilityRecoveryAt = 0;
let softReprocessGeneration = 0;
let hiddenFlushGeneration = 0;
const hiddenMessageQueue = new Set<HTMLElement>();

const VIEWER_BADGE_CACHE_TTL_MS = 10 * 60 * 1000;
const VIEWER_BADGE_FAIL_CACHE_TTL_MS = 30_000;
const VISIBILITY_RECOVERY_DEBOUNCE_MS = 5_000;
const REPROCESS_CHUNK_SIZE = 32;

function scheduleDynamicStyles(): void {
  if (styleRafPending) return;
  styleRafPending = true;
  const run = () => {
    styleRafPending = false;
    updateDynamicStyles(cachedUsers, fontPresets, BACKEND_URL);
  };
  if (document.hidden) {
    setTimeout(run, 100);
  } else {
    requestAnimationFrame(run);
  }
}

function viewerBadgeKey(channelName: string, login: string): string {
  return `${normalizeLogin(channelName)}:${normalizeLogin(login)}`;
}

function getBatchState(channelName: string) {
  const key = normalizeLogin(channelName);
  viewerBadgeBatchState[key] ||= { pending: new Set<string>(), timer: null, running: false };
  return viewerBadgeBatchState[key];
}

function cacheViewerBadges(channelName: string, login: string, badges: Badge[]): void {
  viewerBadgeCache[viewerBadgeKey(channelName, login)] = { expiresAt: Date.now() + VIEWER_BADGE_CACHE_TTL_MS, badges };
  console.debug(LOG_PREFIX, 'cached viewer badges', { channelName, login, count: badges.length });
}

function cacheViewerStyle(login: string, viewer: Record<string, unknown> | null | undefined): void {
  if (!viewer || typeof viewer !== 'object') return;
  const nextConfig: ViewerConfig = {};
  if (typeof viewer.name_color === 'string') nextConfig.name_color = viewer.name_color;
  if (typeof viewer.name_gradient === 'string') nextConfig.name_gradient = viewer.name_gradient;
  if (typeof viewer.name_css === 'string') nextConfig.name_css = viewer.name_css;
  if (typeof viewer.name_preset_name === 'string') nextConfig.name_preset_name = viewer.name_preset_name;
  if (typeof viewer.font_preset_id === 'string' || typeof viewer.font_preset_id === 'number') nextConfig.font_preset_id = viewer.font_preset_id;
  if (Object.keys(nextConfig).length === 0) return;
  cachedUsers[normalizeLogin(login)] = { ...(cachedUsers[normalizeLogin(login)] || {}), ...nextConfig };
  scheduleDynamicStyles();
}

function invalidateViewerBadgeCache(channelName: string, login?: string): void {
  const channelPrefix = `${normalizeLogin(channelName)}:`;
  if (!login) {
    for (const key of Object.keys(viewerBadgeCache)) if (key.startsWith(channelPrefix)) delete viewerBadgeCache[key];
    for (const key of Object.keys(viewerBadgeInflight)) {
      if (key.startsWith(channelPrefix)) {
        viewerBadgeInflight[key]?.reject(new Error('cache invalidated'));
        delete viewerBadgeInflight[key];
      }
    }
    const state = viewerBadgeBatchState[normalizeLogin(channelName)];
    if (state) {
      state.pending.clear();
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
      state.running = false;
    }
    return;
  }
  delete viewerBadgeCache[viewerBadgeKey(channelName, login)];
  viewerBadgeInflight[viewerBadgeKey(channelName, login)]?.reject(new Error('cache invalidated'));
  delete viewerBadgeInflight[viewerBadgeKey(channelName, login)];
}

async function flushViewerBadgeBatch(channelName: string): Promise<void> {
  const state = getBatchState(channelName);
  if (state.running || state.pending.size === 0 || !channelName) return;

  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  state.running = true;
  const logins = Array.from(state.pending);
  state.pending.clear();
  console.info(LOG_PREFIX, 'flush batch', { channelName, logins, count: logins.length });

  try {
    const payload = await fetchChannelBadges(channelName, logins);
    if (!payload) throw new Error('FETCH_CHANNEL_BADGES failed');
    if (payload.font_presets) Object.assign(fontPresets, payload.font_presets);
    for (const login of logins) {
      const viewer = payload.viewers?.[login] || payload.viewers?.[normalizeLogin(login)] || null;
      const badges = normalizeViewerBadges(payload, login);
      cacheViewerStyle(login, viewer as Record<string, unknown> | null);
      cacheViewerBadges(channelName, login, badges);
      viewerBadgeInflight[viewerBadgeKey(channelName, login)]?.resolve(badges);
      delete viewerBadgeInflight[viewerBadgeKey(channelName, login)];
    }
  } catch {
    console.warn(LOG_PREFIX, 'batch fetch failed', { channelName, logins });
    for (const login of logins) {
      viewerBadgeCache[viewerBadgeKey(channelName, login)] = {
        expiresAt: Date.now() + VIEWER_BADGE_FAIL_CACHE_TTL_MS,
        badges: [],
      };
      viewerBadgeInflight[viewerBadgeKey(channelName, login)]?.resolve([]);
      delete viewerBadgeInflight[viewerBadgeKey(channelName, login)];
    }
  } finally {
    state.running = false;
    if (state.pending.size > 0 && !state.timer) {
      const delay = document.hidden ? 300 : 80;
      state.timer = window.setTimeout(() => void flushViewerBadgeBatch(channelName), delay);
    }
  }
}

function resolveBadgesForLogin(channelName: string | null, login: string, force = false): Promise<Badge[]> {
  const normalizedChannel = normalizeLogin(channelName);
  const normalizedLoginValue = normalizeLogin(login);
  if (!normalizedChannel || !normalizedLoginValue) return Promise.resolve([]);

  const key = viewerBadgeKey(normalizedChannel, normalizedLoginValue);
  const cached = viewerBadgeCache[key];
  if (cached && cached.expiresAt > Date.now() && !force) {
    console.debug(LOG_PREFIX, 'cache hit', { channel: normalizedChannel, login: normalizedLoginValue, count: cached.badges.length });
    return Promise.resolve(cached.badges);
  }
  if (force) {
    delete viewerBadgeCache[key];
  }

  const inflight = viewerBadgeInflight[key];
  if (inflight) return inflight.promise;

  let resolve!: (badges: Badge[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Badge[]>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  viewerBadgeInflight[key] = { promise, resolve, reject };
  const state = getBatchState(normalizedChannel);
  state.pending.add(normalizedLoginValue);
  console.debug(LOG_PREFIX, 'queue viewer', { channel: normalizedChannel, login: normalizedLoginValue, pending: state.pending.size });
  if (!state.running && !state.timer) {
    const delay = document.hidden ? 300 : 80;
    state.timer = window.setTimeout(() => void flushViewerBadgeBatch(normalizedChannel), delay);
  }
  return promise;
}

const tributeContext = {
  getCurrentChannel: () => currentChannelName,
  getCachedUser: (login: string) => cachedUsers[normalizeLogin(login)],
  resolveBadgesForLogin,
};

function collectVisibleLogins(): string[] {
  const logins = new Set<string>();
  document.querySelectorAll(`.chat-line__message ${TRIBUTE_NAME_SELECTORS}, .seventv-user-message .seventv-chat-user-username`).forEach((el) => {
    const raw = (el.textContent || '').replace(/^@/, '').trim();
    const match = raw.match(/\(([^)]+)\)\s*$/);
    const login = normalizeLogin(match ? match[1] : raw);
    if (login) logins.add(login);
  });
  return Array.from(logins);
}

async function fetchBadges(channelName: string, logins = collectVisibleLogins(), forceRefresh = false): Promise<void> {
  const pending = logins.filter((login) => {
    if (forceRefresh) return true;
    const cached = viewerBadgeCache[viewerBadgeKey(channelName, login)];
    return !cached || cached.expiresAt <= Date.now();
  });
  if (forceRefresh) {
    for (const login of pending) {
      invalidateViewerBadgeCache(channelName, login);
      browser.runtime.sendMessage({ type: 'INVALIDATE_TRIBUTE_BADGE_CACHE', channelLogin: channelName, login }).catch(() => {});
    }
  }
  try {
    await Promise.all(pending.map((login) => resolveBadgesForLogin(channelName, login, forceRefresh)));
  } catch {
    console.warn(LOG_PREFIX, 'fetchBadges batch rejected', { channelName, logins: pending });
  }
  if (normalizeLogin(channelName) === currentChannelName) initialFetchSucceeded = true;
}

function reprocessVisibleChat(): void {
  document.querySelectorAll('.seventv-message, .seventv-user-message').forEach((el) => {
    clearBadgeRenderState(el as HTMLElement);
    processSevenTVMessage(el, tributeContext);
  });
  document.querySelectorAll('.chat-line__message').forEach((el) => {
    clearBadgeRenderState(el as HTMLElement);
    processNativeMessage(el, tributeContext);
  });
}

function softReprocessVisibleChat(): void {
  const generation = ++softReprocessGeneration;
  const messages: HTMLElement[] = [
    ...Array.from(document.querySelectorAll<HTMLElement>('.seventv-message, .seventv-user-message')),
    ...Array.from(document.querySelectorAll<HTMLElement>('.chat-line__message')),
  ];

  let index = 0;
  const pump = () => {
    if (generation !== softReprocessGeneration || document.hidden) return;
    const end = Math.min(index + REPROCESS_CHUNK_SIZE, messages.length);
    for (; index < end; index++) {
      const el = messages[index];
      if (!el.isConnected) continue;

      if (getBadgeRenderState(el) === 'empty') {
        const login = el.dataset.tcbUserLogin;
        if (login && currentChannelName) {
          const cached = viewerBadgeCache[viewerBadgeKey(currentChannelName, login)];
          if (!(cached && cached.badges.length > 0 && cached.expiresAt > Date.now())) {
            continue;
          }
        } else {
          continue;
        }
      } else if (isTributeMessageHealthy(el)) {
        continue;
      }

      clearBadgeRenderState(el);
      if (el.classList.contains('chat-line__message')) {
        processNativeMessage(el, tributeContext);
      } else {
        processSevenTVMessage(el, tributeContext);
      }
    }
    if (index < messages.length) {
      requestAnimationFrame(pump);
    }
  };
  requestAnimationFrame(pump);
}

function enqueueOrProcessMessage(el: HTMLElement, kind: 'native' | 'seventv'): void {
  if (document.hidden) {
    hiddenMessageQueue.add(el);
    return;
  }
  if (kind === 'native') processNativeMessage(el, tributeContext);
  else processSevenTVMessage(el, tributeContext);
}

function flushHiddenMessageQueue(): void {
  const items = Array.from(hiddenMessageQueue);
  hiddenMessageQueue.clear();
  const toProcess: HTMLElement[] = [];
  for (const el of items) {
    if (!el.isConnected) continue;
    if (isTributeMessageHealthy(el)) continue;
    clearBadgeRenderState(el);
    toProcess.push(el);
  }
  if (toProcess.length === 0) return;

  const generation = ++hiddenFlushGeneration;
  let index = 0;
  const pump = () => {
    if (generation !== hiddenFlushGeneration || document.hidden) return;
    const end = Math.min(index + REPROCESS_CHUNK_SIZE, toProcess.length);
    for (; index < end; index++) {
      const el = toProcess[index];
      if (!el.isConnected) continue;
      if (el.classList.contains('chat-line__message')) processNativeMessage(el, tributeContext);
      else processSevenTVMessage(el, tributeContext);
    }
    if (index < toProcess.length) {
      requestAnimationFrame(pump);
    }
  };
  requestAnimationFrame(pump);
}

function onVisibilityRecover(): void {
  if (!currentChannelName || document.hidden) return;

  flushHiddenMessageQueue();

  const now = Date.now();
  if (now - lastVisibilityRecoveryAt < VISIBILITY_RECOVERY_DEBOUNCE_MS) return;
  lastVisibilityRecoveryAt = now;

  softReprocessVisibleChat();

  const channelName = currentChannelName;
  const logins = collectVisibleLogins();
  const missingOrStale = logins.filter((login) => {
    const cached = viewerBadgeCache[viewerBadgeKey(channelName, login)];
    return !cached || cached.expiresAt <= Date.now();
  });
  if (missingOrStale.length > 0) {
    void fetchBadges(channelName, missingOrStale, false);
  }
}

function stopStartupScan(): void {
  startupScanGeneration += 1;
  startupScanSeenLogins = new Set();
  if (startupScanTimer) clearTimeout(startupScanTimer);
  startupScanTimer = null;
}

function startStartupScan(channelName: string, forceRefresh = false): void {
  stopStartupScan();
  const generation = startupScanGeneration;
  let index = 0;

  const scan = () => {
    startupScanTimer = null;
    if (generation !== startupScanGeneration || normalizeLogin(channelName) !== currentChannelName) return;

    softReprocessVisibleChat();

    const logins = collectVisibleLogins();
    const newLogins = logins.filter((login) => !startupScanSeenLogins.has(login));
    for (const login of newLogins) startupScanSeenLogins.add(login);

    if (newLogins.length > 0) void fetchBadges(channelName, newLogins, forceRefresh);

    index += 1;
    if (index >= STARTUP_SCAN_DELAYS_MS.length) return;
    startupScanTimer = window.setTimeout(scan, STARTUP_SCAN_DELAYS_MS[index]);
  };

  startupScanTimer = window.setTimeout(scan, STARTUP_SCAN_DELAYS_MS[index]);
}

function resetChannelState(clearCache = true): void {
  if (channelRefreshTimer) clearTimeout(channelRefreshTimer);
  channelRefreshTimer = null;
  stopStartupScan();
  initialFetchSucceeded = false;
  if (socket) socket.disconnect();
  socket = null;
  for (const key of Object.keys(cachedUsers)) delete cachedUsers[key];
  for (const key of Object.keys(fontPresets)) delete fontPresets[key];
  if (clearCache && currentChannelName) invalidateViewerBadgeCache(currentChannelName);
  hiddenMessageQueue.clear();
  softReprocessGeneration += 1;
  hiddenFlushGeneration += 1;
  scheduleDynamicStyles();
}

function initSocket(channelName: string): void {
  if (socket) socket.disconnect();
  if (typeof io === 'undefined') return;

  socket = io(BACKEND_URL, {
    transports: ['websocket'],
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
    randomizationFactor: 0.7,
  });

  console.info(LOG_PREFIX, 'socket connecting', { channelName, backend: BACKEND_URL });

  let socketEverConnected = false;
  socket.on('connect', () => {
    console.info(LOG_PREFIX, 'socket connected', {
      channelName,
      socketId: (socket as { id?: string } | null)?.id || null,
      transport: (socket as { io?: { engine?: { transport?: { name?: string } } } } | null)?.io?.engine?.transport?.name || null,
    });
    socket?.emit('join_channel', { channel_name: channelName });
    if (socketEverConnected || !initialFetchSucceeded) void fetchBadges(channelName);
    socketEverConnected = true;
  });

  socket.on('hello', (msg) => {
    console.info(LOG_PREFIX, 'server hello', msg);
  });

  socket.on('joined_channel', (msg) => {
    console.info(LOG_PREFIX, 'joined channel ack', msg);
  });

  socket.on('connect_error', (error) => {
    console.warn(LOG_PREFIX, 'socket connect_error', {
      message: error?.message || String(error),
      data: (error as { data?: unknown } | null)?.data,
    });
  });

  socket.on('disconnect', (reason) => {
    console.warn(LOG_PREFIX, 'socket disconnected', { reason });
  });

  socket.on('error', (error) => {
    console.warn(LOG_PREFIX, 'socket error', error);
  });

  const manager = (socket as { io?: { on?: (event: string, handler: (...args: any[]) => void) => void } }).io;
  manager?.on?.('reconnect_attempt', (attempt: number) => {
    console.info(LOG_PREFIX, 'socket reconnect_attempt', { attempt });
  });
  manager?.on?.('reconnect', (attempt: number) => {
    console.info(LOG_PREFIX, 'socket reconnected', { attempt });
  });
  manager?.on?.('reconnect_error', (error: unknown) => {
    console.warn(LOG_PREFIX, 'socket reconnect_error', error);
  });
  manager?.on?.('reconnect_failed', () => {
    console.warn(LOG_PREFIX, 'socket reconnect_failed');
  });

  socket.on('badge_update', (msg) => {
    if (!msg) return;
    console.debug(LOG_PREFIX, 'badge_update raw', msg);
    if (msg.type === 'channel_refresh') {
      console.info(LOG_PREFIX, 'channel refresh', { channelName });
      invalidateViewerBadgeCache(channelName);
      browser.runtime.sendMessage({ type: 'INVALIDATE_TRIBUTE_BADGE_CACHE', channelLogin: channelName }).catch(() => {});
      if (channelRefreshTimer) return;
      channelRefreshTimer = window.setTimeout(() => {
        channelRefreshTimer = null;
        void fetchBadges(channelName);
      }, Math.random() * 5000);
      return;
    }
    if (msg.type !== 'user_update' || !msg.data?.twitch_username) return;

    const login = normalizeLogin(msg.data.twitch_username);
    console.debug(LOG_PREFIX, 'user update', {
      channelName,
      login,
      badgeIds: Array.isArray(msg.data.badge_ids) ? msg.data.badge_ids.length : 0,
      tra: Array.isArray(msg.data.tra_badges) ? msg.data.tra_badges.length : 0,
      tsr: Array.isArray(msg.data.tsr_badges) ? msg.data.tsr_badges.length : 0,
    });
    if (msg.data.font_presets) Object.assign(fontPresets, msg.data.font_presets);
    cachedUsers[login] = { ...(cachedUsers[login] || {}), ...(msg.data as ViewerConfig) };
    if (Array.isArray(msg.data.badge_ids) && msg.data.badges && typeof msg.data.badges === 'object') {
      const badges = normalizeViewerBadges({
        badges: msg.data.badges,
        viewers: {
          [login]: msg.data,
        },
      }, login);
      cacheViewerBadges(channelName, login, badges);
      viewerBadgeInflight[viewerBadgeKey(channelName, login)]?.resolve(badges);
      delete viewerBadgeInflight[viewerBadgeKey(channelName, login)];
      browser.runtime.sendMessage({
        type: 'UPSERT_TRIBUTE_BADGE_CACHE',
        channelLogin: channelName,
        login,
        viewer: msg.data,
        badges: msg.data.badges,
        font_presets: msg.data.font_presets,
      }).catch(() => {});
    } else if (Array.isArray(msg.data.tra_badges) || Array.isArray(msg.data.tsr_badges)) {
      const badges = normalizeViewerBadges(msg.data);
      cacheViewerBadges(channelName, login, badges);
      viewerBadgeInflight[viewerBadgeKey(channelName, login)]?.resolve(badges);
      delete viewerBadgeInflight[viewerBadgeKey(channelName, login)];
      browser.runtime.sendMessage({
        type: 'INVALIDATE_TRIBUTE_BADGE_CACHE',
        channelLogin: channelName,
        login,
      }).catch(() => {});
    } else {
      invalidateViewerBadgeCache(channelName, login);
      browser.runtime.sendMessage({ type: 'INVALIDATE_TRIBUTE_BADGE_CACHE', channelLogin: channelName, login }).catch(() => {});
    }
    scheduleDynamicStyles();
    refreshUserInChat(login);
  });

  socket.on('social_rating_update', (msg) => {
    console.debug(LOG_PREFIX, 'social_rating_update raw', msg);
    if (!msg || typeof msg.channel !== 'string' || typeof msg.login !== 'string') return;
    const score = typeof msg.swag_score === 'number' ? msg.swag_score : msg.score;
    if (typeof score !== 'number' || !Number.isFinite(score)) return;
    for (const listener of socialRatingListeners) listener({
      channel: normalizeLogin(msg.channel),
      login: normalizeLogin(msg.login),
      score,
      swag_score: typeof msg.swag_score === 'number' ? msg.swag_score : score,
      social_score: typeof msg.social_score === 'number' ? msg.social_score : 0,
    });
  });

  socket.on('badge_grants_updated', (msg) => {
    console.debug(LOG_PREFIX, 'badge_grants_updated raw', msg);
    if (!msg || typeof msg.channel !== 'string') return;
    const payload = { channel: normalizeLogin(msg.channel) };
    for (const listener of badgeGrantListeners) listener(payload);
  });
}

function extractChannelName(): string | null {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  if (window.location.hostname === 'dashboard.twitch.tv') {
    let idx = 0;
    if (parts[idx]?.toLowerCase() === 'popout') idx++;
    return parts[idx] === 'u' && parts[idx + 1] ? normalizeLogin(parts[idx + 1]) : null;
  }
  const excluded = new Set(['directory', 'messages', 'videos', 'settings', 'subscriptions', 'drops', 'wallet', 'inventory', 'auth', 'authorize', 'oauth', 'login', 'signup', 'passport', 'embed', 'bits', 'turbo', 'prime', 'store', 'payments', 'checkout', 'search', 'following', 'friends', 'notifications', 'support', 'jobs', 'about', 'p', 'help', 'downloads', 'broadcast']);
  const first = normalizeLogin(parts[0]);
  if (first === 'moderator' || first === 'popout') {
    let idx = 1;
    if (parts[idx]?.toLowerCase() === 'u' || parts[idx]?.toLowerCase() === 'moderator') idx++;
    return parts[idx] ? normalizeLogin(parts[idx]) : null;
  }
  return excluded.has(first) ? null : first;
}

function getTwitchLogin(): string | null {
  const cookieMatch = document.cookie.match(/(?:^|;\s*)login=([^;]*)/);
  if (cookieMatch?.[1]) return decodeURIComponent(cookieMatch[1]);
  try {
    for (const key of ['login', 'twilight-user', 'twitch-user']) {
      const value = localStorage.getItem(key);
      if (!value) continue;
      try {
        const parsed = JSON.parse(value);
        const found = parsed?.login || parsed?.user?.login || parsed?.data?.login;
        if (found) return String(found);
      } catch {
        if (/^[a-z0-9_]{3,25}$/i.test(value)) return value.toLowerCase();
      }
    }
  } catch {}
  return null;
}

function refreshUserInChat(username: string): void {
  const safe = username.replace(/(["\\])/g, '\\$1');
  const normalized = normalizeLogin(username);

  document.querySelectorAll(`[data-tcb-user="${safe}"]`).forEach((userBlock) => {
    const msg = userBlock.closest<HTMLElement>('.seventv-message, .seventv-user-message');
    if (msg) {
      clearBadgeRenderState(msg);
      processSevenTVMessage(msg, tributeContext);
    }
  });
  document.querySelectorAll<HTMLElement>('.chat-line__message').forEach((element) => {
    if (element.querySelector(`.chat-author__display-name[data-tcb-user="${safe}"]`)) {
      clearBadgeRenderState(element);
      processNativeMessage(element, tributeContext);
    }
  });

  // Also search messages without our data attr (first badge / previously empty).
  document.querySelectorAll<HTMLElement>('.seventv-user-message, .seventv-message').forEach((el) => {
    const nameEl = el.querySelector<HTMLElement>('.seventv-chat-user-username');
    if (!nameEl) return;
    const raw = (nameEl.textContent || '').replace(/^@/, '').trim();
    const intlMatch = raw.match(/\((\w+)\)\s*$/);
    const login = normalizeLogin(intlMatch ? intlMatch[1] : raw);
    if (login === normalized) {
      clearBadgeRenderState(el);
      processSevenTVMessage(el, tributeContext);
    }
  });

  document.querySelectorAll<HTMLElement>('.chat-line__message').forEach((element) => {
    const nameEl = element.querySelector<HTMLElement>(TRIBUTE_NAME_SELECTORS);
    if (!nameEl) return;
    const login = normalizeLogin(
      nameEl.getAttribute('data-a-user') ||
      nameEl.parentElement?.getAttribute('data-a-user') ||
      nameEl.textContent
    );
    if (login === normalized) {
      clearBadgeRenderState(element);
      processNativeMessage(element, tributeContext);
    }
  });
}

function processAddedNode(node: Node): void {
  if (!(node instanceof Element)) return;
  if (node.classList.contains('seventv-message') || node.classList.contains('seventv-user-message')) {
    enqueueOrProcessMessage(node as HTMLElement, 'seventv');
  }
  if (node.classList.contains('chat-line__message')) {
    enqueueOrProcessMessage(node as HTMLElement, 'native');
  }
  if (node.classList.contains('seventv-user-card-float') || node.classList.contains('seventv-user-card') || node.classList.contains('viewer-card')) {
    processUserCard(node, tributeContext);
  }

  node.querySelectorAll('.seventv-message, .seventv-user-message').forEach((el) => {
    enqueueOrProcessMessage(el as HTMLElement, 'seventv');
  });
  node.querySelectorAll('.chat-line__message').forEach((el) => {
    enqueueOrProcessMessage(el as HTMLElement, 'native');
  });
  node.querySelectorAll('.seventv-user-card-float, .seventv-user-card, .viewer-card, [data-a-target="viewer-card"]').forEach((el) => {
    processUserCard(el, tributeContext);
  });
}

const repairQueue = new Set<HTMLElement>();
let repairRaf: number | null = null;

function scheduleMessageRepair(message: HTMLElement): void {
  repairQueue.add(message);
  if (repairRaf !== null) return;

  const runner = () => {
    repairRaf = null;
    const items = Array.from(repairQueue);
    repairQueue.clear();
    for (const item of items) {
      if (!item.isConnected) continue;
      clearBadgeRenderState(item);
      processSevenTVMessage(item, tributeContext);
      processNativeMessage(item, tributeContext);
    }
  };

  if (document.hidden) {
    repairRaf = window.setTimeout(runner, 50) as any;
  } else {
    repairRaf = requestAnimationFrame(runner) as any;
  }
}

function maybeRepairRemovedTributeBadge(mutation: MutationRecord): void {
  if (!(mutation.target instanceof Element)) return;
  const removedOwnBadge = Array.from(mutation.removedNodes).some((node) => {
    if (!(node instanceof Element)) return false;
    return node.classList.contains('tcb-badge-img') ||
      node.classList.contains('tcb-badge-list') ||
      node.classList.contains('tcb-badge-list-stv') ||
      node.querySelector('.tcb-badge-img, .tcb-badge-list, .tcb-badge-list-stv') != null;
  });
  const targetIsBadgeContainer = mutation.target.classList.contains('chat-line__message--badges') ||
    mutation.target.classList.contains('seventv-chat-user-badge-list') ||
    !!mutation.target.closest('.chat-line__message--badges, .seventv-chat-user-badge-list');
  if (!removedOwnBadge && !targetIsBadgeContainer) return;
  const message = mutation.target.closest<HTMLElement>('.chat-line__message, .seventv-message, .seventv-user-message');
  if (!message) return;
  const state = getBadgeRenderState(message);
  if (state === 'pending' || state === 'empty') return;
  if (message.querySelector('.tcb-badge-img, .tcb-badge-list, .tcb-badge-list-stv') != null) return;
  scheduleMessageRepair(message);
}

function maybeRepairChangedUsername(mutation: MutationRecord): void {
  const parent = mutation.target instanceof Text ? mutation.target.parentElement : mutation.target instanceof Element ? mutation.target : null;
  if (!parent) return;
  const name = parent.closest('.chat-author__display-name, .seventv-chat-user-username');
  if (!name) return;
  const message = name.closest<HTMLElement>('.chat-line__message, .seventv-message, .seventv-user-message');
  if (message) scheduleMessageRepair(message);
}

function startObserver(): void {
  if (!document.body) {
    window.setTimeout(startObserver, 100);
    return;
  }
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(processAddedNode);
      if (mutation.type === 'childList') maybeRepairRemovedTributeBadge(mutation);
      if (mutation.type === 'characterData' || mutation.type === 'childList') maybeRepairChangedUsername(mutation);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  document.querySelectorAll('.seventv-message, .seventv-user-message').forEach((el) => processSevenTVMessage(el, tributeContext));
  document.querySelectorAll('.chat-line__message').forEach((el) => processNativeMessage(el, tributeContext));
  document.querySelectorAll('.seventv-user-card-float, .viewer-card').forEach((el) => processUserCard(el, tributeContext));
}

function checkUrlChange(): void {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  const newChannel = extractChannelName();
  if (!newChannel) {
    currentChannelName = null;
    resetChannelState(false);
    return;
  }
  if (newChannel !== currentChannelName) {
    resetChannelState();
    currentChannelName = newChannel;
    startStartupScan(newChannel);
    initSocket(newChannel);
  }
}

function hookNavigation(): void {
  const originalPushState = history.pushState.bind(history);
  history.pushState = (...args) => {
    originalPushState(...args);
    checkUrlChange();
  };
  const originalReplaceState = history.replaceState.bind(history);
  history.replaceState = (...args) => {
    originalReplaceState(...args);
    checkUrlChange();
  };
  window.addEventListener('popstate', checkUrlChange);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !currentChannelName) return;
    onVisibilityRecover();
  });
}

export function startTributeBadgesContent(): void {
  currentChannelName = extractChannelName();
  if (currentChannelName) {
    startStartupScan(currentChannelName);
    initSocket(currentChannelName);
  }
  startObserver();
  hookNavigation();

  chrome.runtime?.onMessage?.addListener((request, _sender, sendResponse) => {
    if (request?.type === 'GET_LOGIN') {
      sendResponse({ login: getTwitchLogin(), channel: currentChannelName });
    }
  });
}

export function subscribeRealtimeChannel(handlers: {
  onSocialRatingUpdate?: (payload: { channel: string; login: string; score: number; swag_score?: number; social_score?: number }) => void;
  onBadgeGrantsUpdated?: (payload: { channel: string }) => void;
}): () => void {
  if (handlers.onSocialRatingUpdate) socialRatingListeners.add(handlers.onSocialRatingUpdate);
  if (handlers.onBadgeGrantsUpdated) badgeGrantListeners.add(handlers.onBadgeGrantsUpdated);
  return () => {
    if (handlers.onSocialRatingUpdate) socialRatingListeners.delete(handlers.onSocialRatingUpdate);
    if (handlers.onBadgeGrantsUpdated) badgeGrantListeners.delete(handlers.onBadgeGrantsUpdated);
  };
}
