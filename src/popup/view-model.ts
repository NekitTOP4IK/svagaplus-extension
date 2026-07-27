import type { ExtensionSettings, ViewerAccount } from '../shared/types';
import type { PopupErrorBanner } from './error-banner';

export type UiStatus = 'idle' | 'loading' | 'success' | 'error';

/** Which of the three cross-faded blocks in the account panel is visible. */
export type AccountView = 'loading' | 'connected' | 'disconnected';

export type PrimaryAction = 'connect' | 'settings';

export interface PopupState {
  /** false until the first background round-trip resolves (skeleton is shown). */
  hydrated: boolean;
  uiStatus: UiStatus;
  account: Omit<ViewerAccount, 'token'> | null;
  settings: ExtensionSettings;
  banner: PopupErrorBanner | null;
}

export interface PopupView {
  statusText: string;
  statusTone: UiStatus;
  accountView: AccountView;
  busy: boolean;
  primaryLabel: string;
  primaryAction: PrimaryAction;
  showSecondary: boolean;
  login: string;
  avatarUrl: string | null;
  telegramText: string;
  telegramLinked: boolean;
  socialRatingEnabled: boolean;
  banner: PopupErrorBanner | null;
}

/**
 * Single source of truth for what the popup shows. Kept free of DOM and of
 * `shared/config` (which needs webpack DefinePlugin) so it can be unit-tested.
 */
export function derivePopupView(state: PopupState): PopupView {
  const connected = !!state.account?.twitchLogin;
  const busy = state.uiStatus === 'loading';

  let statusText: string;
  let statusTone: UiStatus;
  if (busy) {
    statusText = 'Подключение…';
    statusTone = 'loading';
  } else if (state.uiStatus === 'error') {
    statusText = 'Ошибка';
    statusTone = 'error';
  } else if (!state.hydrated) {
    statusText = 'Проверка…';
    statusTone = 'loading';
  } else if (connected) {
    statusText = 'Подключено';
    statusTone = 'success';
  } else {
    statusText = 'Не подключено';
    statusTone = 'idle';
  }

  const telegramLinked = !!state.account?.telegramLinked;

  return {
    statusText,
    statusTone,
    accountView: !state.hydrated ? 'loading' : connected ? 'connected' : 'disconnected',
    busy,
    primaryLabel: busy ? 'Подключение…' : connected ? 'Настройки' : 'Подключить аккаунт',
    primaryAction: connected ? 'settings' : 'connect',
    // The button stays visible while connecting — it turns into a spinner instead
    // of disappearing and leaving an empty row.
    showSecondary: connected,
    login: state.account?.twitchLogin ?? '',
    avatarUrl: state.account?.avatarUrl ?? null,
    telegramText: telegramLinked ? 'Telegram подключен' : 'Telegram не подключен',
    telegramLinked,
    socialRatingEnabled: state.settings.socialRatingEnabled,
    banner: state.banner,
  };
}
