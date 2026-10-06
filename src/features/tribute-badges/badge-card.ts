export interface BadgeCardData {
  kind: string;
  name: string;
  image_url: string;
  rarity: string | null;
  description: string | null;
  how_to_get: string | null;
  owners: number;
  context: { channel: string | null; period: string | null };
}

export type BadgeCardFetcher = (page: string) => Promise<{ card: BadgeCardData; url: string } | null>;

const RARITY_LABELS: Record<string, string> = {
  common: 'Обычный',
  rare: 'Редкий',
  epic: 'Эпический',
  mythic: 'Мифический',
  service: 'Служебный',
};

const SHIMMER_RARITIES = new Set(['rare', 'epic', 'mythic', 'service']);
const CARD_WIDTH = 296;
const GAP = 10;
const EDGE = 8;
const OPEN_CLASS = 'tcb-bcard-open';

let popover: HTMLElement | null = null;
let anchor: HTMLElement | null = null;
let viewport: Element | null = null;
let anchorTop = 0;
let anchorLeft = 0;
let followFrame = 0;
let ready = false;
let requestSeq = 0;

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function ownersText(card: BadgeCardData): string {
  const word = card.kind === 'sub'
    ? plural(card.owners, 'подписчик с ним', 'подписчика с ним', 'подписчиков с ним')
    : plural(card.owners, 'владелец', 'владельца', 'владельцев');
  return `${card.owners.toLocaleString('ru-RU')} ${word}`;
}

function kindText(card: BadgeCardData): string {
  const { channel, period } = card.context;
  if (card.kind === 'sub') return channel ? `Подписка на ${channel}` : 'За подписку';
  if (card.kind === 'social') return ['Соц. рейтинг', period].filter(Boolean).join(' · ');
  return 'Коллекционный';
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function rarityTag(rarity: string): HTMLElement {
  const tag = element('span', `tcb-rtag tcb-rtag--${rarity}${SHIMMER_RARITIES.has(rarity) ? ' tcb-rtag--animated' : ''}`);
  tag.append(element('span', 'tcb-rtag__gem'), document.createTextNode(RARITY_LABELS[rarity]));
  return tag;
}

function place(card: HTMLElement, anchor: Element): void {
  const rect = anchor.getBoundingClientRect();
  const center = rect.left + rect.width / 2;
  const left = Math.min(Math.max(EDGE, center - 26), window.innerWidth - CARD_WIDTH - EDGE);
  card.style.left = `${left}px`;
  card.style.setProperty('--tcb-arrow-x', `${Math.min(Math.max(center - left, 16), CARD_WIDTH - 16)}px`);
  const height = card.offsetHeight;
  const below = rect.bottom + GAP;
  const above = height > 0 && below + height > window.innerHeight - EDGE && rect.top - GAP - height >= EDGE;
  card.classList.toggle('tcb-bcard--above', above);
  card.style.top = `${above ? rect.top - GAP - height : below}px`;
}

function scrollContainer(node: Element): Element | null {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll|overlay)/.test(window.getComputedStyle(parent).overflowY)) return parent;
  }
  return null;
}

// Chat lines move without any event we could listen to (new messages, 7TV
// re-renders, Twitch trimming history), so the card tracks its badge per frame.
function follow(): void {
  followFrame = 0;
  if (!popover || !anchor) return;
  if (!anchor.isConnected) {
    closeBadgeCard();
    return;
  }
  const rect = anchor.getBoundingClientRect();
  if (viewport) {
    const bounds = viewport.getBoundingClientRect();
    if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) {
      closeBadgeCard();
      return;
    }
  }
  if (rect.top !== anchorTop || rect.left !== anchorLeft) {
    anchorTop = rect.top;
    anchorLeft = rect.left;
    place(popover, anchor);
  }
  followFrame = window.requestAnimationFrame(follow);
}

function shell(rarity: string): HTMLElement {
  const root = element('div', 'tcb-bcard');
  root.setAttribute('role', 'dialog');
  root.dataset.rarity = rarity;
  return root;
}

function renderSkeleton(): HTMLElement {
  const root = shell('none');
  root.classList.add('tcb-bcard--loading');
  root.setAttribute('aria-busy', 'true');
  root.setAttribute('aria-label', 'Загрузка бейджа');
  const head = element('div', 'tcb-bcard__head');
  const lines = element('div', 'tcb-bcard__titles');
  lines.append(element('span', 'tcb-bcard__bone tcb-bcard__bone--name'), element('span', 'tcb-bcard__bone tcb-bcard__bone--tag'));
  head.append(element('span', 'tcb-bcard__art tcb-bcard__bone'), lines);
  const body = element('div', 'tcb-bcard__body');
  body.append(element('span', 'tcb-bcard__bone'), element('span', 'tcb-bcard__bone tcb-bcard__bone--short'));
  root.append(head, body);
  return root;
}

function renderCard(card: BadgeCardData, url: string): HTMLElement {
  const rarity = card.rarity && RARITY_LABELS[card.rarity] ? card.rarity : null;
  const root = shell(rarity || 'none');
  root.setAttribute('aria-label', card.name);

  const head = element('div', 'tcb-bcard__head');
  const art = element('span', 'tcb-bcard__art');
  const image = element('img', 'tcb-bcard__img');
  image.src = card.image_url;
  image.alt = '';
  art.append(image);
  const titles = element('div', 'tcb-bcard__titles');
  titles.append(element('div', 'tcb-bcard__name', card.name));
  titles.append(rarity ? rarityTag(rarity) : element('span', 'tcb-bcard__kind', kindText(card)));
  head.append(art, titles);
  root.append(head);

  if (card.description || card.how_to_get) {
    const body = element('div', 'tcb-bcard__body');
    if (card.description) body.append(element('p', 'tcb-bcard__desc', card.description));
    if (card.how_to_get) {
      const how = element('div', 'tcb-bcard__how');
      how.append(element('span', 'tcb-bcard__how-label', 'Как получить'), element('p', 'tcb-bcard__how-text', card.how_to_get));
      body.append(how);
    }
    root.append(body);
  }

  const foot = element('div', 'tcb-bcard__foot');
  const link = element('a', 'tcb-bcard__link', 'Страница бейджа');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  foot.append(element('span', 'tcb-bcard__owners', ownersText(card)), link);
  root.append(foot);
  return root;
}

export function closeBadgeCard(): void {
  requestSeq += 1;
  popover?.remove();
  popover = null;
  anchor = null;
  viewport = null;
  if (followFrame) window.cancelAnimationFrame(followFrame);
  followFrame = 0;
  document.documentElement.classList.remove(OPEN_CLASS);
}

async function openBadgeCard(badge: HTMLElement, page: string, fetchCard: BadgeCardFetcher): Promise<void> {
  closeBadgeCard();
  const seq = requestSeq;
  const loading = renderSkeleton();
  document.body.appendChild(loading);
  document.documentElement.classList.add(OPEN_CLASS);
  popover = loading;
  anchor = badge;
  viewport = scrollContainer(badge);
  const rect = badge.getBoundingClientRect();
  anchorTop = rect.top;
  anchorLeft = rect.left;
  place(loading, badge);
  followFrame = window.requestAnimationFrame(follow);

  const result = await fetchCard(page);
  if (seq !== requestSeq || popover !== loading) return;
  if (!result) {
    closeBadgeCard();
    return;
  }
  const filled = renderCard(result.card, result.url);
  filled.classList.add('tcb-bcard--settled');
  loading.replaceWith(filled);
  popover = filled;
  place(filled, badge);
}

export function initBadgeCards(fetchCard: BadgeCardFetcher): void {
  if (ready || typeof document === 'undefined') return;
  ready = true;

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.classList.contains('tcb-badge-img') && target.dataset.tcbPage) {
      event.preventDefault();
      event.stopPropagation();
      if (popover && target === anchor) closeBadgeCard();
      else void openBadgeCard(target, target.dataset.tcbPage, fetchCard);
      return;
    }
    if (popover && !(target instanceof Node && popover.contains(target))) closeBadgeCard();
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && popover) closeBadgeCard();
  });

  document.addEventListener('wheel', (event) => {
    if (popover && !(event.target instanceof Node && popover.contains(event.target))) closeBadgeCard();
  }, { passive: true });

  window.addEventListener('resize', () => {
    if (popover) closeBadgeCard();
  });
}
