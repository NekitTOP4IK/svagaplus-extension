import browser from '../../shared/browser';
import { FRONTEND_URL } from '../../shared/config';
import { getUpdateState, setUpdateState, UPDATE_STATE_KEY } from '../../shared/storage';
import { deriveNotice, dismissNotice, type UpdateNotice } from './model';
import { renderNotice, type NoticeVariant } from './render';

type Mount = (plate: HTMLElement) => boolean;

function watchNotice(variant: NoticeVariant, mount: Mount): { remount: () => void } {
  const current = browser.runtime.getManifest().version;
  let notice: UpdateNotice | null = null;
  let plate: HTMLElement | null = null;

  const dismiss = (): void => {
    const seen = notice;
    if (!seen) return;
    getUpdateState()
      .then((state) => setUpdateState(dismissNotice(state, seen, Date.now())))
      .catch(() => undefined);
  };

  const remount = (): void => {
    if (!notice || plate?.isConnected) return;
    const next = renderNotice(notice, variant, dismiss);
    if (mount(next)) plate = next;
  };

  const refresh = (): void => {
    getUpdateState()
      .then((state) => {
        notice = deriveNotice(state, current, Date.now(), FRONTEND_URL);
        plate?.remove();
        plate = null;
        remount();
      })
      .catch(() => undefined);
  };

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && UPDATE_STATE_KEY in changes) refresh();
  });
  refresh();
  return { remount };
}

function chatInput(): Element | null {
  return document.querySelector('.chat-input')
    ?? document.querySelector('[data-a-target="chat-input"]')?.closest('form')
    ?? null;
}

/** Plate above the chat input; Twitch rebuilds the chat column, so it is re-attached on DOM changes. */
export function startChatUpdateNotice(): void {
  let scheduled = false;
  const { remount } = watchNotice('compact', (plate) => {
    const input = chatInput();
    if (!input) return false;
    input.before(plate);
    return true;
  });
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      remount();
    });
  }).observe(document.body, { childList: true, subtree: true });
}

export function startPopupUpdateNotice(container: HTMLElement): void {
  watchNotice('expanded', (plate) => {
    container.replaceChildren(plate);
    return true;
  });
}
