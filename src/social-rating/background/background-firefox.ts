import browser from 'webextension-polyfill';
import { debug, warn } from '../utils/logger';
import { Message, parseMessage } from './messages';
import {
  BACKEND_URL,
  getStored, storeTokens, logoutServer,
  getUserRating, fetchRatingForCard, fetchBadgeGrants, castVote,
  getAliases, setAlias, deleteAlias, exportAliases, importAliases, syncAliasesWithServer,
  refreshMe,
  getChannelPermissions, adjustChannelRating,
  getChannelModerators, addChannelModerator, removeChannelModerator,
  prefetchChannelBadgeGrants, getOrFetchChannelGrantsForLogin, invalidateChannelBadgeGrants,
} from './shared';

// ── OAuth login state ─────────────────────────────────────────────────────────
// Primary: callback.html sends OAUTH_CALLBACK message after page load.
// Backup:  tabs.onUpdated intercepts the redirect URL before page renders.
// Whichever resolves first wins; the other becomes a no-op.

type LoginResolve = (r: { success: boolean; userLogin?: string }) => void;

let loginResolve: LoginResolve | null = null;
let loginTabId: number | null = null;
let loginState: string | null = null;
let loginUpdListener: ((tid: number, ci: browser.Tabs.OnUpdatedChangeInfoType) => void) | null = null;
let loginRmvListener: ((tid: number) => void) | null = null;

function createLoginState(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function cleanupListeners(): void {
  if (loginUpdListener) { browser.tabs.onUpdated.removeListener(loginUpdListener); loginUpdListener = null; }
  if (loginRmvListener) { browser.tabs.onRemoved.removeListener(loginRmvListener); loginRmvListener = null; }
}

function finishLogin(result: { success: boolean; userLogin?: string }, closeTab = true): void {
  cleanupListeners();
  const tid = loginTabId;
  const resolve = loginResolve;
  loginTabId = null;
  loginResolve = null;
  loginState = null;
  if (resolve) resolve(result);
  if (closeTab && tid != null) browser.tabs.remove(tid).catch(() => {});
}

async function login(): Promise<{ success: boolean; userLogin?: string }> {
  if (loginResolve) finishLogin({ success: false }, true);

  const callbackUrl = browser.runtime.getURL('callback.html');
  loginState = createLoginState();
  const authUrl =
    `${BACKEND_URL}/auth/twitch` +
    `?extension_redirect_uri=${encodeURIComponent(callbackUrl)}` +
    `&extension_state=${encodeURIComponent(loginState)}`;

  let tab: browser.Tabs.Tab;
  try {
    tab = await browser.tabs.create({ url: authUrl, active: true });
  } catch {
    return { success: false };
  }
  loginTabId = tab.id!;

  return new Promise<{ success: boolean; userLogin?: string }>((resolve) => {
    loginResolve = resolve;

    const callbackBase = callbackUrl.split('?')[0].split('#')[0];
    loginUpdListener = (uid: number, ci: browser.Tabs.OnUpdatedChangeInfoType) => {
      if (uid !== loginTabId || !ci.url) return;
      const url = ci.url;
      const isExtDone = url.includes('/auth/extension-done');
      const isCallbackPage = url.startsWith(callbackBase);
      if (!isExtDone && !isCallbackPage) return;
      try {
        const u = new URL(url);
        const src = u.hash.length > 1 ? u.hash.slice(1) : u.search.slice(1);
        const p = new URLSearchParams(src);
        const at = p.get('access_token');
        const rt = p.get('refresh_token');
        const returnedState = p.get('extension_state');
        if (!loginState || returnedState !== loginState) return;
        if (!at || !rt) return;
        const ul = p.get('login') ?? undefined;
        const av = p.get('avatar_url') ?? undefined;
        const ei = parseInt(p.get('expires_in') ?? '900', 10);
        storeTokens(at, rt, ul, av, ei)
          .then(() => finishLogin({ success: true, userLogin: ul }, true))
          .catch(() => finishLogin({ success: false }, true));
      } catch { /* malformed URL */ }
    };

    loginRmvListener = (uid: number) => {
      if (uid !== loginTabId) return;
      loginTabId = null;
      finishLogin({ success: false }, false);
    };

    browser.tabs.onUpdated.addListener(loginUpdListener);
    browser.tabs.onRemoved.addListener(loginRmvListener);

    setTimeout(() => {
      if (loginResolve === resolve) finishLogin({ success: false }, true);
    }, 300_000);
  });
}

// ── Message listener ──────────────────────────────────────────────────────────
// IMPORTANT: webextension-polyfill in Firefox requires listeners to return a
// Promise for async responses. The Chrome-style `sendResponse + return true`
// pattern does not work reliably with the polyfill.
//
// Firefox GCs the returned Promise if the sender port closes before it resolves,
// logging "Promised response from onMessage listener went out of scope".
// Keeping live references in a Set prevents premature GC.

const _pending = new Set<Promise<unknown>>();

function handleMessage(msg: Message): Promise<unknown> | undefined {
  switch (msg.type) {
    case 'GET_AUTH':
      return getStored().then(({ accessToken, userLogin, avatarUrl }) => {
        const result = { authenticated: !!accessToken, userLogin: userLogin ?? null, avatarUrl: avatarUrl ?? null };
        debug('BG', 'GET_AUTH ->', result);
        return result;
      });
    case 'LOGIN':
      debug('BG', 'LOGIN start');
      return login().then((r) => { debug('BG', 'LOGIN ->', r); return r; });
    case 'LOGOUT':
      return logoutServer().then(() => ({ success: true }));
    case 'GET_USER_RATING':
      debug('BG', 'GET_USER_RATING channel=', msg.channelLogin);
      return getUserRating(msg.channelLogin).then((r) => { debug('BG', 'GET_USER_RATING ->', r); return r; });
    case 'FETCH_RATING':
      debug('BG', 'FETCH_RATING login=', msg.login, 'channel=', msg.channelLogin);
      return fetchRatingForCard(msg.login, msg.channelLogin).then((r) => { debug('BG', 'FETCH_RATING ->', r); return r; });
    case 'FETCH_BADGE_GRANTS':
      return fetchBadgeGrants(msg.channelLogin, msg.logins);
    case 'PREFETCH_CHANNEL_BADGE_GRANTS':
      return prefetchChannelBadgeGrants(msg.channelLogin).then(() => ({ ok: true }));
    case 'REFRESH_CHANNEL_BADGE_GRANTS':
      invalidateChannelBadgeGrants(msg.channelLogin);
      return prefetchChannelBadgeGrants(msg.channelLogin).then(() => ({ ok: true }));
    case 'GET_CHANNEL_BADGE_GRANTS_FOR_LOGIN':
      return getOrFetchChannelGrantsForLogin(msg.channelLogin, msg.login);
    case 'CAST_VOTE':
      return castVote(msg.login, msg.channelLogin, msg.value);
    case 'GET_CHANNEL_PERMISSIONS':
      return getChannelPermissions(msg.channelLogin);
    case 'ADJUST_CHANNEL_RATING':
      return adjustChannelRating(msg.channelLogin, msg.login, msg.value, msg.mode);
    case 'GET_CHANNEL_MODERATORS':
      return getChannelModerators(msg.channelLogin);
    case 'ADD_CHANNEL_MODERATOR':
      return addChannelModerator(msg.channelLogin, msg.targetLogin);
    case 'REMOVE_CHANNEL_MODERATOR':
      return removeChannelModerator(msg.channelLogin, msg.targetLogin);
    case 'GET_ALIASES':
      return getAliases().then((aliases) => ({ aliases }));
    case 'SET_ALIAS':
      return setAlias(msg.login, msg.alias);
    case 'DELETE_ALIAS':
      return deleteAlias(msg.login);
    case 'EXPORT_ALIASES':
      return exportAliases();
    case 'IMPORT_ALIASES':
      return importAliases(msg.data);
    case 'SYNC_ALIASES':
      return syncAliasesWithServer();
    case 'REFRESH_ME':
      debug('BG', 'REFRESH_ME');
      return refreshMe().then((r) => { debug('BG', 'REFRESH_ME ->', r); return r; });
    case 'FETCH_IMAGE':
      return fetchImageAsDataUrl(msg.url);
    case 'OAUTH_CALLBACK': {
      const { access_token: at, refresh_token: rt } = msg;
      debug('BG', 'OAUTH_CALLBACK at=', !!at, 'rt=', !!rt);
      if (!loginResolve || !loginState || msg.extension_state !== loginState) {
        return Promise.resolve({ ok: false });
      }
      if (!at || !rt) {
        finishLogin({ success: false }, true);
        return Promise.resolve({ ok: false });
      }
      const ul = msg.login ?? undefined;
      const av = msg.avatar_url ?? undefined;
      const ei = parseInt(msg.expires_in ?? '900', 10);
      return storeTokens(at, rt, ul, av, ei)
        .then(() => { finishLogin({ success: true, userLogin: ul }, true); return { ok: true }; })
        .catch(() => { finishLogin({ success: false }, true); return { ok: false }; });
    }
    default:
      warn('BG', 'unknown message type:', (msg as any).type);
      return undefined;
  }
}

async function fetchImageAsDataUrl(url: string): Promise<{ dataUrl: string | null }> {
  try {
    const res = await fetch(url);
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

browser.runtime.onMessage.addListener((message: unknown, sender: browser.Runtime.MessageSender): Promise<unknown> | undefined => {
  const msg = parseMessage(message, sender, { allowOAuthCallback: true });
  if (!msg) return Promise.resolve({ ok: false, error: 'bad_request' });
  debug('BG', 'received message:', msg.type, msg);
  const p = handleMessage(msg);
  if (!p) return undefined;
  _pending.add(p);
  p.finally(() => _pending.delete(p));
  return p;
});

// ── Sync aliases on startup if authenticated ──────────────────────────────────

(async () => {
  const { accessToken } = await getStored();
  if (accessToken) await syncAliasesWithServer().catch(() => {});
})();
