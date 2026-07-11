import { createBadgeImg, dedupeBadges, normalizeLogin } from './dom';
import type { Badge, ViewerConfig } from './types';
import {
  beginBadgeRender,
  failBadgeRender,
  finishBadgeRender,
  isCurrentBadgeRender,
  shouldSkipBadgeRender,
} from './render-state';

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

const USERCARD_NAME_SELECTOR = '.seventv-chat-user-username, .seventv-user-card-username, .tw-title, [data-a-target="user-card-header-username"], .viewer-card-header__display-name';

function findCardNameEl(cardEl: HTMLElement): HTMLElement | null {
  const specific = cardEl.querySelector<HTMLElement>(USERCARD_NAME_SELECTOR);
  if (specific) return specific;
  return Array.from(cardEl.querySelectorAll<HTMLElement>('span, h4, h2, h3, div')).find((el) => /^[a-zA-Z0-9_]{3,25}$/.test(el.textContent?.trim() || '')) ?? null;
}

export function processUserCard(card: Element, context: UserCardContext): void {
  const cardEl = card as HTMLElement;

  const targetNameEl = findCardNameEl(cardEl);
  const rawText = targetNameEl?.textContent?.trim() || cardEl.textContent?.match(/([a-zA-Z0-9_]{3,25})/)?.[1] || '';
  if (!rawText) return;

  const username = resolveCardLogin(cardEl, targetNameEl, rawText);
  if (!username) return;

  if (shouldSkipBadgeRender(cardEl, username)) return;

  const renderToken = beginBadgeRender(cardEl, username);

  void (async () => {
    try {
      const badges = await context.resolveBadgesForLogin(context.getCurrentChannel(), username);
      if (!isCurrentBadgeRender(cardEl, username, renderToken)) return;
      if (!cardEl.isConnected) {
        failBadgeRender(cardEl, username, renderToken);
        return;
      }

      const currentTargetNameEl = findCardNameEl(cardEl);
      if (!currentTargetNameEl) {
        failBadgeRender(cardEl, username, renderToken);
        return;
      }

      const uniqueBadges = dedupeBadges(badges);
      const sevTVBadgeContainer = cardEl.querySelector<HTMLElement>('.seventv-user-card-badges');
      const badgeContainer = sevTVBadgeContainer || currentTargetNameEl.parentElement;
      if (!badgeContainer) {
        failBadgeRender(cardEl, username, renderToken);
        return;
      }
      badgeContainer.querySelectorAll('.tcb-badge-list').forEach((badge) => badge.remove());

      if (uniqueBadges.length === 0) {
        finishBadgeRender(cardEl, username, false);
        return;
      }

      const wrapper = document.createElement('span');
      wrapper.className = 'tcb-badge-list tcb-badge-list--usercard';
      uniqueBadges.forEach((badge) => {
        const img = createBadgeImg(badge);
        if (img) wrapper.appendChild(img);
      });
      if (wrapper.children.length > 0) {
        if (sevTVBadgeContainer) sevTVBadgeContainer.appendChild(wrapper);
        else currentTargetNameEl.insertAdjacentElement('beforebegin', wrapper);
      }
      finishBadgeRender(cardEl, username, wrapper.children.length > 0);
    } catch {
      failBadgeRender(cardEl, username, renderToken);
    }
  })();

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
