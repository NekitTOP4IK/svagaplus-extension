import browser from '../shared/browser';
import { FRONTEND_URL } from '../shared/config';
import type { ExtensionSettings, ViewerAccount, ViewerAuthFeedback } from '../shared/types';
import { buildPopupErrorBanner, type PopupErrorBanner } from './error-banner';

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

type UiStatus = 'idle' | 'loading' | 'success' | 'error';

let uiStatus: UiStatus = 'idle';
let statusDetail = '';
let transientBanner: PopupErrorBanner | null = null;

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
  if (el) el.textContent = text;
}

function setConnectionState(text: string, tone: UiStatus = 'idle'): void {
  const el = $('connectionState');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('pill--loading', 'pill--success', 'pill--error');
  if (tone === 'loading') el.classList.add('pill--loading');
  if (tone === 'success') el.classList.add('pill--success');
  if (tone === 'error') el.classList.add('pill--error');
}

function setAvatar(url: string | null | undefined, login: string): void {
  const avatar = $('accountAvatar') as HTMLImageElement | null;
  if (!avatar) return;
  if (url) {
    avatar.src = url;
    avatar.hidden = false;
    avatar.alt = login ? `${login} avatar` : '';
    return;
  }
  avatar.removeAttribute('src');
  avatar.hidden = true;
}

function setPopupErrorBanner(error: PopupErrorBanner | null): void {
  setHidden('popupErrorBanner', !error);
  setText('popupErrorTitle', error?.title ?? '');
  setText('popupErrorDetail', error?.detail ?? '');
}

async function refreshState(): Promise<void> {
  const [accountRes, settingsRes, feedbackRes] = await Promise.all([
    sendMessage<ViewerAccountResponse>({ type: 'viewer:getAccount' }),
    sendMessage<SettingsResponse>({ type: 'settings:get' }),
    sendMessage<AuthFeedbackResponse>({ type: 'viewer:getAuthFeedback' }),
  ]);

  const account = accountRes && accountRes.ok ? accountRes.account : null;
  const settings = settingsRes && settingsRes.ok ? settingsRes.settings : { socialRatingEnabled: true };
  const feedback = feedbackRes && feedbackRes.ok ? feedbackRes.feedback : null;
  const banner = transientBanner ?? buildPopupErrorBanner(feedback);

  const connected = !!account?.twitchLogin;
  const busy = uiStatus === 'loading';
  if (busy) {
    setConnectionState('Подключение...', 'loading');
  } else if (uiStatus === 'error') {
    setConnectionState('Ошибка', 'error');
  } else if (connected) {
    setConnectionState('Подключено', uiStatus === 'success' ? 'success' : 'idle');
  } else {
    setConnectionState('Не подключено', 'idle');
  }
  setPopupErrorBanner(banner);
  setHidden('connectedAccount', !connected);
  setHidden('disconnectedAccount', connected);
  setHidden('secondaryAction', !connected || busy);
  setHidden('openSettings', true);
  setText('primaryAction', busy ? 'Подключение...' : connected ? 'Настройки' : 'Подключить аккаунт');
  setText('secondaryAction', 'Выйти');

  const primaryAction = $('primaryAction') as HTMLButtonElement | null;
  if (primaryAction) {
    primaryAction.hidden = busy;
    primaryAction.disabled = busy;
    primaryAction.onclick = connected
      ? async () => {
          await browser.tabs.create({ url: `${FRONTEND_URL}/viewer/settings`, active: true });
        }
      : async () => {
          uiStatus = 'loading';
          statusDetail = 'Ожидаем подтверждение от Twitch...';
          await refreshState();
          const result = await sendMessage<StartConnectResponse>({ type: 'viewer:startConnect' });
          if (!result?.ok) {
            uiStatus = 'error';
            if (result) {
              transientBanner = buildPopupErrorBanner({
                error: result.error ?? feedback?.error ?? 'popup_message_failed',
                details: result.details ?? null,
                redirectUri: result.redirectUri ?? null,
                actualRedirectUri: result.actualRedirectUri ?? null,
                source: feedback?.source ?? 'oauth',
              });
            }
            statusDetail = '';
            await refreshState();
            return;
          }
          uiStatus = 'success';
          statusDetail = '';
          transientBanner = null;
          await refreshState();
        };
  }

  const secondaryAction = $('secondaryAction') as HTMLButtonElement | null;
  if (secondaryAction) {
    secondaryAction.disabled = busy;
    secondaryAction.onclick = async () => {
      uiStatus = 'idle';
      statusDetail = '';
      transientBanner = null;
      await sendMessage({ type: 'viewer:disconnect' });
      await refreshState();
    };
  }

  if (connected) {
    const telegramMeta = $('accountTelegramMeta');
    const telegramWarning = $('accountTelegramWarning');
    const telegramMissing = !account.telegramLinked;

    setText('accountLogin', account.twitchLogin);
    setText('accountTelegram', telegramMissing ? 'Telegram не подключен' : 'Telegram подключен');
    telegramMeta?.classList.toggle('account-meta--warning', telegramMissing);
    setHidden('accountTelegramWarning', !telegramMissing);
    setAvatar(account.avatarUrl, account.twitchLogin);
  } else {
    setText('accountLogin', 'Аккаунт не подключен');
    setText('accountTelegram', 'Подключение через Twitch OAuth');
    $('accountTelegramMeta')?.classList.remove('account-meta--warning');
    setHidden('accountTelegramWarning', true);
    setAvatar(null, '');
  }

  const toggle = $('socialRatingToggle') as HTMLInputElement | null;
  if (toggle) {
    toggle.checked = settings.socialRatingEnabled;
    toggle.disabled = busy;
    toggle.onchange = async () => {
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
        toggle.checked = !toggle.checked;
        await refreshState();
        return;
      }
      transientBanner = null;
      toggle.checked = next.settings.socialRatingEnabled;
    };
  }
}

void refreshState();
