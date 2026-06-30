import { createBadgeImg, dedupeBadges, normalizeLogin } from './dom';
import type { Badge, ViewerConfig } from './types';

export interface UserCardContext {
  getCurrentChannel(): string | null;
  getCachedUser(login: string): ViewerConfig | undefined;
  resolveBadgesForLogin(channelName: string | null, login: string): Promise<Badge[]>;
}

function extractLoginFromHref(value: string | null | undefined): string {
  if (!value) return '';
  const match = value.match(/\/([a-z0-9_]{3,25})(?:[/?#]|$)/i);
  return normalizeLogin(match?.[1]) || '';
}

function resolveCardLogin(cardEl: HTMLElement, targetNameEl: HTMLElement | null, rawText: string): string {
  const direct =
    normalizeLogin(targetNameEl?.getAttribute('data-a-user')) ||
    normalizeLogin(targetNameEl?.parentElement?.getAttribute('data-a-user')) ||
    normalizeLogin(cardEl.getAttribute('data-a-user'));
  if (direct) return direct;

  const linked =
    extractLoginFromHref(targetNameEl?.closest('a')?.getAttribute('href')) ||
    extractLoginFromHref(cardEl.querySelector('a[href^="/"]')?.getAttribute('href'));
  if (linked) return linked;

  const intlMatch = rawText.match(/\((\w+)\)\s*$/);
  return normalizeLogin(intlMatch ? intlMatch[1] : rawText);
}

export function processUserCard(card: Element, context: UserCardContext): void {
  const cardEl = card as HTMLElement;
  if (cardEl.dataset.tcbDone) return;

  const specificNameEl = cardEl.querySelector<HTMLElement>('.seventv-chat-user-username, .seventv-user-card-username, .tw-title, [data-a-target="user-card-header-username"], .viewer-card-header__display-name');
  const fallbackNameEl = Array.from(cardEl.querySelectorAll<HTMLElement>('span, h4, h2, h3, div')).find((el) => /^[a-zA-Z0-9_]{3,25}$/.test(el.textContent?.trim() || ''));
  const targetNameEl = specificNameEl || fallbackNameEl || null;
  const rawText = targetNameEl?.textContent?.trim() || cardEl.textContent?.match(/([a-zA-Z0-9_]{3,25})/)?.[1] || '';
  if (!rawText) return;

  const username = resolveCardLogin(cardEl, targetNameEl, rawText);
  if (!username) return;
  cardEl.dataset.tcbDone = '1';
  const renderToken = String((Number(cardEl.dataset.tcbRenderToken || '0') || 0) + 1);
  cardEl.dataset.tcbRenderToken = renderToken;

  void context.resolveBadgesForLogin(context.getCurrentChannel(), username).then((badges) => {
    if (cardEl.dataset.tcbRenderToken !== renderToken) return;
    const uniqueBadges = dedupeBadges(badges);
    if (uniqueBadges.length === 0) return;
    const sevTVBadgeContainer = cardEl.querySelector<HTMLElement>('.seventv-user-card-badges');
    const badgeContainer = sevTVBadgeContainer || targetNameEl?.parentElement;
    if (!badgeContainer) return;
    badgeContainer.querySelectorAll('.tcb-badge-list').forEach((badge) => badge.remove());
    const wrapper = document.createElement('span');
    wrapper.className = 'tcb-badge-list tcb-badge-list--usercard';
    uniqueBadges.forEach((badge) => {
      const img = createBadgeImg(badge);
      if (img) wrapper.appendChild(img);
    });
    if (wrapper.children.length > 0) {
      if (sevTVBadgeContainer) sevTVBadgeContainer.appendChild(wrapper);
      else targetNameEl?.insertAdjacentElement('beforebegin', wrapper);
    }
  });

  const config = context.getCachedUser(username);
  if (targetNameEl && config?.name_gradient) {
    targetNameEl.style.setProperty('background', config.name_gradient, 'important');
    targetNameEl.style.setProperty('-webkit-background-clip', 'text', 'important');
    targetNameEl.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
    targetNameEl.style.setProperty('color', 'transparent', 'important');
  } else if (targetNameEl && config?.name_color) {
    targetNameEl.style.setProperty('color', config.name_color, 'important');
  }
}
