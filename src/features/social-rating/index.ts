import { debug } from './logger';
import { extractCurrentChannel } from './channel';
import { detectCardLogin } from './card-detector';
import { injectBadge, updateBadgeScore, refreshOpenCardAwards } from './cards';
import { fetchRating, prefetchChannelBadgeGrants, refreshChannelBadgeGrants } from './api';
import { connectWebSocket, disconnectWebSocket } from './ws';
import {
  processNativeChatBadges,
  processSevenTVChatBadges,
  refreshVisibleChatBadges,
} from './chat-badges';
import {
  initAliasManager,
  onAliasChange,
  setAlias,
  removeAlias,
} from './alias-manager';
import {
  applyAliasesToChatLine,
  applyAliasesToAllChat,
  applyAliasesToLeaderboard,
  applyAliasesToSideNav,
  applyAliasesToViewerCard,
  applyAliasesToOpenCards,
  applyAliasesToPinnedChat,
  applyAliasesToAutocomplete,
  applyAliasesToReplyPreviews,
  applyAliasesToReplyPreviewElement,
  applyAliasesToInlineCallouts,
  applyAliasesToSevenTVPrompts,
  injectCardAliasControls,
  removeCardAliasControls,
  scheduleBatchReapply,
} from './alias-injector';

function getCurrentChannel(): string {
  const { hostname, pathname } = window.location;
  debug('content', 'getCurrentChannel hostname=', hostname, 'pathname=', pathname);
  const ch = extractCurrentChannel(hostname, pathname);
  debug('content', 'channel=', ch);
  return ch;
}

const processing = new WeakSet<Element>();
const CARD_SELECTOR = '[class*="viewer-card-layer"], .seventv-user-card, .seventv-usercard';
const CARD_REAPPLY_SELECTOR = '.seventv-user-card, .seventv-usercard, .viewer-card, [class*="viewer-card-layer"]';
const CARD_LIVE_SECTION_SELECTOR = '.seventv-usercard-tabs';
const ALIASED_SELECTOR = '[data-tsr-aliased]';
const NAME_SELECTOR = [
  '.chat-author__display-name',
  '.message-author__display-name',
  '.chatter-name',
  '.autocomplete-match-list button[data-a-target^="@"] p',
  '.seventv-confirm-prompt-body .seventv-chat-user-username',
  '.seventv-chat-user-username',
].join(', ');
const REPLY_PREVIEW_SELECTOR = 'p span[dir="auto"], .seventv-reply-message-part';
const BATCH_REAPPLY_SELECTOR = [
  '.pinned-chat__pinned-by',
  '.autocomplete-match-list',
  '.inline-private-callout-line__icon',
  '.seventv-confirm-prompt-body',
].join(', ');
let badgeGrantsRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function isAliasOwnedMutation(node: Node): boolean {
  const el = node instanceof Element ? node : node.parentElement;
  return el?.closest(ALIASED_SELECTOR) != null;
}

function isCardMutationNode(el: Element): boolean {
  return el.matches(CARD_SELECTOR) ||
    el.matches(CARD_LIVE_SECTION_SELECTOR) ||
    el.querySelector(CARD_SELECTOR) != null;
}

async function handleElement(el: Element): Promise<void> {
  const card = detectCardLogin(el);
  if (!card) return;

  applyAliasesToViewerCard(card.element, card.login);

  if (processing.has(card.element)) return;
  processing.add(card.element);
  try {
    const channel = getCurrentChannel();
    debug('content', 'handleElement card.login=', card.login, 'channel=', channel, 'type=', card.type);
    const rating = await fetchRating(card.login, channel);
    debug('content', 'handleElement rating=', rating);
    if (rating === null) return;
    await injectBadge(card, rating, channel);

    injectCardAliasControls(
      card.element,
      card.login,
      async (login, alias) => {
        await setAlias(login, alias);
        scheduleBatchReapply();
        refreshOpenCardAliases();
      },
      async (login) => {
        await removeAlias(login);
        scheduleBatchReapply();
        refreshOpenCardAliases();
      },
    );

    applyAliasesToViewerCard(card.element, card.login);
  } finally {
    processing.delete(card.element);
  }
}

function refreshOpenCardAliases(): void {
  applyAliasesToOpenCards();

  document.querySelectorAll(CARD_SELECTOR).forEach((el) => {
    const detected = detectCardLogin(el);
    if (!detected) return;

    applyAliasesToViewerCard(detected.element, detected.login);
    removeCardAliasControls(detected.element);
    injectCardAliasControls(
      detected.element,
      detected.login,
      async (login, alias) => {
        await setAlias(login, alias);
        scheduleBatchReapply();
        refreshOpenCardAliases();
      },
      async (login) => {
        await removeAlias(login);
        scheduleBatchReapply();
        refreshOpenCardAliases();
      },
    );
  });
}

function observe(): void {
  const chatLinesToReapply = new Set<Element>();
  const cardsToReapply = new Set<Element>();

  const observer = new MutationObserver((mutations) => {
    const newChatLines = new Set<Element>();

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;

        if (isCardMutationNode(node)) handleElement(node);
        node
          .querySelectorAll(CARD_SELECTOR)
          .forEach((el) => handleElement(el));

        if (node.classList.contains('chat-line__message')) {
          newChatLines.add(node);
          processNativeChatBadges(node, getCurrentChannel());
        }
        node.querySelectorAll('.chat-line__message').forEach((el) => {
          newChatLines.add(el);
          processNativeChatBadges(el, getCurrentChannel());
        });

        if (node.matches(NAME_SELECTOR)) {
          newChatLines.add(node);
        }
        node.querySelectorAll(NAME_SELECTOR).forEach((el) => newChatLines.add(el));

        if (node.matches(REPLY_PREVIEW_SELECTOR)) applyAliasesToReplyPreviewElement(node);
        node.querySelectorAll(REPLY_PREVIEW_SELECTOR).forEach((el) => applyAliasesToReplyPreviewElement(el));

        if (node.matches(BATCH_REAPPLY_SELECTOR) || node.querySelector(BATCH_REAPPLY_SELECTOR)) {
          scheduleBatchReapply();
        }

        if (node.classList.contains('seventv-user-message')) {
          const wrapper = node.closest('.chat-line__message');
          if (wrapper) newChatLines.add(wrapper);
          if (!wrapper) newChatLines.add(node);
          processSevenTVChatBadges(node, getCurrentChannel());
        }
        node.querySelectorAll('.seventv-user-message').forEach((el) => {
          const wrapper = el.closest('.chat-line__message');
          if (wrapper) newChatLines.add(wrapper);
          if (!wrapper) newChatLines.add(el);
          processSevenTVChatBadges(el, getCurrentChannel());
        });

        if (
          node.matches?.('[data-test-selector="leaderboard-item-name-test-selector"]') ||
          node.matches?.('[class*="channelLeaderboardHeaderRunnerUpEntry__username"], [class*="username--"]') ||
          node.querySelector('[data-test-selector="leaderboard-item-name-test-selector"], [class*="channelLeaderboardHeaderRunnerUpEntry__username"], [class*="username--"]')
        ) {
          scheduleBatchReapply();
        }

        if (
          node.classList?.contains('side-nav-card') ||
          node.querySelector('.side-nav-card')
        ) {
          scheduleBatchReapply();
        }
      }

      if (
        mutation.type === 'childList' &&
        mutation.target instanceof Element &&
        Array.from(mutation.target.classList).some((c) => c.startsWith('viewer-card-layer')) &&
        mutation.target.children.length > 0
      ) {
        handleElement(mutation.target as Element);
      }

      if (mutation.type === 'childList' && mutation.target instanceof Element) {
        if (isAliasOwnedMutation(mutation.target)) continue;

        const card = mutation.target.closest(CARD_REAPPLY_SELECTOR);
        if (card) cardsToReapply.add(card);

        const target = mutation.target;
        const isUserNameSpan =
          target.classList?.contains('seventv-chat-user-username') ||
          target.classList?.contains('chat-author__display-name') ||
          target.classList?.contains('message-author__display-name') ||
          target.closest('.seventv-chat-user-username') != null ||
          target.closest('.chat-author__display-name') != null ||
          target.closest('.message-author__display-name') != null;
        if (isUserNameSpan) {
          const line = target.closest('.chat-line__message, .seventv-user-message') ?? target.closest(NAME_SELECTOR);
          if (line) chatLinesToReapply.add(line);
        }
      }

      if (mutation.type === 'characterData' && mutation.target instanceof Text) {
        if (isAliasOwnedMutation(mutation.target)) continue;

        const parent = mutation.target.parentElement;
        if (parent) {
          const isUserNameSpan =
            parent.classList?.contains('seventv-chat-user-username') ||
            parent.classList?.contains('chat-author__display-name') ||
            parent.classList?.contains('message-author__display-name') ||
            parent.closest('.seventv-chat-user-username') != null ||
            parent.closest('.chat-author__display-name') != null ||
            parent.closest('.message-author__display-name') != null;
          if (isUserNameSpan) {
            const line = parent.closest('.chat-line__message, .seventv-user-message') ?? parent.closest(NAME_SELECTOR);
            if (line) chatLinesToReapply.add(line);
          }
        }
      }
    }

    if (cardsToReapply.size > 0) {
      const cards = Array.from(cardsToReapply);
      cardsToReapply.clear();
      requestAnimationFrame(() => {
        for (const card of cards) {
          const detected = detectCardLogin(card);
          if (!detected) {
            applyAliasesToOpenCards();
            continue;
          }

          applyAliasesToViewerCard(detected.element, detected.login);
          if (!detected.element.querySelector('[data-tsr-alias-controls]')) {
            injectCardAliasControls(
              detected.element,
              detected.login,
              async (login, alias) => {
                await setAlias(login, alias);
                scheduleBatchReapply();
                refreshOpenCardAliases();
              },
              async (login) => {
                await removeAlias(login);
                scheduleBatchReapply();
                refreshOpenCardAliases();
              },
            );
          }
        }
      });
    }

    if (newChatLines.size > 0) {
      requestAnimationFrame(() => {
        for (const line of newChatLines) {
          applyAliasesToChatLine(line);
        }
      });
    }

    if (chatLinesToReapply.size > 0) {
      const lines = Array.from(chatLinesToReapply);
      chatLinesToReapply.clear();
      requestAnimationFrame(() => {
        for (const line of lines) {
          applyAliasesToChatLine(line);
        }
      });
    }
  });

  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function initWebSocket(): void {
  const channel = getCurrentChannel();
  if (!channel) return;
  connectWebSocket(
    channel,
    (login, score) => updateBadgeScore(login, score),
    (updatedChannel) => scheduleBadgeGrantsRefresh(updatedChannel),
  );
}

function scheduleBadgeGrantsRefresh(channelLogin: string): void {
  if (badgeGrantsRefreshTimer) clearTimeout(badgeGrantsRefreshTimer);
  badgeGrantsRefreshTimer = setTimeout(async () => {
    badgeGrantsRefreshTimer = null;
    if (getCurrentChannel() !== channelLogin) return;
    await refreshChannelBadgeGrants(channelLogin);
    await refreshVisibleChatBadges(channelLogin);
    await refreshOpenCardAwards(channelLogin);
  }, 120);
}

let lastChannel = '';
function watchNavigation(): void {
  const check = () => {
    const ch = getCurrentChannel();
    if (ch && ch !== lastChannel) {
      lastChannel = ch;
      disconnectWebSocket();
      initWebSocket();
      scheduleBatchReapply();
      prefetchChannelBadgeGrants(ch).catch(() => {});
    }
  };
  const origPush = history.pushState.bind(history);
  history.pushState = (...args) => {
    origPush(...args);
    check();
  };
  window.addEventListener('popstate', check);
}

// ── Startup ─────────────────────────────────────────────────────────────────

export async function startSocialRatingContent(): Promise<void> {
  debug('content', 'startup BACKEND_URL=', (window as any).__BACKEND_URL__ ?? 'n/a');
  await initAliasManager();

  const startChannel = getCurrentChannel();
  if (startChannel) {
    prefetchChannelBadgeGrants(startChannel).catch(() => {});
  }

  applyAliasesToAllChat();
  document.querySelectorAll('.chat-line__message').forEach((el) => processNativeChatBadges(el, getCurrentChannel()));
  document.querySelectorAll('.seventv-user-message').forEach((el) => processSevenTVChatBadges(el, getCurrentChannel()));
  applyAliasesToOpenCards();
  applyAliasesToPinnedChat();
  applyAliasesToAutocomplete();
  applyAliasesToReplyPreviews();
  applyAliasesToInlineCallouts();
  applyAliasesToSevenTVPrompts();
  applyAliasesToLeaderboard();
  applyAliasesToSideNav();

  observe();
  initWebSocket();
  watchNavigation();

  onAliasChange(() => {
    scheduleBatchReapply();
    refreshOpenCardAliases();
  });
}
