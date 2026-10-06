import type { NoticeLink, UpdateNotice } from './model';

export type NoticeVariant = 'compact' | 'expanded';

const SVG_NS = 'http://www.w3.org/2000/svg';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function anchor(link: NoticeLink, className: string, onClick: () => void): HTMLAnchorElement {
  const node = element('a', className, link.label);
  node.href = link.url;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  node.addEventListener('click', onClick);
  return node;
}

function closeButton(onDismiss: () => void): HTMLButtonElement {
  const button = element('button', 'svp-notice__close');
  button.type = 'button';
  button.setAttribute('aria-label', 'Скрыть');
  const icon = document.createElementNS(SVG_NS, 'svg');
  icon.setAttribute('width', '12');
  icon.setAttribute('height', '12');
  icon.setAttribute('viewBox', '0 0 12 12');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M2 2l8 8M10 2l-8 8');
  icon.append(path);
  button.append(icon);
  button.addEventListener('click', onDismiss);
  return button;
}

/**
 * Builds the notice plate. `onDismiss` fires on the close button and on the
 * "what's new" link of a success notice: both mean the user has seen it.
 */
export function renderNotice(notice: UpdateNotice, variant: NoticeVariant, onDismiss: () => void): HTMLElement {
  const root = element('div', `svp-notice svp-notice--${notice.tone} svp-notice--${variant}`);
  root.setAttribute('role', 'status');
  root.lang = 'ru';
  const body = element('div', 'svp-notice__body');
  root.append(element('span', 'svp-notice__bar'), body);

  const seen = notice.tone === 'success' ? onDismiss : () => undefined;
  const button = notice.action ? anchor(notice.action, 'svp-notice__btn', seen) : null;
  const link = notice.link ? anchor(notice.link, 'svp-notice__link', seen) : null;

  if (variant === 'compact') {
    const line = element('span', 'svp-notice__line');
    line.append(element('span', 'svp-notice__ver', `v${notice.version}`), element('span', 'svp-notice__text', notice.text));
    body.append(line);
    const primary = button ?? link;
    if (primary) body.append(primary);
    body.append(closeButton(onDismiss));
    return root;
  }

  const top = element('div', 'svp-notice__top');
  const version = notice.fromVersion ? `v${notice.fromVersion} → v${notice.version}` : `v${notice.version}`;
  top.append(element('span', 'svp-notice__ver', version), closeButton(onDismiss));
  const actions = element('div', 'svp-notice__actions');
  if (button) actions.append(button);
  if (link) actions.append(link);
  body.append(top, element('div', 'svp-notice__title', notice.text), actions);
  return root;
}
