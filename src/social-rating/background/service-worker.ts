import browser from 'webextension-polyfill';
import { debug } from '../utils/logger';
import { parseMessage } from './messages';
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

let loginState: string | null = null;

function createLoginState(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function login(): Promise<{ success: boolean; userLogin?: string }> {
  const redirectUri = browser.identity.getRedirectURL('callback');
  loginState = createLoginState();
  const authUrl =
    `${BACKEND_URL}/auth/twitch` +
    `?extension_redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&extension_state=${encodeURIComponent(loginState)}`;

  try {
    const responseUrl = await browser.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
    const url = new URL(responseUrl);
    const params = new URLSearchParams(url.hash ? url.hash.slice(1) : url.search.slice(1));
    if (params.get('extension_state') !== loginState) return { success: false };

    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (!accessToken || !refreshToken) return { success: false };

    const userLogin = params.get('login') ?? undefined;
    const avatarUrl = params.get('avatar_url') ?? undefined;
    const expiresIn = parseInt(params.get('expires_in') ?? '900', 10);

    await storeTokens(accessToken, refreshToken, userLogin, avatarUrl, expiresIn);
    await syncAliasesWithServer();

    return { success: true, userLogin };
  } catch {
    return { success: false };
  } finally {
    loginState = null;
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
  const msg = parseMessage(message, sender);
  if (!msg) return Promise.resolve({ ok: false, error: 'bad_request' });
  debug('BG', 'received message:', msg.type, msg);
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
    default:
      debug('BG', 'unknown message type:', (msg as any).type);
      return undefined;
  }
});

(async () => {
  const { accessToken } = await getStored();
  if (accessToken) await syncAliasesWithServer().catch(() => {});
})();
