const LOGIN_RE = /^[a-z0-9_]{3,25}$/;
const RESERVED_PATHS = new Set([
  '',
  'directory',
  'downloads',
  'inventory',
  'login',
  'messages',
  'p',
  'payments',
  'search',
  'settings',
  'signup',
  'subscriptions',
  'turbo',
  'videos',
  'wallet',
]);

function normalizeLogin(value: string | null | undefined): string | null {
  if (!value) return null;
  const login = value.trim().toLowerCase();
  return LOGIN_RE.test(login) ? login : null;
}

function firstPathSegment(pathname: string): string | null {
  const segment = pathname.split('/').filter(Boolean)[0] ?? '';
  return normalizeLogin(segment);
}

function dashboardChannel(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'popout') return normalizeLogin(parts[1]);
  return null;
}

export function getChannelLoginFromUrl(url: string = globalThis.location?.href ?? ''): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'dashboard.twitch.tv') return dashboardChannel(parsed.pathname);
    if (!parsed.hostname.endsWith('twitch.tv')) return null;
    const direct = firstPathSegment(parsed.pathname);
    return direct && !RESERVED_PATHS.has(direct) ? direct : null;
  } catch {
    return null;
  }
}

export function getCurrentChannelLogin(): string | null {
  return getChannelLoginFromUrl();
}

export { normalizeLogin as normalizeTwitchLogin };
