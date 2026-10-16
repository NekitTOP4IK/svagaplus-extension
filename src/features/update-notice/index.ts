import browser from '../../shared/browser';
import { FRONTEND_URL } from '../../shared/config';
import { getUpdateState, setUpdateState, UPDATE_STATE_KEY } from '../../shared/storage';
import { deriveNotice, dismissNotice, type UpdateNotice } from './model';
import { renderNotice, type NoticeVariant } from './render';

type Mount = (plate: HTMLElement) => boolean;

function watchNotice(variant: NoticeVariant, mount: Mount): void {
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
}

export function startPopupUpdateNotice(container: HTMLElement): void {
  watchNotice('expanded', (plate) => {
    container.replaceChildren(plate);
    return true;
  });
}
