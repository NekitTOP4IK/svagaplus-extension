import { applyViewerNameStyle, createBadgeImg, dedupeBadges, normalizeLogin } from './dom';
import type { Badge, ViewerConfig } from './types';
import {
  beginBadgeRender,
  clearBadgeRenderState,
  failBadgeRender,
  finishBadgeRender,
  getBadgeRenderState,
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
  // data-tsr-login ставит инжектор алиасов: после переименования текст имени
  // уже не логин, поэтому он идёт раньше текста.
  const direct =
    normalizeLogin(targetNameEl?.getAttribute('data-a-user')) ||
    normalizeLogin(targetNameEl?.parentElement?.getAttribute('data-a-user')) ||
    normalizeLogin(cardEl.getAttribute('data-a-user')) ||
    normalizeLogin(targetNameEl?.querySelector('[data-tsr-login]')?.getAttribute('data-tsr-login')) ||
    normalizeLogin(targetNameEl?.getAttribute('data-tsr-login'));
  if (direct) return direct;

  const linked =
    extractLoginFromHref(targetNameEl?.closest('a')?.getAttribute('href')) ||
    extractLoginFromHref(targetNameEl?.querySelector('a[href]')?.getAttribute('href')) ||
    extractLoginFromHref(cardEl.querySelector('a[href^="/"]')?.getAttribute('href')) ||
    extractLoginFromHref(cardEl.querySelector('a[href*="twitch.tv/"]')?.getAttribute('href'));
  if (linked) return linked;

  const intlMatch = rawText.match(/\((\w+)\)\s*$/);
  return normalizeLogin(intlMatch ? intlMatch[1] : rawText);
}

const USERCARD_NAME_SELECTOR = '.seventv-chat-user-username, .seventv-user-card-username, .seventv-usercard-display-name, .tw-title, [data-a-target="user-card-header-username"], .viewer-card-header__display-name';

/** Карточки, в которых рисуем баджи. Панель модератора `.user-details` сюда намеренно не входит. */
export const USERCARD_SELECTOR = '.seventv-user-card-float, .seventv-user-card, .seventv-usercard, .viewer-card, [data-a-target="viewer-card"]';

// Ячейка нативной карточки: 32x32, картинка 24px. Кнопки нет — у наших баджей нет страницы «за что выдан».
const VIEWER_CARD_BADGE_SIZE = 24;
// Только карточные: в .viewer-card лежит копия истории чата со своими .tcb-badge-list.
const OWN_CARD_BADGES_SELECTOR = '.tcb-badge-list--usercard, .tcb-card-badge';

/** Строка «Значки» нативной карточки: h5-заголовок, за ним ряд кнопок с картинками. Хэши styled-components не используем. */
function findViewerCardBadgeRow(cardEl: HTMLElement): HTMLElement | null {
  for (const heading of Array.from(cardEl.querySelectorAll<HTMLElement>('h5'))) {
    const row = heading.nextElementSibling as HTMLElement | null;
    if (row?.querySelector('button img')) return row;
  }
  return null;
}

type CardPlacement =
  | { kind: 'grid'; container: HTMLElement }
  | { kind: 'viewer-card'; container: HTMLElement }
  | { kind: 'inline'; container: HTMLElement; anchor: HTMLElement };

function resolveCardPlacement(cardEl: HTMLElement, nameEl: HTMLElement): CardPlacement | null {
  // 7TV (старый и новый): flex-ряд баджей с gap — наши встают в его конец.
  const grid = cardEl.querySelector<HTMLElement>('.seventv-user-card-badges, .seventv-usercard-badges');
  if (grid) return { kind: 'grid', container: grid };
  if (cardEl.matches('.viewer-card, [data-a-target="viewer-card"]')) {
    const row = findViewerCardBadgeRow(cardEl);
    return row ? { kind: 'viewer-card', container: row } : null;
  }
  const parent = nameEl.parentElement;
  return parent ? { kind: 'inline', container: parent, anchor: nameEl } : null;
}

function renderCardBadges(placement: CardPlacement, badges: Badge[]): number {
  if (placement.kind === 'viewer-card') {
    let count = 0;
    for (const badge of badges) {
      const img = createBadgeImg(badge, VIEWER_CARD_BADGE_SIZE);
      if (!img) continue;
      const cell = document.createElement('span');
      cell.className = 'tcb-card-badge';
      cell.appendChild(img);
      placement.container.appendChild(cell);
      count += 1;
    }
    return count;
  }

  const wrapper = document.createElement('span');
  wrapper.className = 'tcb-badge-list tcb-badge-list--usercard';
  for (const badge of badges) {
    const img = createBadgeImg(badge);
    if (img) wrapper.appendChild(img);
  }
  if (wrapper.children.length === 0) return 0;
  if (placement.kind === 'grid') placement.container.appendChild(wrapper);
  else placement.anchor.insertAdjacentElement('beforebegin', wrapper);
  return wrapper.children.length;
}

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

  if (targetNameEl) applyViewerNameStyle(targetNameEl, context.getCachedUser(username));

  // Карточку перерисовал фреймворк и выкинул наши баджи — рендерим заново.
  if (getBadgeRenderState(cardEl) === 'rendered' && !cardEl.querySelector(OWN_CARD_BADGES_SELECTOR)) {
    clearBadgeRenderState(cardEl);
  }
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
      applyViewerNameStyle(currentTargetNameEl, context.getCachedUser(username));

      const uniqueBadges = dedupeBadges(badges);
      cardEl.querySelectorAll(OWN_CARD_BADGES_SELECTOR).forEach((badge) => badge.remove());

      if (uniqueBadges.length === 0) {
        finishBadgeRender(cardEl, username, false);
        return;
      }

      const placement = resolveCardPlacement(cardEl, currentTargetNameEl);
      if (!placement) {
        failBadgeRender(cardEl, username, renderToken);
        return;
      }
      const rendered = renderCardBadges(placement, uniqueBadges);
      finishBadgeRender(cardEl, username, rendered > 0);
    } catch {
      failBadgeRender(cardEl, username, renderToken);
    }
  })();
}
