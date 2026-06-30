import { createBadgeImg, dedupeBadges, hideTooltip, normalizeLogin, showTooltip } from './dom';
import type { Badge, ViewerConfig } from './types';

export interface SevenTVChatContext {
  getCurrentChannel(): string | null;
  getCachedUser(login: string): ViewerConfig | undefined;
  resolveBadgesForLogin(channelName: string | null, login: string): Promise<Badge[]>;
}

export function processSevenTVMessage(messageElement: Element, context: SevenTVChatContext): void {
  const element = messageElement as HTMLElement;
  if (element.dataset.tcbDone) return;
  const userBlock = element.querySelector<HTMLElement>('.seventv-chat-user');
  const usernameEl = element.querySelector<HTMLElement>('.seventv-chat-user-username');
  if (!userBlock || !usernameEl) return;

  const rawText = (usernameEl.textContent || '').replace(/^@/, '').trim();
  const intlMatch = rawText.match(/\((\w+)\)\s*$/);
  const username = normalizeLogin(intlMatch ? intlMatch[1] : rawText);
  if (!username) return;

  element.dataset.tcbDone = '1';
  userBlock.dataset.tcbUser = username;
  userBlock.querySelectorAll('.tcb-badge-img, .tcb-badge-list-stv').forEach((badge) => badge.remove());
  const renderToken = String((Number(element.dataset.tcbRenderToken || '0') || 0) + 1);
  element.dataset.tcbRenderToken = renderToken;

  if (!usernameEl.dataset.tcbTooltip) {
    usernameEl.dataset.tcbTooltip = '1';
    usernameEl.addEventListener('mouseenter', (event) => showTooltip(event, context.getCachedUser(username)?.name_preset_name));
    usernameEl.addEventListener('mouseleave', hideTooltip);
  }

  void context.resolveBadgesForLogin(context.getCurrentChannel(), username).then((badges) => {
    if (element.dataset.tcbRenderToken !== renderToken) return;
    const uniqueBadges = dedupeBadges(badges);
    if (uniqueBadges.length === 0) return;
    let badgeList = userBlock.querySelector<HTMLElement>('.seventv-chat-user-badge-list');
    if (!badgeList) {
      badgeList = document.createElement('span');
      badgeList.className = 'tcb-badge-list-stv';
      usernameEl.insertAdjacentElement('beforebegin', badgeList);
    }
    badgeList.querySelectorAll('.tcb-badge-img').forEach((badge) => badge.remove());
    uniqueBadges.forEach((badge) => {
      const img = createBadgeImg(badge);
      if (img) {
        img.classList.add('seventv-chat-badge');
        badgeList.appendChild(img);
      }
    });
  });
}
