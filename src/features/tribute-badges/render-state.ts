export type BadgeRenderState = 'pending' | 'rendered' | 'empty' | 'failed';

export function getBadgeRenderState(element: HTMLElement): BadgeRenderState | null {
  const value = element.dataset.tcbRenderState;
  return value === 'pending' || value === 'rendered' || value === 'empty' || value === 'failed'
    ? value
    : null;
}

export function shouldSkipBadgeRender(element: HTMLElement, login: string): boolean {
  if (element.dataset.tcbUserLogin !== login) return false;
  const state = getBadgeRenderState(element);
  return state === 'pending' || state === 'rendered' || state === 'empty';
}

export function beginBadgeRender(element: HTMLElement, login: string): string {
  const token = String((Number(element.dataset.tcbRenderToken || '0') || 0) + 1);
  element.dataset.tcbUserLogin = login;
  element.dataset.tcbRenderState = 'pending';
  element.dataset.tcbRenderToken = token;
  delete element.dataset.tcbDone;
  return token;
}

export function isCurrentBadgeRender(element: HTMLElement, login: string, token: string): boolean {
  return element.isConnected &&
    element.dataset.tcbUserLogin === login &&
    element.dataset.tcbRenderToken === token;
}

export function finishBadgeRender(element: HTMLElement, login: string, hadBadges: boolean): void {
  element.dataset.tcbUserLogin = login;
  element.dataset.tcbRenderState = hadBadges ? 'rendered' : 'empty';
  element.dataset.tcbDone = '1';
}

export function failBadgeRender(element: HTMLElement, login: string, token: string): void {
  if (element.dataset.tcbUserLogin !== login || element.dataset.tcbRenderToken !== token) return;
  element.dataset.tcbRenderState = 'failed';
  delete element.dataset.tcbDone;
}

export function clearBadgeRenderState(element: HTMLElement): void {
  delete element.dataset.tcbUserLogin;
  delete element.dataset.tcbRenderState;
  delete element.dataset.tcbDone;
}

export function isTributeMessageHealthy(element: HTMLElement): boolean {
  const state = getBadgeRenderState(element);
  if (state === 'pending') return true;
  if (state === 'rendered') {
    return element.querySelector('.tcb-badge-img, .tcb-badge-list, .tcb-badge-list-stv') != null;
  }
  if (state === 'empty') return true;
  return false;
}
