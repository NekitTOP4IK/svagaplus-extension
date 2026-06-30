import type { Badge, ViewerConfig } from './types';
import { createBadgeImg, dedupeBadges, hideTooltip, normalizeLogin, showTooltip } from './dom';

export interface NativeChatContext {
  getCurrentChannel(): string | null;
  getCachedUser(login: string): ViewerConfig | undefined;
  resolveBadgesForLogin(channelName: string | null, login: string): Promise<Badge[]>;
}

export function processNativeMessage(messageElement: Element, context: NativeChatContext): void {
  const element = messageElement as HTMLElement;
  if (element.dataset.tcbDone) return;
  const usernameElement = element.querySelector<HTMLElement>('.chat-author__display-name');
  if (!usernameElement) return;

  const username = normalizeLogin(usernameElement.getAttribute('data-a-user') || usernameElement.parentElement?.getAttribute('data-a-user') || usernameElement.textContent);
  if (!username) return;

  element.dataset.tcbDone = '1';
  usernameElement.dataset.tcbUser = username;
  if (usernameElement.parentElement?.classList.contains('seventv-painted-content')) usernameElement.dataset.tcbPaint = '1';
  else delete usernameElement.dataset.tcbPaint;

  const badgesContainer = element.querySelector<HTMLElement>('.chat-line__message--badges');
  element.querySelectorAll('.tcb-badge-list').forEach((badge) => badge.remove());
  badgesContainer?.querySelectorAll('.tcb-badge-img').forEach((badge) => badge.remove());
  const renderToken = String((Number(element.dataset.tcbRenderToken || '0') || 0) + 1);
  element.dataset.tcbRenderToken = renderToken;

  if (!usernameElement.dataset.tcbTooltip) {
    usernameElement.dataset.tcbTooltip = '1';
    usernameElement.addEventListener('mouseenter', (event) => showTooltip(event, context.getCachedUser(username)?.name_preset_name));
    usernameElement.addEventListener('mouseleave', hideTooltip);
  }

  void context.resolveBadgesForLogin(context.getCurrentChannel(), username).then((badges) => {
    if (element.dataset.tcbRenderToken !== renderToken) return;
    const uniqueBadges = dedupeBadges(badges);
    if (uniqueBadges.length === 0) return;
    if (badgesContainer) {
      badgesContainer.querySelectorAll('.tcb-badge-img').forEach((badge) => badge.remove());
      uniqueBadges.forEach((badge) => {
        const img = createBadgeImg(badge);
        if (img) badgesContainer.appendChild(img);
      });
      return;
    }
    element.querySelectorAll('.tcb-badge-list').forEach((badge) => badge.remove());
    const wrapper = document.createElement('span');
    wrapper.className = 'tcb-badge-list';
    uniqueBadges.forEach((badge) => {
      const img = createBadgeImg(badge);
      if (img) wrapper.appendChild(img);
    });
    if (wrapper.children.length > 0) {
      (usernameElement.closest('.chat-line__username') || usernameElement).insertAdjacentElement('beforebegin', wrapper);
    }
  });
}
