import { closeButton, element } from '../update-notice/render';
import { iconSvg } from './icons';
import { formatMaintenanceMeta, formatMaintenanceRange, type Banner, type BannerType } from './model';
import { renderMarkdown } from './markdown';

export type BannerVariant = 'compact' | 'expanded';

const STATUS_URL = 'https://status.svagaplus.com';

const TYPE_LABELS: Record<BannerType, string> = {
  info: 'Информация',
  tip: 'Совет',
  announcement: 'Объявление',
  success: 'Успех',
  warning: 'Предупреждение',
  danger: 'Важное',
  maintenance: 'Техработы',
};

const AFFECTED_LABELS: Record<string, string> = {
  obs_alerts: 'OBS-алерты',
  chat_badges: 'Бейджи в чате',
  dashboard: 'Панель',
  tribute_webhooks: 'Вебхуки Tribute',
  extension: 'Расширение',
};

function statusLink(label: string): HTMLAnchorElement {
  const link = element('a', 'svp-notice__link', label);
  link.href = STATUS_URL;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function affectedChips(banner: Banner): HTMLElement | null {
  const m = banner.maintenance;
  if (!m) return null;
  const labels = m.affected.map((key) => AFFECTED_LABELS[key]).filter((label): label is string => label !== undefined);
  if (m.affectedExtra) labels.push(m.affectedExtra);
  if (labels.length === 0) return null;
  const chips = element('div', 'svp-notice__chips');
  for (const label of labels) chips.append(element('span', 'svp-notice__chip', label));
  return chips;
}

function canDismiss(banner: Banner, now: number): boolean {
  if (!banner.dismissible) return false;
  const m = banner.maintenance;
  return !(m && now >= m.startsAt && now < m.endsAt);
}

export function renderBanner(
  banner: Banner,
  variant: BannerVariant,
  now: number,
  frontendUrl: string,
  onDismiss: () => void,
): HTMLElement {
  const root = element('div', `svp-notice svp-notice--${banner.type} svp-notice--${variant} svp-notice--wrap`);
  root.setAttribute('role', 'status');
  root.lang = 'ru';
  const body = element('div', 'svp-notice__body');
  root.append(element('span', 'svp-notice__bar'), body);

  const m = banner.maintenance;
  const close = canDismiss(banner, now) ? closeButton(onDismiss) : null;

  if (variant === 'compact') {
    body.append(iconSvg(banner.type, TYPE_LABELS[banner.type]));
    if (m) body.append(element('span', 'svp-notice__ver', formatMaintenanceMeta(m, now)));
    const text = banner.title ?? banner.message;
    body.append(element('span', 'svp-notice__text', m ? `Техработы — ${text}` : text));
    if (close) body.append(close);
    return root;
  }

  body.classList.add('svp-notice__body--stack');
  const top = element('div', 'svp-notice__top');
  const heading = element('span', 'svp-notice__heading');
  if (m) {
    heading.append(
      iconSvg(banner.type, null),
      element('span', 'svp-notice__kind', TYPE_LABELS.maintenance),
      element('span', 'svp-notice__ver', formatMaintenanceRange(m)),
    );
  } else {
    heading.append(iconSvg(banner.type, TYPE_LABELS[banner.type]));
  }
  top.append(heading);
  if (close) top.append(close);
  body.append(top);

  if (banner.title) body.append(element('div', 'svp-notice__title', banner.title));
  const message = element('div', 'svp-notice__message');
  message.append(renderMarkdown(banner.message, frontendUrl));
  body.append(message);

  const chips = affectedChips(banner);
  if (chips) body.append(chips);
  if (m) {
    const actions = element('div', 'svp-notice__actions');
    actions.append(statusLink('Статус сервиса ↗'));
    body.append(actions);
  }
  return root;
}

export function renderConnectionLost(secondsLeft: number | null, onDismiss: () => void): HTMLElement {
  const root = element('div', 'svp-notice svp-notice--offline svp-notice--compact svp-notice--wrap');
  root.setAttribute('role', 'status');
  root.lang = 'ru';
  const body = element('div', 'svp-notice__body');
  root.append(element('span', 'svp-notice__bar'), body);

  const lines = element('span', 'svp-notice__lines');
  lines.append(element('span', 'svp-notice__text', 'Потеряно соединение с сервером.'));
  const second = element('span', 'svp-notice__sub');
  if (secondsLeft !== null) second.append(element('span', 'svp-notice__muted', `Повтор через ${secondsLeft} с…`));
  second.append(statusLink('Статус ↗'));
  lines.append(second);

  body.append(iconSvg('offline', null), lines, closeButton(onDismiss));
  return root;
}
