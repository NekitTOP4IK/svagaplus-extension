import browser from '../shared/browser';
import { FRONTEND_URL } from '../shared/config';
import type { ExtensionSettings, ViewerAccount, ViewerAuthFeedback } from '../shared/types';
import { buildPopupErrorBanner, type PopupErrorBanner } from './error-banner';
import { derivePopupView, type AccountView, type PopupState, type UiStatus } from './view-model';

type ViewerAccountResponse = {
  ok: true;
  account: Omit<ViewerAccount, 'token'> | null;
} | {
  ok: false;
  error?: string;
};

type StartConnectResponse = {
  ok: boolean;
  error?: string;
  details?: string;
  redirectUri?: string;
  actualRedirectUri?: string;
};

type SettingsResponse = {
  ok: true;
  settings: ExtensionSettings;
} | {
  ok: false;
  error?: string;
};

type AuthFeedbackResponse = {
  ok: true;
  feedback: ViewerAuthFeedback | null;
} | {
  ok: false;
  error?: string;
};

const DEFAULT_SETTINGS: ExtensionSettings = { socialRatingEnabled: true };

const state: PopupState = {
  hydrated: false,
  uiStatus: 'idle',
  account: null,
  settings: DEFAULT_SETTINGS,
  banner: null,
};

/** Banner raised by the current interaction; outranks the persisted auth feedback. */
let transientBanner: PopupErrorBanner | null = null;
let feedbackBanner: PopupErrorBanner | null = null;

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

async function sendMessage<T>(message: object): Promise<T | null> {
  try {
    return await browser.runtime.sendMessage(message) as T;
  } catch (error) {
    console.error('[svagaplus][popup]', {
      messageType: (message as { type?: unknown }).type ?? 'unknown',
      error,
    });
    transientBanner = buildPopupErrorBanner({
      error: 'popup_message_failed',
      details: 'Фоновый скрипт не ответил на запрос.',
      source: 'popup',
    });
    return null;
  }
}

function setHidden(id: string, hidden: boolean): void {
  const el = $(id);
  if (el) el.hidden = hidden;
}

function setText(id: string, text: string): void {
  const el = $(id);
  if (el && el.textContent !== text) el.textContent = text;
}

function setConnectionState(text: string, tone: UiStatus): void {
  const el = $('connectionState');
  if (!el) return;
  if (el.textContent?.trim() !== text) el.textContent = text;
  el.classList.toggle('pill--loading', tone === 'loading');
  el.classList.toggle('pill--success', tone === 'success');
  el.classList.toggle('pill--error', tone === 'error');
}

const ACCOUNT_VIEW_IDS: Record<AccountView, string> = {
  loading: 'loadingAccount',
  connected: 'connectedAccount',
  disconnected: 'disconnectedAccount',
};

/** Cross-fades between the three account states without resizing the popup. */
function setAccountView(view: AccountView): void {
  for (const [name, id] of Object.entries(ACCOUNT_VIEW_IDS)) {
    $(id)?.classList.toggle('is-active', name === view);
  }
}

function setAvatar(url: string | null, login: string): void {
  const avatar = $('accountAvatar') as HTMLImageElement | null;
  const fallback = $('accountAvatarFallback');
  if (fallback) fallback.textContent = login ? login.charAt(0) : '';
  if (!avatar) return;

  if (!url) {
    avatar.removeAttribute('src');
    avatar.hidden = true;
    return;
  }

  // A dead Twitch CDN link must fall back to the initial, not a broken-image icon.
  avatar.onerror = () => { avatar.hidden = true; };
  avatar.onload = () => { avatar.hidden = false; };
  avatar.alt = login ? `Аватар ${login}` : '';
  if (avatar.getAttribute('src') !== url) {
    avatar.hidden = true;
    avatar.src = url;
  }
}

function setPopupErrorBanner(error: PopupErrorBanner | null): void {
  // Keep the last copy while collapsing so the text does not vanish mid-animation.
  if (error) {
    setText('popupErrorTitle', error.title);
    setText('popupErrorDetail', error.detail);
  }
  $('popupErrorSlot')?.classList.toggle('is-open', !!error);
}

function render(): void {
  state.banner = transientBanner ?? feedbackBanner;
  const view = derivePopupView(state);

  setConnectionState(view.statusText, view.statusTone);
  setPopupErrorBanner(view.banner);
  setAccountView(view.accountView);
  setHidden('secondaryAction', !view.showSecondary);
  setText('primaryActionLabel', view.primaryLabel);
  setHidden('primaryActionSpinner', !view.busy);

  const primary = $('primaryAction') as HTMLButtonElement | null;
  const secondary = $('secondaryAction') as HTMLButtonElement | null;
  const toggle = $('socialRatingToggle') as HTMLInputElement | null;
  if (primary) primary.disabled = view.busy;
  if (secondary) secondary.disabled = view.busy;
  if (toggle) {
    toggle.disabled = view.busy;
    toggle.checked = view.socialRatingEnabled;
  }

  if (view.accountView === 'connected') {
    const telegramMeta = $('accountTelegramMeta');
    setText('accountLogin', view.login);
    setText('accountTelegram', view.telegramText);
    telegramMeta?.classList.toggle('account-meta--warning', !view.telegramLinked);
    telegramMeta?.classList.toggle('account-meta--ok', view.telegramLinked);
    setHidden('accountTelegramWarning', view.telegramLinked);
    setAvatar(view.avatarUrl, view.login);
  } else {
    setAvatar(null, '');
  }
}

async function loadState(): Promise<void> {
  const [accountRes, settingsRes, feedbackRes] = await Promise.all([
    sendMessage<ViewerAccountResponse>({ type: 'viewer:getAccount' }),
    sendMessage<SettingsResponse>({ type: 'settings:get' }),
    sendMessage<AuthFeedbackResponse>({ type: 'viewer:getAuthFeedback' }),
  ]);

  state.account = accountRes && accountRes.ok ? accountRes.account : null;
  state.settings = settingsRes && settingsRes.ok ? settingsRes.settings : DEFAULT_SETTINGS;
  feedbackBanner = buildPopupErrorBanner(feedbackRes && feedbackRes.ok ? feedbackRes.feedback : null);
  state.hydrated = true;
  render();
}

async function connect(): Promise<void> {
  state.uiStatus = 'loading';
  transientBanner = null;
  render();

  const result = await sendMessage<StartConnectResponse>({ type: 'viewer:startConnect' });
  if (!result?.ok) {
    state.uiStatus = 'error';
    if (result) {
      transientBanner = buildPopupErrorBanner({
        error: result.error ?? 'popup_message_failed',
        details: result.details ?? null,
        redirectUri: result.redirectUri ?? null,
        actualRedirectUri: result.actualRedirectUri ?? null,
        source: 'oauth',
      });
    }
    await loadState();
    return;
  }

  state.uiStatus = 'success';
  transientBanner = null;
  await loadState();
}

async function disconnect(): Promise<void> {
  state.uiStatus = 'idle';
  transientBanner = null;
  state.account = null;
  render();
  await sendMessage({ type: 'viewer:disconnect' });
  await loadState();
}

async function onToggleChange(toggle: HTMLInputElement): Promise<void> {
  const next = await sendMessage<SettingsResponse>({
    type: 'settings:update',
    settings: { socialRatingEnabled: toggle.checked },
  });

  if (!next || !next.ok) {
    console.error('[svagaplus][popup]', { action: 'settings:update', result: next });
    transientBanner = buildPopupErrorBanner({
      error: 'settings_update_failed',
      details: 'Расширение не подтвердило изменение переключателя.',
      source: 'popup',
    });
    render(); // rolls the switch back to the last confirmed value
    return;
  }

  state.settings = next.settings;
  transientBanner = null;
  render();
}

function bindEvents(): void {
  $('primaryAction')?.addEventListener('click', () => {
    if (state.uiStatus === 'loading') return;
    if (derivePopupView(state).primaryAction === 'settings') {
      void browser.tabs
        .create({ url: `${FRONTEND_URL}/viewer/settings`, active: true })
        .then(() => window.close());
      return;
    }
    void connect();
  });

  $('secondaryAction')?.addEventListener('click', () => {
    if (state.uiStatus === 'loading') return;
    void disconnect();
  });

  const toggle = $('socialRatingToggle') as HTMLInputElement | null;
  toggle?.addEventListener('change', () => {
    void onToggleChange(toggle);
  });
}

bindEvents();
render();
void loadState();
