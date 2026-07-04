import type { ViewerAuthFeedback, ViewerAuthSource } from '../shared/types';

export type PopupErrorBanner = {
  title: string;
  detail: string;
  code: string;
  source: ViewerAuthSource | 'unknown';
};

type PopupErrorInput = Partial<Pick<ViewerAuthFeedback, 'error' | 'details' | 'redirectUri' | 'actualRedirectUri' | 'source'>>;

const ERROR_MESSAGES: Record<string, string> = {
  identity_unavailable: 'Identity API недоступен',
  authorize_url_failed: 'Redirect URI не принят сервером',
  redirect_uri_mismatch: 'Сервер авторизации вернул неверный redirect URI',
  redirect_mismatch: 'Twitch отклонил redirect URI',
  oauth_cancelled: 'Авторизация отменена',
  state_mismatch: 'Ответ OAuth не прошёл проверку',
  missing_code: 'Twitch не вернул код авторизации',
  token_exchange_failed: 'Сервер не подтвердил Twitch-код',
  invalid_token: 'Сохранённый токен недействителен',
  account_lookup_failed: 'Не удалось загрузить профиль',
  oauth_failed: 'OAuth завершился с ошибкой',
  popup_message_failed: 'Расширение не ответило на запрос',
  settings_update_failed: 'Не удалось сохранить настройку',
};

function normalizeSource(source: ViewerAuthFeedback['source'] | undefined): PopupErrorBanner['source'] {
  return source === 'oauth' || source === 'background' || source === 'popup' || source === 'api'
    ? source
    : 'unknown';
}

export function buildPopupErrorBanner(input: PopupErrorInput | null | undefined): PopupErrorBanner | null {
  const code = input?.error ?? '';
  if (!code) return null;
  const data = input ?? {};

  if (code === 'oauth_cancelled') {
    return {
      title: 'Не удалось открыть авторизацию Twitch',
      detail: 'Окно авторизации было закрыто до завершения. Код: oauth_cancelled',
      code,
      source: normalizeSource(data.source),
    };
  }

  if (code === 'redirect_uri_mismatch' || code === 'redirect_mismatch') {
    return {
      title: 'Twitch отклонил redirect URI',
      detail: `Ожидался: ${data.redirectUri ?? 'unknown'}. Получен: ${data.actualRedirectUri ?? 'unknown'}.`,
      code,
      source: normalizeSource(data.source),
    };
  }

  if (code === 'authorize_url_failed') {
    return {
      title: 'Не удалось начать авторизацию',
      detail: `Добавьте redirect URI: ${data.redirectUri ?? 'browser.identity.getRedirectURL("viewer-auth")'}. Код: ${code}`,
      code,
      source: normalizeSource(data.source),
    };
  }

  return {
    title: ERROR_MESSAGES[code] || 'Не удалось завершить действие',
    detail: `${data.details ?? 'Подробности не переданы.'} Код: ${code}`,
    code,
    source: normalizeSource(data.source),
  };
}
