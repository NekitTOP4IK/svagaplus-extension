import { RatingData } from './types';

export interface DetectedCard {
  /** `modview` — панель «Сообщество» режима модератора: только алиасы, без рейтинга и баджей. */
  type: 'twitch' | 'seventv' | 'modview';
  login: string;
  element: Element;
}

const SEVENTV_CARD_SELECTOR = '.seventv-user-card, .seventv-usercard';
export const MODVIEW_CARD_SELECTOR = '[data-a-target="mod-view-user-details"]';
const SEVENTV_USERTAG_SELECTOR = [
  'a.seventv-user-card-usertag[href]',
  'a.seventv-usercard-usertag[href]',
  'a[href*="twitch.tv/"]',
].join(', ');

function extractSevenTVLogin(cardEl: Element): string | null {
  const link = cardEl.querySelector(SEVENTV_USERTAG_SELECTOR);
  if (!link) return null;
  const href = link.getAttribute('href') ?? '';
  const m = href.match(/twitch\.tv\/([a-z0-9_]+)/i);
  return m ? m[1].toLowerCase() : null;
}

function extractTwitchLogin(cardEl: Element): string | null {
  // Twitch renders a <p data-a-target="user-card-login-name"> inside .viewer-card-layer
  const loginEl = cardEl.querySelector('[data-a-target="user-card-login-name"]');
  if (loginEl?.textContent) return loginEl.textContent.trim().toLowerCase();

  // Fallback: find profile href like /username (single path segment, no sub-paths)
  const links = cardEl.querySelectorAll<HTMLAnchorElement>('a[href]');
  for (const a of links) {
    const m = a.getAttribute('href')?.match(/^\/([a-z0-9_]+)$/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

function extractModViewLogin(cardEl: Element): string | null {
  const href = cardEl.querySelector('.viewer-card-header__display-name a[href]')?.getAttribute('href') ?? '';
  const m = href.match(/^\/([a-z0-9_]+)\/?$/i);
  return m ? m[1].toLowerCase() : null;
}

function findTwitchLayer(element: Element): Element | null {
  // Match any element whose class includes 'viewer-card-layer' (handles BEM variants like
  // viewer-card-layer__draggable, viewer-card-layer-wrapper, etc.)
  const hasLayerClass = (el: Element) =>
    Array.from(el.classList).some((c) => c.startsWith('viewer-card-layer'));

  if (hasLayerClass(element)) return element;
  return element.querySelector('[class*="viewer-card-layer"]');
}

export function detectCardLogin(element: Element): DetectedCard | null {
  // 7TV card: element itself OR a descendant
  const seventvCard =
    element.closest(SEVENTV_CARD_SELECTOR) ??
    element.querySelector(SEVENTV_CARD_SELECTOR);
  if (seventvCard) {
    const login = extractSevenTVLogin(seventvCard);
    if (login) return { type: 'seventv', login, element: seventvCard };
  }

  const modViewCard =
    element.closest(MODVIEW_CARD_SELECTOR) ??
    element.querySelector(MODVIEW_CARD_SELECTOR);
  if (modViewCard) {
    const login = extractModViewLogin(modViewCard);
    if (login) return { type: 'modview', login, element: modViewCard };
  }

  // Native Twitch: any viewer-card-layer variant must have children (card is rendered)
  const twitchLayer = findTwitchLayer(element);
  if (twitchLayer && twitchLayer.children.length > 0) {
    const login = extractTwitchLogin(twitchLayer);
    if (login) return { type: 'twitch', login, element: twitchLayer };
  }

  return null;
}

export type { RatingData };
