export interface BadgeCardData {
  kind: string;
  name: string;
  image_url: string;
  rarity: string | null;
  description: string;
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

const KIND_LABELS: Record<string, string> = {
  collectible: 'Коллекционный',
  service: 'Служебный',
  sub: 'За подписку',
  social: 'Соц. рейтинг',
};

let popover: HTMLElement | null = null;
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
  return `${card.owners} ${word}`;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function place(card: HTMLElement, anchor: Element): void {
  const rect = anchor.getBoundingClientRect();
  const width = 288;
  const left = Math.min(Math.max(8, rect.left - 16), window.innerWidth - width - 8);
  const below = rect.bottom + 8;
  card.style.left = `${left}px`;
  card.style.top = `${below}px`;
  const height = card.offsetHeight;
  if (height && below + height > window.innerHeight - 8) {
    card.style.top = `${Math.max(8, rect.top - height - 8)}px`;
  }
}

function renderCard(card: BadgeCardData, url: string): HTMLElement {
  const root = element('div', 'tcb-card');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', card.name);
  root.dataset.rarity = card.rarity || 'none';

  const head = element('div', 'tcb-card__head');
  const image = element('img', 'tcb-card__img');
  image.src = card.image_url;
  image.alt = '';
  const titles = element('div', 'tcb-card__titles');
  titles.append(element('div', 'tcb-card__name', card.name));
  titles.append(card.rarity && RARITY_LABELS[card.rarity]
    ? element('span', 'tcb-card__tag', RARITY_LABELS[card.rarity])
    : element('span', 'tcb-card__kind', KIND_LABELS[card.kind] || ''));
  head.append(image, titles);

  const foot = element('div', 'tcb-card__foot');
  const link = element('a', 'tcb-card__link', 'Страница бейджа');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  foot.append(element('span', 'tcb-card__owners', ownersText(card)), link);

  root.append(head, element('p', 'tcb-card__desc', card.description), foot);
  return root;
}

export function closeBadgeCard(): void {
  requestSeq += 1;
  popover?.remove();
  popover = null;
}

async function openBadgeCard(anchor: HTMLElement, page: string, fetchCard: BadgeCardFetcher): Promise<void> {
  closeBadgeCard();
  const seq = requestSeq;
  const loading = element('div', 'tcb-card tcb-card--loading', 'Загрузка…');
  loading.setAttribute('role', 'dialog');
  loading.setAttribute('aria-busy', 'true');
  document.body.appendChild(loading);
  popover = loading;
  place(loading, anchor);

  const result = await fetchCard(page);
  if (seq !== requestSeq || popover !== loading) return;
  if (!result) {
    closeBadgeCard();
    return;
  }
  const filled = renderCard(result.card, result.url);
  loading.replaceWith(filled);
  popover = filled;
  place(filled, anchor);
}

export function initBadgeCards(fetchCard: BadgeCardFetcher): void {
  if (ready || typeof document === 'undefined') return;
  ready = true;

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.classList.contains('tcb-badge-img') && target.dataset.tcbPage) {
      event.preventDefault();
      event.stopPropagation();
      void openBadgeCard(target, target.dataset.tcbPage, fetchCard);
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
}
