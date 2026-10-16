import browser from '../../shared/browser';
import { FRONTEND_URL } from '../../shared/config';
import { getUpdateState, setUpdateState, UPDATE_STATE_KEY } from '../../shared/storage';
import { deriveNotice, dismissNotice, type UpdateNotice } from './model';
import { renderNotice } from './render';

export function startPopupUpdateNotice(container: HTMLElement): void {
  const current = browser.runtime.getManifest().version;
  let notice: UpdateNotice | null = null;

  const dismiss = (): void => {
    const seen = notice;
    if (!seen) return;
    getUpdateState()
      .then((state) => setUpdateState(dismissNotice(state, seen, Date.now())))
      .catch(() => undefined);
  };

  const refresh = (): void => {
    getUpdateState()
      .then((state) => {
        notice = deriveNotice(state, current, Date.now(), FRONTEND_URL);
        if (notice) container.replaceChildren(renderNotice(notice, 'expanded', dismiss));
        else container.replaceChildren();
      })
      .catch(() => undefined);
  };

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && UPDATE_STATE_KEY in changes) refresh();
  });
  refresh();
}
