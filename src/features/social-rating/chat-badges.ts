import { ActiveBadgeGrant } from './types';
import { getChannelGrantsForLogin } from './api';

const DONE_ATTR = 'data-tsr-chat-badges-done';
const USER_ATTR = 'data-tsr-chat-badge-user';
const BADGE_CLASS = 'tsr-chat-badge-img';
const LIST_CLASS = 'tsr-chat-badge-list';
const LIST_7TV_CLASS = 'tsr-chat-badge-list-7tv';
const TOOLTIP_ID = 'tsr-chat-badge-tooltip';
const LOGIN_RE = /^[a-z0-9_]{3,25}$/;
let delegatedTooltipEvents = false;

function ensureStyle(): void {
  if (document.getElementById('tsr-chat-badge-style')) return;
  const style = document.createElement('style');
  style.id = 'tsr-chat-badge-style';
  style.textContent = `
    .${BADGE_CLASS} {
      width: 18px !important;
      height: 18px !important;
      min-width: 18px !important;
      min-height: 18px !important;
      max-width: 18px !important;
      max-height: 18px !important;
      object-fit: contain !important;
      vertical-align: middle !important;
      display: inline-block !important;
      margin-right: 3px !important;
      border-radius: 2px !important;
    }
    .chat-line__message--badges .${BADGE_CLASS}:last-child {
      margin-right: 4px !important;
    }
    .${LIST_CLASS}, .${LIST_7TV_CLASS} {
      display: inline-flex !important;
      align-items: center !important;
      gap: 3px !important;
      margin-right: 4px !important;
      vertical-align: middle !important;
    }
    .seventv-chat-user-badge-list .${BADGE_CLASS} {
      margin-right: 0 !important;
      margin-left: 0 !important;
    }
    #${TOOLTIP_ID} {
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
      background: #18181b;
      color: #efeff1;
      border: 1px solid #3a3a3d;
      border-radius: 4px;
      padding: 6px 8px;
      font: 600 12px/1.35 system-ui, -apple-system, Segoe UI, sans-serif;
      box-shadow: 0 8px 24px rgba(0,0,0,.35);
      opacity: 0;
      transform: translate(-50%, -100%);
      transition: opacity .08s ease;
      white-space: nowrap;
    }
  `;
  document.head.appendChild(style);
}

function ensureDelegatedTooltipEvents(): void {
  if (delegatedTooltipEvents) return;
  delegatedTooltipEvents = true;

  document.addEventListener('mouseover', (ev) => {
    const target = ev.target instanceof Element ? ev.target.closest<HTMLElement>(`.${BADGE_CLASS}`) : null;
    if (!target) return;
    showTooltip(target, target.dataset.tsrBadgeTitle ?? target.getAttribute('alt') ?? '');
  });
  document.addEventListener('mouseout', (ev) => {
    if (ev.target instanceof Element && ev.target.closest(`.${BADGE_CLASS}`)) hideTooltip();
  });
  document.addEventListener('wheel', (ev) => {
    if (ev.target instanceof Element && ev.target.closest(`.${BADGE_CLASS}`)) hideTooltip();
  }, { passive: true });
}

function ensureReady(): void {
  ensureStyle();
  ensureDelegatedTooltipEvents();
}

function normalizeLogin(value: string | null | undefined): string | null {
  const login = (value ?? '').trim().replace(/^@/, '').toLowerCase();
  return LOGIN_RE.test(login) ? login : null;
}

function showTooltip(anchor: HTMLElement, text: string): void {
  if (!text) return;
  let tooltip = document.getElementById(TOOLTIP_ID);
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = TOOLTIP_ID;
    document.body.appendChild(tooltip);
  }
  tooltip.textContent = text;
  const rect = anchor.getBoundingClientRect();
  // Center above the badge; transform: translate(-50%, -100%) handles the offset
  tooltip.style.left = `${rect.left + rect.width / 2}px`;
  tooltip.style.top = `${rect.top - 6}px`;
  tooltip.style.opacity = '1';
}

function hideTooltip(): void {
  const tooltip = document.getElementById(TOOLTIP_ID);
  if (tooltip) tooltip.style.opacity = '0';
}

function createBadgeImg(grant: ActiveBadgeGrant): HTMLImageElement | null {
  if (!grant.image_url) return null;
  const img = document.createElement('img');
  img.src = grant.image_url;
  img.alt = grant.title;
  img.className = BADGE_CLASS;
  img.dataset.tsrBadgeKind = grant.kind;
  img.dataset.tsrBadgeRank = String(grant.rank);
  img.dataset.tsrBadgeTitle = grant.title;
  img.onerror = () => { img.style.display = 'none'; };
  return img;
}

async function grantsFor(channelLogin: string, login: string): Promise<ActiveBadgeGrant[]> {
  return getChannelGrantsForLogin(channelLogin, login);
}

function renderBadges(container: Element, grants: ActiveBadgeGrant[], as7tv = false): void {
  container.querySelectorAll(`.${BADGE_CLASS}`).forEach((el) => el.remove());
  const images = grants.map(createBadgeImg).filter((img): img is HTMLImageElement => img !== null);
  if (images.length === 0) return;
  for (const img of images) {
    if (as7tv) img.classList.add('seventv-chat-badge');
    container.appendChild(img);
  }
}

export async function processNativeChatBadges(messageElement: Element, channelLogin: string): Promise<void> {
  ensureReady();
  const usernameElement = messageElement.querySelector<HTMLElement>('.chat-author__display-name, .message-author__display-name, .chatter-name');
  if (!usernameElement) return;

  const login = normalizeLogin(
    messageElement.getAttribute('data-a-user') ||
    usernameElement.getAttribute('data-a-user') ||
    usernameElement.parentElement?.getAttribute('data-a-user') ||
    usernameElement.textContent,
  );
  if (!login) return;

  if (messageElement.getAttribute(DONE_ATTR) === login) return;
  messageElement.setAttribute(DONE_ATTR, login);
  usernameElement.setAttribute(USER_ATTR, login);

  const grants = await grantsFor(channelLogin, login);
  const badgesContainer = messageElement.querySelector('.chat-line__message--badges');
  if (badgesContainer) {
    renderBadges(badgesContainer, grants);
    return;
  }

  messageElement.querySelectorAll(`.${LIST_CLASS}`).forEach((el) => el.remove());
  if (grants.length === 0) return;
  const wrapper = document.createElement('span');
  wrapper.className = LIST_CLASS;
  renderBadges(wrapper, grants);
  const insertTarget = usernameElement.closest('.chat-line__username') || usernameElement;
  insertTarget.insertAdjacentElement('beforebegin', wrapper);
}

export async function processSevenTVChatBadges(messageElement: Element, channelLogin: string): Promise<void> {
  ensureReady();
  const userBlock = messageElement.querySelector<HTMLElement>('.seventv-chat-user');
  if (!userBlock) return;
  const usernameElement = messageElement.querySelector<HTMLElement>('.seventv-chat-user-username');
  if (!usernameElement) return;

  const rawText = (usernameElement.textContent || '').replace(/^@/, '').trim();
  const intlMatch = rawText.match(/\(([a-z0-9_]+)\)\s*$/i);
  const login = normalizeLogin(intlMatch ? intlMatch[1] : rawText);
  if (!login) return;

  if (messageElement.getAttribute(DONE_ATTR) === login) return;
  messageElement.setAttribute(DONE_ATTR, login);
  userBlock.setAttribute(USER_ATTR, login);

  const grants = await grantsFor(channelLogin, login);
  userBlock.querySelectorAll(`.${BADGE_CLASS}, .${LIST_7TV_CLASS}`).forEach((el) => el.remove());
  if (grants.length === 0) return;

  let badgeList = userBlock.querySelector('.seventv-chat-user-badge-list');
  if (!badgeList) {
    badgeList = document.createElement('span');
    badgeList.className = LIST_7TV_CLASS;
    usernameElement.insertAdjacentElement('beforebegin', badgeList);
  }
  renderBadges(badgeList, grants, true);
}

export async function processUserCardAwardBadges(cardElement: Element, login: string, channelLogin: string): Promise<void> {
  ensureReady();
  const normalizedLogin = normalizeLogin(login);
  if (!normalizedLogin) return;
  const grants = await grantsFor(channelLogin, normalizedLogin);

  cardElement.querySelectorAll(`.${LIST_CLASS}--usercard`).forEach((el) => el.remove());
  if (grants.length === 0) return;

  const wrapper = document.createElement('span');
  wrapper.className = `${LIST_CLASS} ${LIST_CLASS}--usercard`;
  renderBadges(wrapper, grants);

  const seventvBadges = cardElement.querySelector('.seventv-user-card-badges');
  if (seventvBadges) {
    seventvBadges.appendChild(wrapper);
    return;
  }

  const target =
    cardElement.querySelector('.seventv-chat-user-username, .seventv-user-card-username, [data-a-target="user-card-header-username"], .viewer-card-header__display-name') ??
    cardElement.querySelector('a[href]');
  target?.insertAdjacentElement('beforebegin', wrapper);
}

export async function refreshVisibleChatBadges(channelLogin: string): Promise<void> {
  ensureReady();
  const nativeMessages = Array.from(document.querySelectorAll('.chat-line__message'));
  const sevenTvMessages = Array.from(document.querySelectorAll('.seventv-user-message'));

  for (const message of nativeMessages) {
    message.removeAttribute(DONE_ATTR);
    await processNativeChatBadges(message, channelLogin);
  }

  for (const message of sevenTvMessages) {
    message.removeAttribute(DONE_ATTR);
    await processSevenTVChatBadges(message, channelLogin);
  }
}
