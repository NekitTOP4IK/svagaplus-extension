import { createBadgeImg, dedupeBadges, hideTooltip, normalizeLogin, showTooltip } from './dom';
import type { Badge, ViewerConfig } from './types';
import {
  beginBadgeRender,
  failBadgeRender,
  finishBadgeRender,
  isCurrentBadgeRender,
  shouldSkipBadgeRender,
} from './render-state';

export interface SevenTVChatContext {
  getCurrentChannel(): string | null;
  getCachedUser(login: string): ViewerConfig | undefined;
  resolveBadgesForLogin(channelName: string | null, login: string): Promise<Badge[]>;
}

export function processSevenTVMessage(messageElement: Element, context: SevenTVChatContext): void {
  const element = messageElement as HTMLElement;
  const userBlock = element.querySelector<HTMLElement>('.seventv-chat-user');
  const usernameEl = element.querySelector<HTMLElement>('.seventv-chat-user-username');
  if (!userBlock || !usernameEl) return;

  if (element.dataset.tcbDone) {
    const existingLogin = element.dataset.tcbUserLogin || userBlock.dataset.tcbUser;
    if (existingLogin && shouldSkipBadgeRender(element, existingLogin)) return;
  }

  const rawText = (usernameEl.textContent || '').replace(/^@/, '').trim();
  const intlMatch = rawText.match(/\((\w+)\)\s*$/);
  const username = normalizeLogin(intlMatch ? intlMatch[1] : rawText);
  if (!username) return;

  if (shouldSkipBadgeRender(element, username)) return;

  const renderToken = beginBadgeRender(element, username);
  userBlock.dataset.tcbUser = username;

  if (!usernameEl.dataset.tcbTooltip) {
    usernameEl.dataset.tcbTooltip = '1';
    usernameEl.addEventListener('mouseenter', (event) => showTooltip(event, context.getCachedUser(username)?.name_preset_name));
    usernameEl.addEventListener('mouseleave', hideTooltip);
  }

  void (async () => {
    try {
      const badges = await context.resolveBadgesForLogin(context.getCurrentChannel(), username);

      // Fallback to current live message for same login if original element was recycled.
      let targetElement: HTMLElement = element;
      if (!isCurrentBadgeRender(element, username, renderToken) || !element.isConnected) {
        const candidates = document.querySelectorAll<HTMLElement>('.seventv-user-message, .seventv-message');
        for (const cand of Array.from(candidates)) {
          const nameEl = cand.querySelector<HTMLElement>('.seventv-chat-user-username');
          const raw = (nameEl?.textContent || '').replace(/^@/, '').trim();
          const intlMatch = raw.match(/\((\w+)\)\s*$/);
          const candLogin = normalizeLogin(intlMatch ? intlMatch[1] : raw);
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

      const currentUserBlock = targetElement.querySelector<HTMLElement>('.seventv-chat-user');
      const currentUsernameEl = targetElement.querySelector<HTMLElement>('.seventv-chat-user-username');
      if (!currentUserBlock || !currentUsernameEl) {
        failBadgeRender(element, username, renderToken);
        return;
      }

      currentUserBlock.dataset.tcbUser = username;

      const uniqueBadges = dedupeBadges(badges);
      currentUserBlock.querySelectorAll('.tcb-badge-img, .tcb-badge-list-stv').forEach((badge) => badge.remove());

      if (uniqueBadges.length === 0) {
        finishBadgeRender(targetElement, username, false);
        return;
      }

      let badgeList = currentUserBlock.querySelector<HTMLElement>('.seventv-chat-user-badge-list');
      if (!badgeList) {
        badgeList = document.createElement('span');
        badgeList.className = 'tcb-badge-list-stv';
        currentUsernameEl.insertAdjacentElement('beforebegin', badgeList);
      }
      badgeList.querySelectorAll('.tcb-badge-img').forEach((badge) => badge.remove());
      uniqueBadges.forEach((badge) => {
        const img = createBadgeImg(badge);
        if (img) {
          img.classList.add('seventv-chat-badge');
          badgeList.appendChild(img);
        }
      });
      finishBadgeRender(targetElement, username, badgeList.querySelector('.tcb-badge-img') != null);
    } catch {
      failBadgeRender(element, username, renderToken);
    }
  })();
}
