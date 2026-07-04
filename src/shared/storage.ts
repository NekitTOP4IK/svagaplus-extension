import browser from './browser';
import type { ExtensionSettings, RuntimeChannelState, ViewerAccount, ViewerAuthFeedback } from './types';

const SETTINGS_KEY = 'svagaplus_settings';
const VIEWER_ACCOUNT_KEY = 'svagaplus_viewer_account';
const CHANNEL_STATE_KEY = 'svagaplus_runtime_channel_state';
const VIEWER_AUTH_FEEDBACK_KEY = 'svagaplus_viewer_auth_feedback';

export const DEFAULT_EXTENSION_SETTINGS: ExtensionSettings = {
  socialRatingEnabled: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readValue<T>(key: string): Promise<T | undefined> {
  const stored = await browser.storage.local.get(key) as Record<string, unknown>;
  return stored[key] as T | undefined;
}

export async function getExtensionSettings(): Promise<ExtensionSettings> {
  const stored = await readValue<unknown>(SETTINGS_KEY);
  if (!isRecord(stored)) return { ...DEFAULT_EXTENSION_SETTINGS };
  return {
    socialRatingEnabled: typeof stored.socialRatingEnabled === 'boolean'
      ? stored.socialRatingEnabled
      : DEFAULT_EXTENSION_SETTINGS.socialRatingEnabled,
  };
}

export async function setExtensionSettings(patch: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const current = await getExtensionSettings();
  const next: ExtensionSettings = {
    socialRatingEnabled: typeof patch.socialRatingEnabled === 'boolean'
      ? patch.socialRatingEnabled
      : current.socialRatingEnabled,
  };
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function getViewerAccount(): Promise<ViewerAccount | null> {
  const stored = await readValue<unknown>(VIEWER_ACCOUNT_KEY);
  if (!isRecord(stored)) return null;
  const token = typeof stored.token === 'string' ? stored.token : null;
  const twitchLogin = typeof stored.twitchLogin === 'string' ? stored.twitchLogin : null;
  const avatarUrl = typeof stored.avatarUrl === 'string' || stored.avatarUrl === null ? stored.avatarUrl : null;
  const telegramLinked = typeof stored.telegramLinked === 'boolean' ? stored.telegramLinked : null;
  const lastCheckedAt = typeof stored.lastCheckedAt === 'number' ? stored.lastCheckedAt : null;
  if (!token || !twitchLogin || telegramLinked === null || lastCheckedAt === null) return null;
  return { token, twitchLogin, avatarUrl, telegramLinked, lastCheckedAt };
}

export async function setViewerAccount(account: ViewerAccount): Promise<ViewerAccount> {
  await browser.storage.local.set({ [VIEWER_ACCOUNT_KEY]: account });
  return account;
}

export async function clearViewerAccount(): Promise<void> {
  await browser.storage.local.remove(VIEWER_ACCOUNT_KEY);
}

export async function getViewerAuthFeedback(): Promise<ViewerAuthFeedback | null> {
  const stored = await readValue<unknown>(VIEWER_AUTH_FEEDBACK_KEY);
  if (!isRecord(stored)) return null;
  const error = typeof stored.error === 'string' || stored.error === null ? stored.error : null;
  const details = typeof stored.details === 'string' || stored.details === null ? stored.details : null;
  const redirectUri = typeof stored.redirectUri === 'string' || stored.redirectUri === null ? stored.redirectUri : null;
  const actualRedirectUri =
    typeof stored.actualRedirectUri === 'string' || stored.actualRedirectUri === null ? stored.actualRedirectUri : null;
  const source =
    stored.source === 'oauth' ||
    stored.source === 'background' ||
    stored.source === 'popup' ||
    stored.source === 'api'
      ? stored.source
      : null;
  const stage =
    stored.stage === 'authorize_url' ||
    stored.stage === 'redirect_uri_validation' ||
    stored.stage === 'launch_web_auth_flow' ||
    stored.stage === 'oauth_callback_validation' ||
    stored.stage === 'token_exchange' ||
    stored.stage === 'viewer_hydration' ||
    stored.stage === 'popup_message_transport' ||
    stored.stage === 'settings_update'
      ? stored.stage
      : null;
  const updatedAt = typeof stored.updatedAt === 'number' ? stored.updatedAt : null;
  if (
    error === undefined ||
    details === undefined ||
    redirectUri === undefined ||
    actualRedirectUri === undefined ||
    updatedAt === null
  ) {
    return null;
  }
  return { error, details, redirectUri, actualRedirectUri, source, stage, updatedAt };
}

export async function setViewerAuthFeedback(feedback: Omit<ViewerAuthFeedback, 'updatedAt'>): Promise<ViewerAuthFeedback> {
  const next: ViewerAuthFeedback = { ...feedback, updatedAt: Date.now() };
  await browser.storage.local.set({ [VIEWER_AUTH_FEEDBACK_KEY]: next });
  return next;
}

export async function clearViewerAuthFeedback(): Promise<void> {
  await browser.storage.local.remove(VIEWER_AUTH_FEEDBACK_KEY);
}

export async function getRuntimeChannelState(): Promise<RuntimeChannelState | null> {
  const stored = await readValue<unknown>(CHANNEL_STATE_KEY);
  if (!isRecord(stored)) return null;
  const channelLogin = typeof stored.channelLogin === 'string' || stored.channelLogin === null ? stored.channelLogin : null;
  const ratingEnabledForChannel = typeof stored.ratingEnabledForChannel === 'boolean' || stored.ratingEnabledForChannel === null
    ? stored.ratingEnabledForChannel
    : null;
  const lastUpdatedAt = typeof stored.lastUpdatedAt === 'number' ? stored.lastUpdatedAt : null;
  if (channelLogin === undefined || ratingEnabledForChannel === undefined || lastUpdatedAt === null) return null;
  return { channelLogin, ratingEnabledForChannel, lastUpdatedAt };
}

export async function setRuntimeChannelState(state: RuntimeChannelState): Promise<RuntimeChannelState> {
  await browser.storage.local.set({ [CHANNEL_STATE_KEY]: state });
  return state;
}

export async function clearRuntimeChannelState(): Promise<void> {
  await browser.storage.local.remove(CHANNEL_STATE_KEY);
}
