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

/** Path segments with a leading `popout/` dropped: pop-out pages nest the same routes. */
function pathParts(pathname: string): string[] {
  const parts = pathname.split('/').filter(Boolean).map((part) => part.toLowerCase());
  return parts[0] === 'popout' ? parts.slice(1) : parts;
}

/** Stream manager and its pop-outs: dashboard.twitch.tv/u/<login>/... */
function dashboardChannel(pathname: string): string | null {
  const parts = pathParts(pathname);
  return parts[0] === 'u' ? normalizeLogin(parts[1]) : null;
}

function siteChannel(pathname: string): string | null {
  const parts = pathParts(pathname);
  if (parts[0] === 'moderator') return normalizeLogin(parts[1]);
  const direct = normalizeLogin(parts[0]);
  return direct && !RESERVED_PATHS.has(direct) ? direct : null;
}

export function getChannelLoginFromUrl(url: string = globalThis.location?.href ?? ''): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'dashboard.twitch.tv') return dashboardChannel(parsed.pathname);
    if (parsed.hostname !== 'twitch.tv' && !parsed.hostname.endsWith('.twitch.tv')) return null;
    return siteChannel(parsed.pathname);
  } catch {
    return null;
  }
}

export function getCurrentChannelLogin(): string | null {
  return getChannelLoginFromUrl();
}

export { normalizeLogin as normalizeTwitchLogin };
