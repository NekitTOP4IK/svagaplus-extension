import browser from 'webextension-polyfill';
import { DetectedCard } from './card-detector';
import { getChannelGrantsForLogin } from './api';
import { ActiveBadgeGrant, RatingData } from './types';

declare const __FRONTEND_URL__: string;

const BADGE_ATTR = 'data-tsr-badge';
const SCORE_ATTR = 'data-tsr-score';
const SWAG_SCORE_ATTR = 'data-tsr-swag-score';
const SOCIAL_SCORE_ATTR = 'data-tsr-social-score';
const LABEL_ATTR = 'data-tsr-label';
const CHANNEL_ATTR = 'data-tsr-channel';

// ── Style injection ───────────────────────────────────────────────────────────

function ensureBadgeStyle(): void {
  if (document.getElementById('tsr-badge-style')) return;
  const style = document.createElement('style');
  style.id = 'tsr-badge-style';
  style.textContent = `
    [data-tsr-badge] {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      grid-column: 1 / -1;
      gap: 5px;
      padding: 8px 12px 8px 15px;
      background: var(--tsr-bg, #18181b);
      border-top: 1px solid var(--tsr-border, #2a2a2d);
      border-bottom: 1px solid var(--tsr-divider, #303035);
      position: relative;
      flex-shrink: 0;
      overflow: hidden;
      width: 100%;
    }
    [data-tsr-badge] .tsr-stripe {
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: 3px;
      pointer-events: none;
    }
    [data-tsr-badge] .tsr-row {
      display: flex;
      align-items: center;
      gap: 6px;
      position: relative;
      z-index: 1;
    }
    [data-tsr-badge] [data-tsr-label] {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      line-height: 1;
      flex: 1;
    }
    [data-tsr-badge] .tsr-link {
      font-size: 11px;
      font-weight: 500;
      color: var(--tsr-muted, #d1d1dc);
      text-decoration: none;
      flex-shrink: 0;
      transition: color 0.12s;
    }
    [data-tsr-badge] .tsr-link:hover { color: var(--tsr-text, #efeff1); }
    [data-tsr-badge] [data-tsr-score] {
      font-size: 26px;
      font-weight: 700;
      font-family: ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, 'Courier New', monospace;
      font-variant-numeric: tabular-nums;
      line-height: 1;
      flex: 1;
    }
    [data-tsr-badge] .tsr-awards {
      display: grid;
      gap: 4px;
      position: relative;
      z-index: 1;
    }
    [data-tsr-badge] .tsr-award {
      display: grid;
      grid-template-columns: 24px 1fr auto;
      align-items: center;
      gap: 8px;
      min-height: 34px;
      padding: 6px 8px;
      border: 1px solid var(--tsr-border, #2a2a2d);
      border-left-width: 3px;
      background: var(--tsr-award-bg, #202024);
    }
    [data-tsr-badge] .tsr-award--high {
      border-left-color: #d6a43a;
      background: linear-gradient(90deg, rgba(214,164,58,0.12), var(--tsr-award-bg, #202024) 48%);
    }
    [data-tsr-badge] .tsr-award--low {
      border-left-color: #b94a4a;
      background: linear-gradient(90deg, rgba(185,74,74,0.13), var(--tsr-award-bg, #202024) 48%);
    }
    [data-tsr-badge] .tsr-award__mark {
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--tsr-muted, #d1d1dc);
      font-size: 15px;
      font-weight: 800;
      line-height: 1;
    }
    [data-tsr-badge] .tsr-award__mark img {
      width: 24px;
      height: 24px;
      object-fit: contain;
      display: block;
    }
    [data-tsr-badge] .tsr-award__copy {
      min-width: 0;
      display: grid;
      gap: 1px;
    }
    [data-tsr-badge] .tsr-award__title {
      color: var(--tsr-text, #efeff1);
      font-size: 11px;
      font-weight: 800;
      line-height: 1.2;
      letter-spacing: 0.01em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    [data-tsr-badge] .tsr-award__text {
      color: var(--tsr-muted, #d1d1dc);
      font-size: 10px;
      font-weight: 600;
      line-height: 1.25;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    [data-tsr-badge] .tsr-award__rank {
      font-family: ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, 'Courier New', monospace;
      font-size: 10px;
      font-weight: 800;
      line-height: 1;
      padding: 4px 6px;
      border: 1px solid var(--tsr-border-strong, #3a3a3d);
      color: var(--tsr-text, #efeff1);
      background: var(--tsr-rank-bg, #111114);
    }
    [data-tsr-badge] .tsr-vote-btn {
      border-radius: 0;
      height: 24px;
      width: 24px;
      padding: 0;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      user-select: none;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      background: transparent;
      transition: background 0.12s, border-color 0.12s;
    }
    [data-tsr-badge] .tsr-vote-btn:disabled { opacity: 0.4; cursor: default; }
    [data-tsr-badge] [data-tsr-toast] {
      font-size: 11px;
      font-weight: 600;
      line-height: 1.4;
      word-break: break-word;
      position: relative;
      z-index: 1;
    }
  `;
  document.head.appendChild(style);
}

// ── 7TV CSS fix ───────────────────────────────────────────────────────────────

function ensureSeventvStyle(): void {
  if (document.getElementById('tsr-seventv-style')) return;
  const style = document.createElement('style');
  style.id = 'tsr-seventv-style';
  style.textContent = `
    .seventv-user-card-container:has([data-tsr-badge]) .seventv-user-card {
      max-height: 80vh !important;
      overflow: hidden !important;
    }
    .seventv-user-card-container:has([data-tsr-badge]) .seventv-user-card-data {
      min-height: 0 !important;
      overflow: hidden !important;
    }
    .seventv-user-card-container:has([data-tsr-badge]) .seventv-user-card-data .scrollable-container {
      min-height: 0 !important;
      overflow-y: auto !important;
    }
    .seventv-user-card-container:has([data-tsr-badge]) .seventv-user-card-interactive {
      grid-template-rows: auto auto auto auto !important;
      grid-template-areas: "metrics" "actions" "tsr-rating" "mod" !important;
    }
    .seventv-usercard:has([data-tsr-badge]) {
      display: flex !important;
      flex-direction: column !important;
      max-height: 80vh !important;
      overflow: hidden !important;
    }
    .seventv-usercard:has([data-tsr-badge]) [data-tsr-badge],
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-mod-actions,
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-tabs {
      flex: 0 0 auto !important;
    }
    .seventv-usercard:has([data-tsr-badge]) [data-tsr-badge] {
      z-index: 1 !important;
    }
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-body,
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-tab-content,
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-tabs ~ * {
      flex: 1 1 auto !important;
      min-height: 0 !important;
      overflow-x: hidden !important;
      overflow-y: auto !important;
    }
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-body [class*="message"],
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-body [class*="scroll"],
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-body .scrollable-container,
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-tab-content [class*="message"],
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-tab-content [class*="scroll"],
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-tab-content .scrollable-container,
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-tabs ~ * [class*="message"],
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-tabs ~ * [class*="scroll"],
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-tabs ~ * .scrollable-container {
      flex: 1 1 auto !important;
      min-height: 0 !important;
      max-height: 100% !important;
    }
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-body [class*="message-list"],
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-body [class*="messages"],
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-body [class*="timeline"],
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-body .scrollable-container,
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-tab-content [class*="message-list"],
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-tab-content [class*="messages"],
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-tab-content [class*="timeline"],
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-tab-content .scrollable-container,
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-tabs ~ * [class*="message-list"],
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-tabs ~ * [class*="messages"],
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-tabs ~ * [class*="timeline"],
    .seventv-usercard:has([data-tsr-badge]) .seventv-usercard-tabs ~ * .scrollable-container {
      overflow-y: auto !important;
    }
  `;
  document.head.appendChild(style);
}

// ── Label helpers ─────────────────────────────────────────────────────────────

const WARN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;vertical-align:middle"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

const PLUS_ONE_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="1" width="22" height="22" rx="3" stroke="#0FEE9F" stroke-width="1.2" fill="none"/>
  <text x="12" y="12" font-family="sans-serif" font-size="12" font-weight="bold" fill="#0FEE9F" text-anchor="middle" dominant-baseline="central">+1</text>
</svg>`;

const MINUS_ONE_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="1" width="22" height="22" rx="3" stroke="#EC5B5B" stroke-width="1.2" fill="none"/>
  <text x="12" y="12" font-family="sans-serif" font-size="12" font-weight="bold" fill="#EC5B5B" text-anchor="middle" dominant-baseline="central">-1</text>
</svg>`;

function labelText(channel: string, isLow: boolean): string {
  const prefix = channel ? `${channel} / ` : '';
  return `${prefix}${isLow ? 'Низкий рейтинг' : 'Свагометр (соц. рейтинг)'}`;
}

function setLabel(el: HTMLElement, channel: string, isLow: boolean): void {
  el.style.color = isLow ? '#ff5252' : 'var(--tsr-muted, #d1d1dc)';
  el.innerHTML = isLow
    ? `${WARN_SVG}<span>${labelText(channel, true)}</span>`
    : `<span>${labelText(channel, false)}</span>`;
}

function awardTitle(grant: ActiveBadgeGrant): string {
  return grant.kind === 'high' ? 'Пупсик чата' : 'Напёрдыш чата';
}

function awardText(grant: ActiveBadgeGrant): string {
  return grant.period_label ? `за ${grant.period_label}` : 'за закрытый период';
}

function sortAwards(grants: ActiveBadgeGrant[]): ActiveBadgeGrant[] {
  return [...grants].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'high' ? -1 : 1;
    return a.rank - b.rank;
  });
}

function createAwardCard(grant: ActiveBadgeGrant): HTMLElement {
  const item = document.createElement('div');
  item.className = `tsr-award tsr-award--${grant.kind}`;
  item.title = grant.title;

  const mark = document.createElement('div');
  mark.className = 'tsr-award__mark';
  if (grant.image_url) {
    const img = document.createElement('img');
    img.alt = grant.title;
    img.onerror = () => {
      img.remove();
      mark.textContent = grant.kind === 'high' ? '★' : '!';
    };
    mark.appendChild(img);
    if (grant.image_url.startsWith('http://')) {
      browser.runtime.sendMessage({ type: 'FETCH_IMAGE', url: grant.image_url })
        .then((res: any) => { if (res?.dataUrl) img.src = res.dataUrl; })
        .catch(() => { mark.textContent = grant.kind === 'high' ? '★' : '!'; });
    } else {
      img.src = grant.image_url;
    }
  } else {
    mark.textContent = grant.kind === 'high' ? '★' : '!';
  }

  const copy = document.createElement('div');
  copy.className = 'tsr-award__copy';

  const title = document.createElement('div');
  title.className = 'tsr-award__title';
  title.textContent = awardTitle(grant);

  const text = document.createElement('div');
  text.className = 'tsr-award__text';
  text.textContent = awardText(grant);

  const rank = document.createElement('div');
  rank.className = 'tsr-award__rank';
  rank.textContent = `#${grant.rank}`;

  copy.appendChild(title);
  copy.appendChild(text);
  item.appendChild(mark);
  item.appendChild(copy);
  item.appendChild(rank);
  return item;
}

async function renderAwards(
  container: HTMLElement,
  channelLogin: string,
  login: string,
  before?: Element | null,
): Promise<void> {
  if (!channelLogin || !login) return;
  container.querySelectorAll('.tsr-awards').forEach((el) => el.remove());
  const grants = sortAwards(await getChannelGrantsForLogin(channelLogin, login));
  if (grants.length === 0) return;

  const awards = document.createElement('div');
  awards.className = 'tsr-awards';
  for (const grant of grants.slice(0, 2)) {
    awards.appendChild(createAwardCard(grant));
  }
  if (before?.parentElement === container) {
    container.insertBefore(awards, before);
  } else {
    container.appendChild(awards);
  }
}

// ── Score helpers ─────────────────────────────────────────────────────────────

function scoreFg(score: number): string {
  if (score > 0) return '#00e676';
  if (score < 0) return '#ff5252';
  return '#adadb8';
}

function scoreAccent(score: number): string {
  if (score > 0) return '#00e676';
  if (score < 0) return '#ff5252';
  return '#3a3a3d';
}

function scoreText(score: number): string {
  if (score > 0) return `+${score}`;
  return `${score}`;
}

function renderDualScore(el: HTMLElement, swag: number, social: number): void {
  el.setAttribute(SWAG_SCORE_ATTR, String(swag));
  el.setAttribute(SOCIAL_SCORE_ATTR, String(social));
  el.style.color = scoreFg(swag);
  el.innerHTML =
    `<span>${scoreText(swag)}</span>` +
    `<span style="font-size:0.55em;color:${scoreFg(social)};opacity:0.8;margin-left:4px;font-weight:600">(${scoreText(social)})</span>`;
}

function readStoredScore(el: HTMLElement, attr: string, fallback: number): number {
  const raw = el.getAttribute(attr);
  if (raw == null) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : fallback;
}

function readVisibleSocialScore(el: HTMLElement): number {
  const raw = el.querySelector('span:nth-child(2)')?.textContent?.trim() ?? '';
  const value = Number(raw.replace(/[()]/g, ''));
  return Number.isSafeInteger(value) ? value : 0;
}

function formatNextVoteDate(ts: number): string {
  return new Date(ts).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatHttpError(error: string): string | null {
  if (/^5\d\d$/.test(error)) return 'Внутренняя ошибка сервера, попробуйте позже';
  if (error === '404') return 'Не найдено';
  if (error === '403') return 'Нет доступа';
  if (error === '401') return 'Не авторизован — войди через иконку расширения';
  return null;
}

function formatVoteError(error: string, nextVoteAt?: number): string {
  if (error.includes('24 hours') || error === '429') {
    const ts = nextVoteAt ? nextVoteAt * 1000 : Date.now() + 86400000;
    return `Подожди! Следующее голосование ${formatNextVoteDate(ts)}`;
  }
  if (error.includes('yourself')) return 'Нельзя голосовать за себя';
  if (error.includes('below zero')) return 'Твой рейтинг < 10 — голосование заблокировано';
  if (error === 'not_authenticated') return 'Не авторизован — войди через иконку расширения';
  if (error === 'network_error') return 'Ошибка сети';
  if (error.includes('not enabled for this channel')) return 'Система рейтинга не включена на этом канале';
  return formatHttpError(error) ?? (error.length < 80 ? error : 'Ошибка голосования');
}

function showToast(container: HTMLElement, text: string, type: 'ok' | 'warn' | 'err'): void {
  container.querySelector('[data-tsr-toast]')?.remove();
  const el = document.createElement('div');
  el.setAttribute('data-tsr-toast', '');
  el.style.color = type === 'ok' ? '#00e676' : type === 'warn' ? '#ffb300' : '#ff5252';
  el.textContent = text;
  container.appendChild(el);
  const t = setTimeout(() => el.remove(), 3500);
  el.addEventListener('click', () => { clearTimeout(t); el.remove(); });
}

function makeVoteBtn(label: string, tint: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'tsr-vote-btn';
  btn.innerHTML = label;
  btn.style.cssText = `border:1px solid ${tint}50;color:${tint};`;
  btn.addEventListener('mouseover', () => {
    if (btn.disabled) return;
    btn.style.background = `${tint}20`;
    btn.style.borderColor = tint;
  });
  btn.addEventListener('mouseout', () => {
    if (btn.disabled) return;
    btn.style.background = 'transparent';
    btn.style.borderColor = `${tint}50`;
  });
  return btn;
}

type BadgeTheme = {
  bg: string;
  border: string;
  borderStrong: string;
  divider: string;
  text: string;
  muted: string;
  awardBg: string;
  rankBg: string;
};

function badgeTheme(card: DetectedCard): BadgeTheme {
  if (card.type === 'seventv') {
    if (card.element.classList.contains('seventv-usercard')) {
      return {
        bg: '#232325',
        border: '#343438',
        borderStrong: '#48484d',
        divider: '#3a3a3f',
        text: '#f3f3f6',
        muted: '#d7d7df',
        awardBg: '#2b2b2f',
        rankBg: '#1d1d20',
      };
    }

    return {
      bg: '#0f0f0f',
      border: '#29292c',
      borderStrong: '#3d3d42',
      divider: '#262629',
      text: '#f0f0f3',
      muted: '#c7c7d1',
      awardBg: '#18181b',
      rankBg: '#09090a',
    };
  }

  return {
    bg: '#18181b',
    border: '#2a2a2d',
    borderStrong: '#3a3a3d',
    divider: '#303035',
    text: '#efeff1',
    muted: '#d1d1dc',
    awardBg: '#202024',
    rankBg: '#111114',
  };
}

function applyBadgeTheme(wrap: HTMLElement, card: DetectedCard): void {
  const theme = badgeTheme(card);
  wrap.style.setProperty('--tsr-bg', theme.bg);
  wrap.style.setProperty('--tsr-border', theme.border);
  wrap.style.setProperty('--tsr-border-strong', theme.borderStrong);
  wrap.style.setProperty('--tsr-divider', theme.divider);
  wrap.style.setProperty('--tsr-text', theme.text);
  wrap.style.setProperty('--tsr-muted', theme.muted);
  wrap.style.setProperty('--tsr-award-bg', theme.awardBg);
  wrap.style.setProperty('--tsr-rank-bg', theme.rankBg);
}

// ── Injection target ──────────────────────────────────────────────────────────

function findTarget(card: DetectedCard): { el: Element; how: 'append' | 'insertAfter' | 'insertBefore'; gridArea?: string } | null {
  if (card.type === 'seventv') {
    ensureSeventvStyle();
    const newTabs = card.element.querySelector('.seventv-usercard-tabs');
    if (newTabs) return { el: newTabs, how: 'insertBefore' };
    const newBody = card.element.querySelector('.seventv-usercard-body');
    if (newBody) return { el: newBody, how: 'insertBefore' };
    const newContent = card.element.querySelector(
      '.seventv-usercard-tab-content, .seventv-usercard-message-list, [class*="usercard"][class*="message"], [class*="usercard"][class*="history"], [class*="usercard"][class*="timeline"]',
    );
    if (newContent) return { el: newContent, how: 'insertBefore' };
    const interactive = card.element.querySelector('.seventv-user-card-interactive');
    if (interactive) return { el: interactive, how: 'append', gridArea: 'tsr-rating' };
    const identity = card.element.querySelector('.seventv-user-card-identity');
    if (identity) return { el: identity, how: 'append' };
    return { el: card.element, how: 'append' };
  }

  const viewerCard = card.element.querySelector('.viewer-card');
  if (viewerCard) {
    const headerBg = viewerCard.querySelector('.viewer-card-header__background');
    const afterHeader = headerBg?.nextElementSibling ?? null;
    if (afterHeader) return { el: afterHeader, how: 'insertBefore' };
    return { el: viewerCard, how: 'append' };
  }

  const inner =
    card.element.querySelector('[data-a-target="viewer-card-body"]') ??
    card.element.querySelector('.viewer-card__card-area') ??
    card.element.children[0];

  if (inner) return { el: inner, how: 'append' };
  return null;
}

// ── Main badge injection ──────────────────────────────────────────────────────

export async function injectBadge(
  card: DetectedCard,
  rating: RatingData | null,
  channelLogin: string,
): Promise<void> {
  ensureBadgeStyle();
  card.element.querySelector(`[${BADGE_ATTR}]`)?.remove();

  const swagScore = rating?.swag_score ?? rating?.score ?? 0;
  let socialScore = rating?.social_score ?? 0;
  const score = swagScore;
  const isLow = rating?.isLowRating ?? score < 0;
  const accent = scoreAccent(score);

  const wrap = document.createElement('div');
  wrap.setAttribute(BADGE_ATTR, card.login);
  if (channelLogin) wrap.setAttribute(CHANNEL_ATTR, channelLogin);
  applyBadgeTheme(wrap, card);

  const stripe = document.createElement('div');
  stripe.className = 'tsr-stripe';
  stripe.style.cssText = `background:${accent};box-shadow:4px 0 16px 4px ${accent}30,2px 0 6px 2px ${accent}50;`;
  wrap.appendChild(stripe);

  const topRow = document.createElement('div');
  topRow.className = 'tsr-row';

  const label = document.createElement('span');
  label.setAttribute(LABEL_ATTR, '');
  setLabel(label, channelLogin, isLow);
  topRow.appendChild(label);

  wrap.appendChild(topRow);

  await renderAwards(wrap, channelLogin, card.login);

  const bottomRow = document.createElement('div');
  bottomRow.className = 'tsr-row';

  const scoreEl = document.createElement('span');
  scoreEl.setAttribute(SCORE_ATTR, '');
  renderDualScore(scoreEl, swagScore, socialScore);
  bottomRow.appendChild(scoreEl);

  const account = (await browser.runtime
    .sendMessage({ type: 'viewer:getAccount' })
    .catch(() => ({ ok: false, account: null }))) as {
    ok: boolean;
    account: { twitchLogin?: string | null } | null;
  };
  const isAuthed = !!account?.ok && !!account.account?.twitchLogin;
  const isSelf = account.account?.twitchLogin != null && account.account.twitchLogin.toLowerCase() === card.login.toLowerCase();

  if (isAuthed && !isSelf) {
    const plusBtn = makeVoteBtn(PLUS_ONE_SVG, '#0FEE9F');
    plusBtn.style.border = 'none';
    plusBtn.style.color = '';
    const minusBtn = makeVoteBtn(MINUS_ONE_SVG, '#EC5B5B');
    minusBtn.style.border = 'none';
    minusBtn.style.color = '';

    const handleVote = async (value: 1 | -1) => {
      const activeBtn = value === 1 ? plusBtn : minusBtn;
      const otherBtn = value === 1 ? minusBtn : plusBtn;
      const original = activeBtn.innerHTML;

      plusBtn.disabled = true;
      minusBtn.disabled = true;
      activeBtn.innerHTML = '…';
      otherBtn.style.opacity = '0.35';

      const res = (await browser.runtime
        .sendMessage({ type: 'CAST_VOTE', login: card.login, channelLogin, value })
        .catch(() => ({ ok: false, error: 'network_error' }))) as {
        ok: boolean;
        score?: number;
        social_score?: number;
        error?: string;
        nextVoteAt?: number;
      };

      plusBtn.disabled = false;
      minusBtn.disabled = false;
      activeBtn.innerHTML = original;
      otherBtn.style.opacity = '1';

      if (res.ok && res.score !== undefined) {
        const ns = res.score;
        socialScore = res.social_score ?? socialScore;
        const newAccent = scoreAccent(ns);
        stripe.style.background = newAccent;
        stripe.style.boxShadow = `4px 0 16px 4px ${newAccent}30,2px 0 6px 2px ${newAccent}50`;
        renderDualScore(scoreEl, ns, socialScore);
        setLabel(label, channelLogin, ns < 0);
        const nextTs = res.nextVoteAt ? res.nextVoteAt * 1000 : Date.now() + 86400000;
        showToast(wrap, `Голос принят. Свагометр ${scoreText(ns)}. Следующее голосование ${formatNextVoteDate(nextTs)}`, 'ok');
      } else {
        const msg = formatVoteError(res.error ?? '', res.nextVoteAt);
        showToast(wrap, msg, msg.startsWith('Подожди') ? 'warn' : 'err');
      }
    };

    plusBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); handleVote(1); });
    minusBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); handleVote(-1); });

    bottomRow.appendChild(plusBtn);
    bottomRow.appendChild(minusBtn);

  }

  wrap.appendChild(bottomRow);

  const target = findTarget(card);
  if (!target) return;

  if (target.gridArea) wrap.style.gridArea = target.gridArea;

  wrap.style.opacity = '0';
  wrap.style.transition = 'opacity 0.2s ease';

  if (target.how === 'insertAfter') {
    target.el.insertAdjacentElement('afterend', wrap);
  } else if (target.how === 'insertBefore') {
    target.el.insertAdjacentElement('beforebegin', wrap);
  } else {
    target.el.appendChild(wrap);
  }

  requestAnimationFrame(() => { wrap.style.opacity = '1'; });
}

// ── Live update from WebSocket ────────────────────────────────────────────────

export function updateBadgeScore(login: string, score: number, socialScore?: number): void {
  const wrap = document.querySelector<HTMLElement>(`[${BADGE_ATTR}="${CSS.escape(login)}"]`);
  if (!wrap) return;

  const stripe = wrap.querySelector<HTMLElement>('.tsr-stripe');
  if (stripe) {
    const accent = scoreAccent(score);
    stripe.style.background = accent;
    stripe.style.boxShadow = `4px 0 16px 4px ${accent}30,2px 0 6px 2px ${accent}50`;
  }

  const scoreEl = wrap.querySelector<HTMLElement>(`[${SCORE_ATTR}]`);
  if (scoreEl) {
    const nextSocialScore = socialScore ?? readStoredScore(scoreEl, SOCIAL_SCORE_ATTR, readVisibleSocialScore(scoreEl));
    renderDualScore(scoreEl, score, nextSocialScore);
  }

  const labelEl = wrap.querySelector<HTMLElement>(`[${LABEL_ATTR}]`);
  if (labelEl) {
    setLabel(labelEl, wrap.getAttribute(CHANNEL_ATTR) ?? '', score < 0);
  }
}

export async function refreshOpenCardAwards(channelLogin: string): Promise<void> {
  const wraps = Array.from(
    document.querySelectorAll<HTMLElement>(`[${BADGE_ATTR}][${CHANNEL_ATTR}="${CSS.escape(channelLogin)}"]`),
  );

  for (const wrap of wraps) {
    const login = wrap.getAttribute(BADGE_ATTR) ?? '';
    const rows = wrap.querySelectorAll('.tsr-row');
    await renderAwards(wrap, channelLogin, login, rows[1] ?? null);
  }
}
