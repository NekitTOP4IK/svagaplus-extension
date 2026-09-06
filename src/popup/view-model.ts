import type { ExtensionSettings, ViewerAccount } from '../shared/types';
import type { PopupErrorBanner } from './error-banner';

export type UiStatus = 'idle' | 'loading' | 'success' | 'error';

/** Which of the three cross-faded blocks in the account panel is visible. */
export type AccountView = 'loading' | 'connected' | 'disconnected';

export type PrimaryAction = 'connect' | 'settings';

export type RatingViewState = 'idle' | 'loading' | 'ready' | 'missing-channel' | 'unavailable' | 'error';

export interface PopupRating {
  score?: number;
  swag_score?: number;
  social_score?: number;
  enabled?: boolean;
}

export interface PopupMetricsState {
  state: RatingViewState;
  channel: string | null;
  rating: PopupRating | null;
}

/** A popup may outlive an account or tab switch while its metric request is in flight. */
export function shouldApplyMetricsResponse(
  currentGeneration: number,
  responseGeneration: number,
  currentLogin: string | undefined,
  requestLogin: string,
): boolean {
  return currentGeneration === responseGeneration && currentLogin === requestLogin;
}

export interface PopupState {
  /** false until the first background round-trip resolves (skeleton is shown). */
  hydrated: boolean;
  uiStatus: UiStatus;
  account: Omit<ViewerAccount, 'token'> | null;
  settings: ExtensionSettings;
  banner: PopupErrorBanner | null;
  metrics?: PopupMetricsState;
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
  customNicknamesEnabled: boolean;
  banner: PopupErrorBanner | null;
  metricsState: RatingViewState;
  metricsText: string;
  metricsChannel: string;
  swagScore: number | null;
  socialScore: number | null;
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
  const metrics = state.metrics ?? { state: 'idle' as const, channel: null, rating: null };
  const swagScore = Number.isSafeInteger(metrics.rating?.swag_score ?? metrics.rating?.score)
    ? (metrics.rating?.swag_score ?? metrics.rating?.score ?? null)
    : null;
  const socialScore = Number.isSafeInteger(metrics.rating?.social_score)
    ? metrics.rating?.social_score ?? null
    : null;
  const metricsText = metrics.state === 'loading' ? 'Загружаем показатели…'
    : metrics.state === 'missing-channel' ? 'Откройте канал Twitch, чтобы увидеть показатели.'
      : metrics.state === 'unavailable' ? 'Показатели для этого канала пока недоступны.'
        : metrics.state === 'error' ? 'Не удалось загрузить показатели.'
          : metrics.state === 'ready' ? `Канал: ${metrics.channel}` : 'Войдите, чтобы увидеть показатели.';

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
    customNicknamesEnabled: state.settings.customNicknamesEnabled,
    banner: state.banner,
    metricsState: metrics.state,
    metricsText,
    metricsChannel: metrics.channel ?? '',
    swagScore,
    socialScore,
  };
}
