export function extractCurrentChannel(hostname: string, pathname: string): string {
  if (hostname === 'dashboard.twitch.tv') {
    const m = pathname.match(/\/(?:popout\/)?u\/([a-z0-9_]+)/i);
    return m ? m[1].toLowerCase() : '';
  }

  const modMatch = pathname.match(/^\/(?:popout\/)?moderator\/([a-z0-9_]+)/i);
  if (modMatch) return modMatch[1].toLowerCase();

  const popoutMatch = pathname.match(/^\/popout\/([a-z0-9_]+)/i);
  if (popoutMatch) return popoutMatch[1].toLowerCase();

  const m = pathname.match(/^\/([a-z0-9_]+)/i);
  if (!m) return '';

  const firstSegment = m[1].toLowerCase();
  if (firstSegment === 'videos') return '';
  return firstSegment;
}
