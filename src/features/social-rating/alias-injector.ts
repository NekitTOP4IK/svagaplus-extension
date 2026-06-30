import { getAlias, getAllAliases, isAliased } from './alias-manager';
import { detectCardLogin } from './card-detector';

const ALIASED_ATTR = 'data-tsr-aliased';
const ORIGINAL_ATTR = 'data-tsr-original';
const LOGIN_ATTR = 'data-tsr-login';
const NATIVE_NAME_SELECTOR = [
  '.chat-author__display-name',
  '.message-author__display-name',
  '.chatter-name',
  '.autocomplete-match-list button[data-a-target^="@"] p',
].join(', ');
const NAME_SELECTOR = `${NATIVE_NAME_SELECTOR}, .seventv-chat-user-username`;
const TOKEN_ORIGINAL_ATTR = 'data-tsr-original-token-text';
const tokenTextOriginals = new WeakMap<Text, string>();

// ── Core rewrite helpers ─────────────────────────────────────────────────────

function getTextNode(element: Element): Text | null {
  let current: Node = element;
  while (true) {
    const meaningful = Array.from(current.childNodes).filter(
      (n) =>
        n.nodeType !== Node.COMMENT_NODE &&
        !(n.nodeType === Node.TEXT_NODE && !n.textContent?.trim()),
    );
    if (meaningful.length === 1 && meaningful[0].nodeType === Node.ELEMENT_NODE) {
      current = meaningful[0];
    } else {
      break;
    }
  }

  if (current.childNodes.length === 1 && current.firstChild?.nodeType === Node.TEXT_NODE) {
    return current.firstChild as Text;
  }
  for (const node of current.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) return node as Text;
  }
  return null;
}

function normalizeLogin(login: string): string {
  return login.trim().replace(/^@/, '').toLowerCase();
}

function getElementText(element: Element): string {
  return (getTextNode(element)?.textContent ?? element.textContent ?? '').trim();
}

function getStoredLogin(element: Element): string | null {
  const login = element.getAttribute(LOGIN_ATTR);
  return login ? normalizeLogin(login) : null;
}

function getLoginFromNameElement(element: Element): string | null {
  const stored = getStoredLogin(element);
  const visible = getElementText(element);

  if (stored) {
    const storedAlias = getAlias(stored);
    if (!storedAlias || visible === storedAlias || visible === element.getAttribute(ORIGINAL_ATTR)) {
      return stored;
    }
  }

  const login = normalizeLogin(visible);
  return login || stored;
}

function rewriteText(element: Element, login: string): void {
  const normalizedLogin = normalizeLogin(login);
  const alias = getAlias(normalizedLogin);
  element.setAttribute(LOGIN_ATTR, normalizedLogin);
  if (!alias) {
    restoreElement(element);
    return;
  }

  const textNode = getTextNode(element);
  if (!textNode) return;

  const original = element.getAttribute(ORIGINAL_ATTR) ?? textNode.textContent ?? '';
  if (original && !element.hasAttribute(ORIGINAL_ATTR)) {
    element.setAttribute(ORIGINAL_ATTR, original);
  }

  if (textNode.textContent !== alias) {
    textNode.textContent = alias;
  }
  element.setAttribute(ALIASED_ATTR, 'true');
  element.setAttribute('title', normalizedLogin);
}

function getHrefLogin(element: Element): string | null {
  const href = element.getAttribute('href') ?? '';
  const m = href.match(/(?:^\/|twitch\.tv\/)([a-z0-9_]+)/i);
  return m ? normalizeLogin(m[1]) : null;
}

function findNativeCardNameLink(cardEl: Element, login: string): Element | null {
  const normalizedLogin = normalizeLogin(login);
  const preferred = cardEl.querySelector('.viewer-card-header__display-name a.tw-link');
  if (preferred) return preferred;

  const links = cardEl.querySelectorAll('a.tw-link[href], a[href][data-tsr-login]');
  for (const link of links) {
    const stored = getStoredLogin(link);
    const hrefLogin = getHrefLogin(link);
    if (stored === normalizedLogin || hrefLogin === normalizedLogin) return link;
  }

  return null;
}

function findNativeCardLogin(cardEl: Element): string | null {
  const links = cardEl.querySelectorAll('a[data-tsr-login], .viewer-card-header__display-name a[href], a.tw-link[href]');
  for (const link of links) {
    const stored = getStoredLogin(link);
    const hrefLogin = getHrefLogin(link);
    if (stored) return stored;
    if (hrefLogin) return hrefLogin;
  }

  return null;
}

function restoreElement(element: Element): void {
  if (!element.hasAttribute(ALIASED_ATTR)) return;
  const original = element.getAttribute(ORIGINAL_ATTR);
  if (original !== null) {
    const textNode = getTextNode(element);
    if (textNode) textNode.textContent = original;
  }
  element.removeAttribute(ALIASED_ATTR);
  element.removeAttribute(ORIGINAL_ATTR);
  element.removeAttribute('title');
}

function rewriteAliasTokens(element: Element): void {
  const aliases = getAllAliases();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let matchedLogin: string | null = null;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const original = tokenTextOriginals.get(node) ?? node.textContent ?? '';
    let next = original;
    let nodeMatchedLogin: string | null = null;

    for (const [login, alias] of Object.entries(aliases)) {
      const normalizedLogin = normalizeLogin(login);
      if (!normalizedLogin || !alias) continue;

      const regex = new RegExp(`\\b${escapeRegex(normalizedLogin)}\\b`, 'gi');
      if (regex.test(next)) {
        next = next.replace(regex, alias);
        nodeMatchedLogin = normalizedLogin;
      }
    }

    if (nodeMatchedLogin) {
      if (!tokenTextOriginals.has(node)) tokenTextOriginals.set(node, original);
      if (node.textContent !== next) node.textContent = next;
      matchedLogin = nodeMatchedLogin;
    } else if (tokenTextOriginals.has(node)) {
      node.textContent = original;
      tokenTextOriginals.delete(node);
    }
  }

  if (!matchedLogin) {
    element.removeAttribute(TOKEN_ORIGINAL_ATTR);
    element.removeAttribute(ALIASED_ATTR);
    element.removeAttribute(LOGIN_ATTR);
    element.removeAttribute('title');
    return;
  }

  element.setAttribute(TOKEN_ORIGINAL_ATTR, 'true');
  element.setAttribute(ALIASED_ATTR, 'true');
  element.setAttribute(LOGIN_ATTR, matchedLogin);
  element.setAttribute('title', matchedLogin);
}

function rewriteMentionElement(element: Element): void {
  const textNode = getTextNode(element);
  if (!textNode) return;

  const original = element.getAttribute(ORIGINAL_ATTR) ?? textNode.textContent ?? '';
  const m = original.trim().match(/^@([a-zA-Z0-9_]+)$/);
  if (!m) {
    restoreElement(element);
    return;
  }

  const login = normalizeLogin(m[1]);
  const alias = getAlias(login);
  element.setAttribute(LOGIN_ATTR, login);

  if (!alias) {
    restoreElement(element);
    return;
  }

  if (!element.hasAttribute(ORIGINAL_ATTR)) element.setAttribute(ORIGINAL_ATTR, original);
  const next = `@${alias}`;
  if (textNode.textContent !== next) textNode.textContent = next;
  element.setAttribute(ALIASED_ATTR, 'true');
  element.setAttribute('title', `@${login}`);
}

function rewriteReplyTextElement(element: Element): void {
  const textNode = getTextNode(element);
  if (!textNode) return;

  const original = element.getAttribute(ORIGINAL_ATTR) ?? textNode.textContent ?? '';
  const m = original.match(/^(Replying to\s+)@([a-zA-Z0-9_]+)(:\s*[\s\S]*)$/);
  if (!m) {
    restoreElement(element);
    return;
  }

  const login = normalizeLogin(m[2]);
  const alias = getAlias(login);
  element.setAttribute(LOGIN_ATTR, login);

  if (!alias) {
    restoreElement(element);
    return;
  }

  if (!element.hasAttribute(ORIGINAL_ATTR)) element.setAttribute(ORIGINAL_ATTR, original);
  const next = `${m[1]}@${alias}${m[3]}`;
  if (textNode.textContent !== next) textNode.textContent = next;
  element.setAttribute(ALIASED_ATTR, 'true');
  element.setAttribute('title', `@${login}`);
}

function rewriteSevenTVMentionToken(token: Element): void {
  const username = token.querySelector('.seventv-chat-user-username');
  if (!username) return;

  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(username, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.textContent?.trim()) textNodes.push(node);
  }

  const loginNode = textNodes.find((node) => node.textContent?.trim() !== '@');
  if (!loginNode) return;

  const original = username.getAttribute(ORIGINAL_ATTR) ?? loginNode.textContent ?? '';
  const login = normalizeLogin(original);
  if (!login) return;

  const alias = getAlias(login);
  username.setAttribute(LOGIN_ATTR, login);

  if (!alias) {
    if (username.hasAttribute(ALIASED_ATTR)) loginNode.textContent = original;
    username.removeAttribute(ALIASED_ATTR);
    username.removeAttribute(ORIGINAL_ATTR);
    username.removeAttribute('title');
    return;
  }

  if (!username.hasAttribute(ORIGINAL_ATTR)) username.setAttribute(ORIGINAL_ATTR, original);
  if (loginNode.textContent !== alias) loginNode.textContent = alias;
  username.setAttribute(ALIASED_ATTR, 'true');
  username.setAttribute('title', `@${login}`);
}

function applyAliasesToSevenTVMentionTokens(root: ParentNode): void {
  root.querySelectorAll('.mention-token').forEach((token) => {
    rewriteSevenTVMentionToken(token);
  });
}

function getLoginFromMessage(line: Element): string | null {
  const msg = line.closest('.chat-line__message');
  if (msg) {
    const login = msg.getAttribute('data-a-user');
    if (login) return login.toLowerCase();
  }
  const selfLogin = line.getAttribute('data-a-user');
  if (selfLogin) return selfLogin.toLowerCase();

  const card = line.closest('.seventv-user-card');
  if (card) {
    const detected = detectCardLogin(card);
    if (detected) return detected.login;
  }

  if (line.matches(NAME_SELECTOR)) return getLoginFromNameElement(line);

  const nameEl = line.querySelector(NAME_SELECTOR);
  if (nameEl) return getLoginFromNameElement(nameEl);

  return null;
}

// ── Chat rewriting ─────────────────────────────────────────────────────────

export function applyAliasesToChatLine(line: Element): void {
  const login = getLoginFromMessage(line);
  if (!login) return;

  const displayNames = line.matches(NATIVE_NAME_SELECTOR)
    ? [line]
    : Array.from(line.querySelectorAll(NATIVE_NAME_SELECTOR));
  for (const displayName of displayNames) rewriteText(displayName, login);

  const seventvName = line.matches('.seventv-chat-user-username')
    ? line
    : line.querySelector('.seventv-chat-user-username');
  if (seventvName && !seventvName.closest('.mention-token')) rewriteText(seventvName, login);

  applyAliasesToSevenTVMentionTokens(line);

  const msgWrapper = line.closest('.chat-line__message');
  if (msgWrapper) {
    const label = msgWrapper.getAttribute('aria-label');
    if (label) {
      const alias = getAlias(login);
      if (alias) {
        const regex = new RegExp(`\\b${escapeRegex(login)}\\b`, 'gi');
        const newLabel = label.replace(regex, alias);
        if (newLabel !== label) msgWrapper.setAttribute('aria-label', newLabel);
      }
    }
  }

  const replyBtn = line.querySelector('button[aria-label*="reply"]');
  if (replyBtn) {
    const rLabel = replyBtn.getAttribute('aria-label');
    if (rLabel) {
      const alias = getAlias(login);
      if (alias) {
        const regex = new RegExp(`@${escapeRegex(login)}\\b`, 'gi');
        const newLabel = rLabel.replace(regex, `@${alias}`);
        if (newLabel !== rLabel) replyBtn.setAttribute('aria-label', newLabel);
      }
    }
  }

  const mentions = line.querySelectorAll('.mention-fragment, [data-a-target="chat-message-mention"]');
  for (const mention of mentions) {
    rewriteMentionElement(mention);
  }
}

export function applyAliasesToPinnedChat(): void {
  document.querySelectorAll('.pinned-chat__pinned-by').forEach((el) => {
    rewriteAliasTokens(el);
  });

  document.querySelectorAll('.chatter-name').forEach((el) => {
    applyAliasesToChatLine(el);
  });
}

export function applyAliasesToAutocomplete(): void {
  document.querySelectorAll('.autocomplete-match-list button[data-a-target^="@"]').forEach((button) => {
    const target = button.getAttribute('data-a-target') ?? '';
    const login = normalizeLogin(target);
    if (!login) return;

    const label = button.querySelector('p');
    if (label) rewriteText(label, login);
  });
}

export function applyAliasesToReplyPreviews(): void {
  document.querySelectorAll('p span[dir="auto"]').forEach((span) => {
    applyAliasesToReplyPreviewElement(span);
  });

  document.querySelectorAll('.seventv-reply-message-part').forEach((el) => {
    applyAliasesToReplyPreviewElement(el);
  });
}

export function applyAliasesToReplyPreviewElement(element: Element): void {
  if (element.matches('p span[dir="auto"]')) {
    const text = getElementText(element);
    if (/^@[a-zA-Z0-9_]+$/.test(text)) rewriteMentionElement(element);
    return;
  }

  if (element.matches('.seventv-reply-message-part')) {
    rewriteReplyTextElement(element);
  }
}

export function applyAliasesToInlineCallouts(): void {
  document.querySelectorAll('.inline-private-callout-line__icon').forEach((icon) => {
    const callout = icon.parentElement;
    if (!callout) return;

    callout.querySelectorAll('span').forEach((span) => {
      rewriteAliasTokens(span);
    });
  });
}

export function applyAliasesToSevenTVPrompts(): void {
  document.querySelectorAll('.seventv-confirm-prompt-body .seventv-chat-user-username').forEach((nameEl) => {
    const login = getLoginFromNameElement(nameEl);
    if (login) rewriteText(nameEl, login);
  });
}

export function applyAliasesToAllChat(): void {
  const nativeLines = document.querySelectorAll('.chat-line__message');
  for (const line of nativeLines) applyAliasesToChatLine(line);

  const nativeHistoryNames = document.querySelectorAll('.message-author__display-name');
  for (const nameEl of nativeHistoryNames) {
    if (nameEl.closest('.chat-line__message')) continue;
    applyAliasesToChatLine(nameEl);
  }

  applyAliasesToPinnedChat();
  applyAliasesToAutocomplete();
  applyAliasesToReplyPreviews();
  applyAliasesToInlineCallouts();
  applyAliasesToSevenTVPrompts();

  const seventvMessages = document.querySelectorAll('.seventv-user-message');
  for (const msg of seventvMessages) {
    const wrapper = msg.closest('.chat-line__message');
    if (wrapper) {
      applyAliasesToChatLine(wrapper);
    } else {
      const card = msg.closest('.seventv-user-card');
      if (card) {
        const detected = detectCardLogin(card);
        if (detected) {
          applyAliasesToSevenTVMentionTokens(msg);
          const nameEl = msg.querySelector('.seventv-chat-user-username');
          if (nameEl && !nameEl.closest('.mention-token')) rewriteText(nameEl, detected.login);
        }
      } else {
        const userBlock = msg.querySelector('.seventv-chat-user');
        if (userBlock) {
          const nameEl = userBlock.querySelector('.seventv-chat-user-username');
          if (nameEl) {
            const login = userBlock.getAttribute('data-a-user') ?? getLoginFromNameElement(nameEl) ?? '';
            if (login) rewriteText(nameEl, login);
          }
        }
      }
    }
  }
}

// ── Viewer card rewriting ───────────────────────────────────────────────────

export function applyAliasesToViewerCard(cardEl: Element, login: string): void {
  const alias = getAlias(login);

  const nativeLink = findNativeCardNameLink(cardEl, login);
  if (nativeLink) rewriteText(nativeLink, login);

  const seventvLink = cardEl.querySelector('.seventv-user-card-usertag');
  if (seventvLink) {
    const nameEl = seventvLink.querySelector('.seventv-chat-user-username');
    if (nameEl) rewriteText(nameEl, login);
  }

  const timelineList = cardEl.querySelector('.seventv-user-card-message-timeline-list');
  if (timelineList) {
    applyAliasesToSevenTVMentionTokens(timelineList);
    timelineList.querySelectorAll('.seventv-chat-user-username').forEach((el) => {
      if (el.closest('.mention-token')) return;
      rewriteText(el, login);
    });
  }

  const followBtn = cardEl.querySelector('button[data-a-target="follow-button"]');
  if (followBtn) {
    const label = followBtn.getAttribute('aria-label');
    if (label) {
      const original = followBtn.getAttribute(ORIGINAL_ATTR) ?? label;
      if (!followBtn.hasAttribute(ORIGINAL_ATTR)) followBtn.setAttribute(ORIGINAL_ATTR, original);

      if (alias) {
        const regex = new RegExp(`\\b${escapeRegex(login)}\\b`, 'gi');
        const newLabel = original.replace(regex, alias);
        if (newLabel !== label) followBtn.setAttribute('aria-label', newLabel);
      } else {
        followBtn.setAttribute('aria-label', original);
        followBtn.removeAttribute(ORIGINAL_ATTR);
      }
    }
  }
}

export function applyAliasesToOpenCards(): void {
  document.querySelectorAll('[class*="viewer-card-layer"], .viewer-card, .seventv-user-card').forEach((el) => {
    const detected = detectCardLogin(el);
    if (detected) {
      applyAliasesToViewerCard(detected.element, detected.login);
      return;
    }

    const login = findNativeCardLogin(el);
    if (login) applyAliasesToViewerCard(el, login);
  });
}

// ── Leaderboard rewriting ──────────────────────────────────────────────────

export function applyAliasesToLeaderboard(): void {
  const selectors = [
    '[data-test-selector="leaderboard-item-name-test-selector"]',
    '[class*="channelLeaderboardHeaderRunnerUpEntry__username"]',
    '[class*="username--"]',
  ];

  for (const sel of selectors) {
    const items = document.querySelectorAll(sel);
    for (const item of items) {
      const strong = item.querySelector('strong[title]');
      if (!strong) continue;
      const login = strong.getAttribute('title')?.toLowerCase() ?? '';
      if (!login) continue;
      const alias = getAlias(login);
      if (!alias) {
        restoreElement(strong);
        continue;
      }
      const textNode = getTextNode(strong);
      if (!textNode) continue;
      const original = strong.getAttribute(ORIGINAL_ATTR) ?? textNode.textContent ?? '';
      if (!strong.hasAttribute(ORIGINAL_ATTR)) strong.setAttribute(ORIGINAL_ATTR, original);
      if (textNode.textContent !== alias) textNode.textContent = alias;
      strong.setAttribute(ALIASED_ATTR, 'true');
      strong.setAttribute('title', login);
    }
  }
}

// ── Side-nav rewriting ─────────────────────────────────────────────────────

export function applyAliasesToSideNav(): void {
  const cards = document.querySelectorAll('.side-nav-card');
  for (const card of cards) {
    const img = card.querySelector<HTMLImageElement>('.side-nav-card__avatar img');
    if (!img || !img.alt) continue;
    const login = img.alt.toLowerCase();
    const alias = getAlias(login);
    if (alias) {
      const original = img.getAttribute(ORIGINAL_ATTR) ?? img.alt;
      if (!img.hasAttribute(ORIGINAL_ATTR)) img.setAttribute(ORIGINAL_ATTR, original);
      img.alt = alias;
      img.setAttribute(ALIASED_ATTR, 'true');
      img.setAttribute('title', login);
    } else {
      const original = img.getAttribute(ORIGINAL_ATTR);
      if (original !== null) {
        img.alt = original;
        img.removeAttribute(ALIASED_ATTR);
        img.removeAttribute(ORIGINAL_ATTR);
        img.removeAttribute('title');
      }
    }
  }
}

// ── Batch re-apply ───────────────────────────────────────────────────────────

let batchTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleBatchReapply(): void {
  if (batchTimer) clearTimeout(batchTimer);
  batchTimer = setTimeout(() => {
    applyAliasesToAllChat();
    applyAliasesToOpenCards();
    applyAliasesToPinnedChat();
    applyAliasesToAutocomplete();
    applyAliasesToReplyPreviews();
    applyAliasesToInlineCallouts();
    applyAliasesToSevenTVPrompts();
    applyAliasesToLeaderboard();
    applyAliasesToSideNav();
  }, 50);
}

// ── Pencil / reset UI helpers for cards ────────────────────────────────────

const EDIT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const RESET_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;

function makeIconBtn(svg: string, color: string, hoverColor: string, title: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.innerHTML = svg;
  btn.title = title;
  btn.style.cssText = `
    display:inline-flex;align-items:center;justify-content:center;
    width:18px;height:18px;padding:0;margin-left:4px;
    border:none;background:transparent;cursor:pointer;
    color:${color};flex-shrink:0;vertical-align:middle;
  `;
  btn.addEventListener('mouseover', () => { btn.style.color = hoverColor; });
  btn.addEventListener('mouseout', () => { btn.style.color = color; });
  return btn;
}

function showInlineAliasForm(
  btnWrap: HTMLElement,
  login: string,
  currentAlias: string | undefined,
  onSave: (alias: string) => void,
): void {
  if (btnWrap.querySelector('[data-tsr-alias-input]')) return;

  const icons = Array.from(btnWrap.querySelectorAll<HTMLElement>('button'));
  icons.forEach((b) => { b.style.display = 'none'; });

  const blockEvent = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
  for (const ev of ['mousedown', 'pointerdown', 'click'] as const) {
    btnWrap.addEventListener(ev, blockEvent);
  }

  const input = document.createElement('input');
  input.setAttribute('data-tsr-alias-input', '');
  input.type = 'text';
  input.value = currentAlias ?? '';
  input.placeholder = 'Новый ник…';
  input.style.cssText = [
    'font-size:12px',
    'background:#18181b',
    'color:#efeff1',
    'border:1px solid #3a3a3d',
    'border-radius:4px',
    'padding:2px 6px',
    'outline:none',
    'width:92px',
    'height:22px',
    'box-sizing:border-box',
    'vertical-align:middle',
    'margin-left:4px',
  ].join(';');
  input.addEventListener('focus', () => { input.style.borderColor = '#7d7d87'; });
  input.addEventListener('blur', () => { input.style.borderColor = '#3a3a3d'; });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') cleanup();
  });
  for (const ev of ['mousedown', 'pointerdown', 'click'] as const) {
    input.addEventListener(ev, (e) => { e.stopPropagation(); e.preventDefault(); });
  }

  const BTN_BASE = [
    'display:inline-flex',
    'align-items:center',
    'justify-content:center',
    'height:22px',
    'min-width:26px',
    'padding:0 5px',
    'border-radius:4px',
    'border:1px solid transparent',
    'cursor:pointer',
    'font-size:14px',
    'font-weight:700',
    'line-height:1',
    'vertical-align:middle',
    'margin-left:3px',
  ].join(';');

  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = '✓';
  confirmBtn.style.cssText = `${BTN_BASE};background:#00e67618;border-color:#00e67650;color:#00e676;`;
  confirmBtn.addEventListener('mouseover', () => { confirmBtn.style.background = '#00e67630'; });
  confirmBtn.addEventListener('mouseout', () => { confirmBtn.style.background = '#00e67618'; });
  for (const ev of ['mousedown', 'pointerdown', 'click'] as const) {
    confirmBtn.addEventListener(ev, (e) => { e.stopPropagation(); e.preventDefault(); });
  }

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '✕';
  cancelBtn.style.cssText = `${BTN_BASE};background:#ffffff08;border-color:#3a3a3d;color:#7d7d87;`;
  cancelBtn.addEventListener('mouseover', () => { cancelBtn.style.background = '#ffffff14'; cancelBtn.style.color = '#adadb8'; });
  cancelBtn.addEventListener('mouseout', () => { cancelBtn.style.background = '#ffffff08'; cancelBtn.style.color = '#7d7d87'; });
  for (const ev of ['mousedown', 'pointerdown', 'click'] as const) {
    cancelBtn.addEventListener(ev, (e) => { e.stopPropagation(); e.preventDefault(); });
  }

  const cleanup = () => {
    input.remove();
    confirmBtn.remove();
    cancelBtn.remove();
    icons.forEach((b) => { b.style.display = ''; });
    for (const ev of ['mousedown', 'pointerdown', 'click'] as const) {
      btnWrap.removeEventListener(ev, blockEvent);
    }
  };

  const save = () => {
    const val = input.value.trim();
    cleanup();
    onSave(val);
  };

  confirmBtn.addEventListener('click', () => save());
  cancelBtn.addEventListener('click', () => cleanup());

  btnWrap.appendChild(input);
  btnWrap.appendChild(confirmBtn);
  btnWrap.appendChild(cancelBtn);

  requestAnimationFrame(() => { input.focus(); input.select(); });
}

export function injectCardAliasControls(
  cardEl: Element,
  login: string,
  onSetAlias: (login: string, alias: string) => void,
  onRemoveAlias: (login: string) => void,
): void {
  if (cardEl.querySelector('[data-tsr-alias-controls]')) return;

  const alias = getAlias(login);
  const isCurrentlyAliased = !!alias;

  let nameEl: Element | null = null;
  let btnContainer: Element | null = null;

  const nativeDisplay = cardEl.querySelector('.viewer-card-header__display-name');
  if (nativeDisplay) {
    nameEl = nativeDisplay.querySelector('a.tw-link, h4 a');
    if (nameEl) btnContainer = nameEl.parentElement;
  }

  const seventvTag = cardEl.querySelector('.seventv-user-card-usertag');
  if (seventvTag) {
    const chatUser = seventvTag.querySelector('.seventv-chat-user');
    if (chatUser) {
      nameEl = chatUser.querySelector('.seventv-chat-user-username');
      if (nameEl) btnContainer = chatUser;
    }
  }

  if (!nameEl || !btnContainer) return;

  const btnWrap = document.createElement('span');
  btnWrap.setAttribute('data-tsr-alias-controls', '');
  btnWrap.style.cssText = 'display:inline-flex;align-items:center;vertical-align:middle;margin-left:4px;';

  const editBtn = makeIconBtn(EDIT_ICON_SVG, '#adadb8', '#efeff1', 'Переименовать');
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    showInlineAliasForm(btnWrap as HTMLElement, login, getAlias(login) ?? undefined, (newAlias) => {
      onSetAlias(login, newAlias);
    });
  });
  btnWrap.appendChild(editBtn);

  if (isCurrentlyAliased) {
    const resetBtn = makeIconBtn(RESET_ICON_SVG, '#ff4444', '#ff6666', 'Сбросить ник');
    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      onRemoveAlias(login);
    });
    btnWrap.appendChild(resetBtn);
  }

  nameEl.insertAdjacentElement('afterend', btnWrap);
}

export function removeCardAliasControls(cardEl: Element): void {
  cardEl.querySelectorAll('[data-tsr-alias-controls]').forEach((el) => el.remove());
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
