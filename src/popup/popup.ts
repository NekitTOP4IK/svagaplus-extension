import browser from '../shared/browser';
import { FRONTEND_URL } from '../shared/config';
import type { ExtensionSettings, ViewerAccount } from '../shared/types';

type ViewerAccountResponse = {
  ok: true;
  account: Omit<ViewerAccount, 'token'> | null;
} | {
  ok: false;
  error?: string;
};

type SettingsResponse = {
  ok: true;
  settings: ExtensionSettings;
} | {
  ok: false;
  error?: string;
};

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

async function sendMessage<T>(message: object): Promise<T | null> {
  try {
    return await browser.runtime.sendMessage(message) as T;
  } catch {
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

async function refreshState(): Promise<void> {
  const [accountRes, settingsRes] = await Promise.all([
    sendMessage<ViewerAccountResponse>({ type: 'viewer:getAccount' }),
    sendMessage<SettingsResponse>({ type: 'settings:get' }),
  ]);

  const account = accountRes && accountRes.ok ? accountRes.account : null;
  const settings = settingsRes && settingsRes.ok ? settingsRes.settings : { socialRatingEnabled: true };

  const connected = !!account?.twitchLogin;
  setText('connectionState', connected ? 'Подключено' : 'Не подключено');
  setHidden('connectedAccount', !connected);
  setHidden('disconnectedAccount', connected);
  setHidden('secondaryAction', !connected);
  setHidden('openSettings', true);
  setText('primaryAction', connected ? 'Открыть настройки' : 'Подключить аккаунт');

  const primaryAction = $('primaryAction');
  if (primaryAction) {
    primaryAction.onclick = connected
      ? async () => {
          await browser.tabs.create({ url: `${FRONTEND_URL}/viewer/settings`, active: true });
        }
      : async () => {
          await sendMessage({ type: 'viewer:startConnect' });
        };
  }

  const secondaryAction = $('secondaryAction');
  if (secondaryAction) {
    secondaryAction.onclick = async () => {
      await sendMessage({ type: 'viewer:disconnect' });
      await sendMessage({ type: 'viewer:startConnect' });
    };
  }

  if (connected) {
    setText('accountLogin', account.twitchLogin);
    setText('accountTelegram', account.telegramLinked ? 'Telegram подключен' : 'Telegram не подключен');
    setAvatar(account.avatarUrl, account.twitchLogin);
  } else {
    setText('accountLogin', 'Аккаунт не подключен');
    setText('accountTelegram', 'Подключение через viewer-connect');
    setAvatar(null, '');
  }

  const toggle = $('socialRatingToggle') as HTMLInputElement | null;
  if (toggle) {
    toggle.checked = settings.socialRatingEnabled;
    toggle.onchange = async () => {
      const next = await sendMessage<SettingsResponse>({
        type: 'settings:update',
        settings: { socialRatingEnabled: toggle.checked },
      });
      if (next && next.ok) {
        toggle.checked = next.settings.socialRatingEnabled;
      }
    };
  }
}

void refreshState();
