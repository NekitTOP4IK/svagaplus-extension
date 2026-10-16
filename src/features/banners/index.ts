import browser from '../../shared/browser';
import { FRONTEND_URL } from '../../shared/config';
import { getSharedSocket, type ConnectionState } from '../../shared/socket';
import {
  BANNER_DISMISSED_KEY,
  BANNER_STATE_KEY,
  UPDATE_STATE_KEY,
  getBannerState,
  getUpdateState,
  setBannerDismissed,
  setUpdateState,
} from '../../shared/storage';
import { deriveNotice, dismissNotice, EMPTY_UPDATE_STATE, type UpdateNotice, type UpdateState } from '../update-notice/model';
import { renderNotice } from '../update-notice/render';
import {
  EMPTY_BANNER_STATE,
  dismissBanner,
  maintenancePhase,
  pickChatPlate,
  visibleBanners,
  type BannerState,
  type ChatPlate,
} from './model';
import { renderBanner, renderConnectionLost, retryLabel } from './render';

const CONNECTION_LOST_AFTER_FAILURES = 3;
const RECHECK_MS = 60_000;
const COUNTDOWN_MS = 1000;

interface Mounted {
  key: string;
  plate: HTMLElement;
}

function chatInput(): Element | null {
  return document.querySelector('.chat-input')
    ?? document.querySelector('[data-a-target="chat-input"]')?.closest('form')
    ?? null;
}

function dismissById(id: number): void {
  getBannerState()
    .then((state) => setBannerDismissed(dismissBanner(state, id).dismissed))
    .catch(() => undefined);
}

function secondsUntil(retryAt: number | null, now: number): number | null {
  return retryAt === null ? null : Math.max(0, Math.ceil((retryAt - now) / 1000));
}

function bannersChanged(changes: Record<string, unknown>): boolean {
  return BANNER_STATE_KEY in changes || BANNER_DISMISSED_KEY in changes;
}

/**
 * One plate above the chat input. Twitch rebuilds the chat column, so the plate
 * is re-attached on DOM changes; the connection state stays in this tab only.
 */
export function startChatNotices(): void {
  const currentVersion = browser.runtime.getManifest().version;
  const socket = getSharedSocket();

  let banners: BannerState = EMPTY_BANNER_STATE;
  let updates: UpdateState = EMPTY_UPDATE_STATE;
  let connection: ConnectionState = socket?.state() ?? { connected: true, failedAttempts: 0, nextRetryAt: null };
  let connectionHidden = false;
  let mounted: Mounted | null = null;
  let countdown: number | null = null;
  let generation = 0;

  const dismissUpdate = (notice: UpdateNotice): void => {
    getUpdateState()
      .then((state) => setUpdateState(dismissNotice(state, notice, Date.now())))
      .catch(() => undefined);
  };

  const stopCountdown = (): void => {
    if (countdown === null) return;
    window.clearInterval(countdown);
    countdown = null;
  };

  const place = (): void => {
    if (!mounted || mounted.plate.isConnected) return;
    chatInput()?.before(mounted.plate);
  };

  const build = (plate: ChatPlate, now: number): HTMLElement => {
    switch (plate.kind) {
      case 'update':
        return renderNotice(plate.notice, 'compact', () => dismissUpdate(plate.notice));
      case 'banner':
        return renderBanner(plate.banner, 'compact', now, FRONTEND_URL, () => dismissById(plate.banner.id));
      case 'connection':
        return renderConnectionLost(secondsUntil(plate.retryAt, now), () => {
          connectionHidden = true;
          render();
        });
    }
  };

  const keyOf = (plate: ChatPlate, now: number): string => {
    switch (plate.kind) {
      case 'update':
        return `update:${plate.notice.tone}:${plate.notice.version}`;
      case 'banner': {
        const { maintenance } = plate.banner;
        const phase = maintenance ? maintenancePhase(maintenance, now) : '';
        return `banner:${plate.banner.id}:${banners.snapshot?.revision}:${phase}`;
      }
      case 'connection':
        return 'connection';
    }
  };

  function render(): void {
    const now = Date.now();
    const lost = !connectionHidden && !connection.connected && connection.failedAttempts >= CONNECTION_LOST_AFTER_FAILURES;
    const chosen = pickChatPlate({
      update: deriveNotice(updates, currentVersion, now, FRONTEND_URL),
      connectionLost: lost,
      retryAt: connection.nextRetryAt,
      banners: visibleBanners(banners, 'chat', now),
      now,
    });

    if (!chosen) {
      mounted?.plate.remove();
      mounted = null;
      stopCountdown();
      return;
    }

    const key = keyOf(chosen, now);
    if (mounted?.key === key) {
      const label = mounted.plate.querySelector('.svp-notice__muted');
      if (label && chosen.kind === 'connection') label.textContent = retryLabel(secondsUntil(chosen.retryAt, now));
    } else {
      mounted?.plate.remove();
      mounted = { key, plate: build(chosen, now) };
    }
    place();

    const counting = chosen.kind === 'connection' && chosen.retryAt !== null;
    if (!counting) stopCountdown();
    else if (countdown === null) countdown = window.setInterval(render, COUNTDOWN_MS);
  }

  const refresh = (): void => {
    const mine = ++generation;
    Promise.all([getBannerState(), getUpdateState()])
      .then(([bannerState, updateState]) => {
        if (mine !== generation) return;
        banners = bannerState;
        updates = updateState;
        render();
      })
      .catch(() => undefined);
  };

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (bannersChanged(changes) || UPDATE_STATE_KEY in changes)) refresh();
  });
  socket?.onState((next) => {
    if (next.connected) connectionHidden = false;
    connection = next;
    render();
  });
  window.setInterval(refresh, RECHECK_MS);

  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      place();
    });
  }).observe(document.body, { childList: true, subtree: true });

  refresh();
}

export function startPopupBanners(container: HTMLElement): void {
  const render = (state: BannerState): void => {
    const now = Date.now();
    container.replaceChildren(
      ...visibleBanners(state, 'popup', now).map((banner) =>
        renderBanner(banner, 'expanded', now, FRONTEND_URL, () => dismissById(banner.id)),
      ),
    );
  };
  const refresh = (): void => {
    getBannerState().then(render).catch(() => undefined);
  };
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && bannersChanged(changes)) refresh();
  });
  refresh();
}
