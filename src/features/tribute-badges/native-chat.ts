import type { Badge, ViewerConfig } from './types';
import { createBadgeImg, dedupeBadges, hideTooltip, normalizeLogin, showTooltip } from './dom';
import {
  beginBadgeRender,
  failBadgeRender,
  finishBadgeRender,
  isCurrentBadgeRender,
  shouldSkipBadgeRender,
} from './render-state';

export interface NativeChatContext {
  getCurrentChannel(): string | null;
  getCachedUser(login: string): ViewerConfig | undefined;
  resolveBadgesForLogin(channelName: string | null, login: string): Promise<Badge[]>;
}

export function processNativeMessage(messageElement: Element, context: NativeChatContext): void {
  const element = messageElement as HTMLElement;
  const usernameElement = element.querySelector<HTMLElement>('.chat-author__display-name, .message-author__display-name, .chatter-name');
  if (!usernameElement) return;

  if (element.dataset.tcbDone) {
    const existingLogin = element.dataset.tcbUserLogin || usernameElement.dataset.tcbUser;
    if (existingLogin && shouldSkipBadgeRender(element, existingLogin)) return;
  }

  const username = normalizeLogin(usernameElement.getAttribute('data-a-user') || usernameElement.parentElement?.getAttribute('data-a-user') || usernameElement.textContent);
  if (!username) return;

  if (shouldSkipBadgeRender(element, username)) return;

  const renderToken = beginBadgeRender(element, username);
  usernameElement.dataset.tcbUser = username;

  if (!usernameElement.dataset.tcbTooltip) {
    usernameElement.dataset.tcbTooltip = '1';
    usernameElement.addEventListener('mouseenter', (event) => showTooltip(event, context.getCachedUser(username)?.name_preset_name));
    usernameElement.addEventListener('mouseleave', hideTooltip);
  }

  void (async () => {
    try {
      const badges = await context.resolveBadgesForLogin(context.getCurrentChannel(), username);

      // Fallback to current live message for same login if original element was recycled.
      let targetElement: HTMLElement = element;
      if (!isCurrentBadgeRender(element, username, renderToken) || !element.isConnected) {
        const candidates = document.querySelectorAll<HTMLElement>('.chat-line__message');
        for (const cand of Array.from(candidates)) {
          const nameEl = cand.querySelector<HTMLElement>('.chat-author__display-name, .message-author__display-name, .chatter-name');
          const candLogin = normalizeLogin(nameEl?.getAttribute('data-a-user') || nameEl?.textContent || '');
          if (candLogin === username && cand.isConnected) {
            targetElement = cand;
            break;
          }
        }
      }
      if (!targetElement.isConnected) {
        failBadgeRender(element, username, renderToken);
        return;
      }

      const currentUsernameElement = targetElement.querySelector<HTMLElement>('.chat-author__display-name, .message-author__display-name, .chatter-name');
      if (!currentUsernameElement) {
        failBadgeRender(element, username, renderToken);
        return;
      }

      currentUsernameElement.dataset.tcbUser = username;

      const uniqueBadges = dedupeBadges(badges);
      const currentBadgesContainer = targetElement.querySelector<HTMLElement>('.chat-line__message--badges');
      targetElement.querySelectorAll('.tcb-badge-list').forEach((badge) => badge.remove());
      currentBadgesContainer?.querySelectorAll('.tcb-badge-img').forEach((badge) => badge.remove());

      if (uniqueBadges.length === 0) {
        finishBadgeRender(targetElement, username, false);
        return;
      }

      if (currentBadgesContainer) {
        uniqueBadges.forEach((badge) => {
          const img = createBadgeImg(badge);
          if (img) currentBadgesContainer.appendChild(img);
        });
        finishBadgeRender(targetElement, username, currentBadgesContainer.querySelector('.tcb-badge-img') != null);
        return;
      }

      const wrapper = document.createElement('span');
      wrapper.className = 'tcb-badge-list';
      uniqueBadges.forEach((badge) => {
        const img = createBadgeImg(badge);
        if (img) wrapper.appendChild(img);
      });
      if (wrapper.children.length > 0) {
        (currentUsernameElement.closest('.chat-line__username') || currentUsernameElement).insertAdjacentElement('beforebegin', wrapper);
      }
      finishBadgeRender(targetElement, username, wrapper.children.length > 0);
    } catch {
      failBadgeRender(element, username, renderToken);
    }
  })();
}
