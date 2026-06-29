import browser from 'webextension-polyfill';

const LOGIN_RE = /^[a-z0-9_]{3,25}$/;
const MAX_ALIAS_LENGTH = 64;
const MAX_IMPORT_ALIASES = 1000;

export type Message =
  | { type: 'GET_AUTH' }
  | { type: 'LOGIN' }
  | { type: 'LOGOUT' }
  | { type: 'GET_USER_RATING'; channelLogin: string }
  | { type: 'FETCH_RATING'; login: string; channelLogin: string }
  | { type: 'FETCH_BADGE_GRANTS'; channelLogin: string; logins: string[] }
  | { type: 'PREFETCH_CHANNEL_BADGE_GRANTS'; channelLogin: string }
  | { type: 'REFRESH_CHANNEL_BADGE_GRANTS'; channelLogin: string }
  | { type: 'GET_CHANNEL_BADGE_GRANTS_FOR_LOGIN'; channelLogin: string; login: string }
  | { type: 'CAST_VOTE'; login: string; channelLogin: string; value: 1 | -1 }
  | { type: 'GET_CHANNEL_PERMISSIONS'; channelLogin: string }
  | { type: 'ADJUST_CHANNEL_RATING'; login: string; channelLogin: string; value: number; mode: 'delta' | 'set' }
  | { type: 'GET_CHANNEL_MODERATORS'; channelLogin: string }
  | { type: 'ADD_CHANNEL_MODERATOR'; channelLogin: string; targetLogin: string }
  | { type: 'REMOVE_CHANNEL_MODERATOR'; channelLogin: string; targetLogin: string }
  | { type: 'GET_ALIASES' }
  | { type: 'SET_ALIAS'; login: string; alias: string }
  | { type: 'DELETE_ALIAS'; login: string }
  | { type: 'EXPORT_ALIASES' }
  | { type: 'IMPORT_ALIASES'; data: Array<{ login: string; alias: string }> }
  | { type: 'SYNC_ALIASES' }
  | { type: 'REFRESH_ME' }
  | { type: 'FETCH_IMAGE'; url: string }
  | { type: 'OAUTH_CALLBACK'; access_token: string; refresh_token: string; login?: string; avatar_url?: string; expires_in?: string; extension_state?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeLogin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const login = value.trim().toLowerCase();
  return LOGIN_RE.test(login) ? login : null;
}

function normalizeAlias(value: unknown, allowEmpty: boolean): string | null {
  if (typeof value !== 'string') return null;
  const alias = value.trim();
  if (!allowEmpty && alias.length === 0) return null;
  return alias.length <= MAX_ALIAS_LENGTH ? alias : null;
}

function isTrustedSender(sender: browser.Runtime.MessageSender): boolean {
  if (sender.id && sender.id !== browser.runtime.id) return false;

  const url = sender.url ?? sender.tab?.url;
  if (!url) return true;

  const extensionBase = browser.runtime.getURL('');
  return (
    url.startsWith(extensionBase) ||
    url.startsWith('https://www.twitch.tv/') ||
    url.startsWith('https://dashboard.twitch.tv/')
  );
}

export function isOAuthCallbackSender(sender: browser.Runtime.MessageSender): boolean {
  if (sender.id && sender.id !== browser.runtime.id) return false;
  const url = sender.url ?? '';
  const callbackUrl = browser.runtime.getURL('callback.html');
  const callbackBase = callbackUrl.split('?')[0].split('#')[0];
  return url.split('?')[0].split('#')[0] === callbackBase;
}

export function parseMessage(
  message: unknown,
  sender: browser.Runtime.MessageSender,
  options: { allowOAuthCallback?: boolean } = {},
): Message | null {
  if (!isRecord(message) || typeof message.type !== 'string') return null;
  if (!isTrustedSender(sender)) return null;

  switch (message.type) {
    case 'GET_AUTH':
    case 'LOGIN':
    case 'LOGOUT':
    case 'GET_ALIASES':
    case 'EXPORT_ALIASES':
    case 'SYNC_ALIASES':
    case 'REFRESH_ME':
      return { type: message.type } as Message;

    case 'GET_USER_RATING':
    case 'GET_CHANNEL_PERMISSIONS':
    case 'GET_CHANNEL_MODERATORS': {
      const channelLogin = normalizeLogin(message.channelLogin);
      return channelLogin ? { type: message.type, channelLogin } as Message : null;
    }

    case 'FETCH_RATING': {
      const login = normalizeLogin(message.login);
      const channelLogin = normalizeLogin(message.channelLogin);
      return login && channelLogin ? { type: 'FETCH_RATING', login, channelLogin } : null;
    }

    case 'FETCH_BADGE_GRANTS': {
      const channelLogin = normalizeLogin(message.channelLogin);
      if (!channelLogin || !Array.isArray(message.logins) || message.logins.length > 100) return null;
      const logins: string[] = [];
      for (const raw of message.logins) {
        const login = normalizeLogin(raw);
        if (!login) return null;
        logins.push(login);
      }
      return { type: 'FETCH_BADGE_GRANTS', channelLogin, logins };
    }

    case 'PREFETCH_CHANNEL_BADGE_GRANTS': {
      const channelLogin = normalizeLogin(message.channelLogin);
      return channelLogin ? { type: 'PREFETCH_CHANNEL_BADGE_GRANTS', channelLogin } : null;
    }

    case 'REFRESH_CHANNEL_BADGE_GRANTS': {
      const channelLogin = normalizeLogin(message.channelLogin);
      return channelLogin ? { type: 'REFRESH_CHANNEL_BADGE_GRANTS', channelLogin } : null;
    }

    case 'GET_CHANNEL_BADGE_GRANTS_FOR_LOGIN': {
      const channelLogin = normalizeLogin(message.channelLogin);
      const login = normalizeLogin(message.login);
      return channelLogin && login ? { type: 'GET_CHANNEL_BADGE_GRANTS_FOR_LOGIN', channelLogin, login } : null;
    }

    case 'CAST_VOTE': {
      const login = normalizeLogin(message.login);
      const channelLogin = normalizeLogin(message.channelLogin);
      const value = message.value;
      return login && channelLogin && (value === 1 || value === -1)
        ? { type: 'CAST_VOTE', login, channelLogin, value }
        : null;
    }

    case 'ADJUST_CHANNEL_RATING': {
      const login = normalizeLogin(message.login);
      const channelLogin = normalizeLogin(message.channelLogin);
      const value = message.value;
      const mode = message.mode;
      return login &&
        channelLogin &&
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= -1000 &&
        value <= 1000 &&
        (mode === 'delta' || mode === 'set')
        ? { type: 'ADJUST_CHANNEL_RATING', login, channelLogin, value, mode }
        : null;
    }

    case 'ADD_CHANNEL_MODERATOR':
    case 'REMOVE_CHANNEL_MODERATOR': {
      const channelLogin = normalizeLogin(message.channelLogin);
      const targetLogin = normalizeLogin(message.targetLogin);
      return channelLogin && targetLogin
        ? { type: message.type, channelLogin, targetLogin } as Message
        : null;
    }

    case 'SET_ALIAS': {
      const login = normalizeLogin(message.login);
      const alias = normalizeAlias(message.alias, true);
      return login && alias !== null ? { type: 'SET_ALIAS', login, alias } : null;
    }

    case 'DELETE_ALIAS': {
      const login = normalizeLogin(message.login);
      return login ? { type: 'DELETE_ALIAS', login } : null;
    }

    case 'IMPORT_ALIASES': {
      if (!Array.isArray(message.data) || message.data.length > MAX_IMPORT_ALIASES) return null;
      const data: Array<{ login: string; alias: string }> = [];
      for (const item of message.data) {
        if (!isRecord(item)) return null;
        const login = normalizeLogin(item.login);
        const alias = normalizeAlias(item.alias, false);
        if (!login || alias === null) return null;
        data.push({ login, alias });
      }
      return { type: 'IMPORT_ALIASES', data };
    }

    case 'FETCH_IMAGE': {
      const url = message.url;
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
      return { type: 'FETCH_IMAGE', url };
    }

    case 'OAUTH_CALLBACK': {
      if (!options.allowOAuthCallback || !isOAuthCallbackSender(sender)) return null;
      if (typeof message.access_token !== 'string' || typeof message.refresh_token !== 'string') return null;
      return {
        type: 'OAUTH_CALLBACK',
        access_token: message.access_token,
        refresh_token: message.refresh_token,
        login: typeof message.login === 'string' ? message.login : undefined,
        avatar_url: typeof message.avatar_url === 'string' ? message.avatar_url : undefined,
        expires_in: typeof message.expires_in === 'string' ? message.expires_in : undefined,
        extension_state: typeof message.extension_state === 'string' ? message.extension_state : undefined,
      };
    }

    default:
      return null;
  }
}
