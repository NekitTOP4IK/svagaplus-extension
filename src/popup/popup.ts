import browser from '../shared/browser';
import { FRONTEND_URL } from '../shared/config';
import { getChannelLoginFromUrl } from '../shared/twitch';
import type { ExtensionSettings, ViewerAccount, ViewerAuthFeedback } from '../shared/types';
import { aliasExportFilename, formatAliasCount, parseAliasImport, toSortedAliasItems, type AliasItem } from './alias-list';
import { buildPopupErrorBanner, type PopupErrorBanner } from './error-banner';
import { derivePopupView, shouldApplyMetricsResponse, type AccountView, type PopupMetricsState, type PopupRating, type PopupState, type UiStatus } from './view-model';

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

type UserRatingResponse = PopupRating | null;

type AliasesResponse = { aliases?: Record<string, string> };
type AliasMutationResponse = { ok: boolean; imported?: number; error?: string };
type AliasExportResponse = { data?: AliasItem[]; count?: number };

const DEFAULT_SETTINGS: ExtensionSettings = {
  socialRatingEnabled: true,
  customNicknamesEnabled: true,
};

const state: PopupState = {
  hydrated: false,
  uiStatus: 'idle',
  account: null,
  settings: DEFAULT_SETTINGS,
  banner: null,
  metrics: { state: 'idle', channel: null, rating: null },
};

/** Banner raised by the current interaction; outranks the persisted auth feedback. */
let transientBanner: PopupErrorBanner | null = null;
let feedbackBanner: PopupErrorBanner | null = null;
let metricsRequestGeneration = 0;

let aliasItems: AliasItem[] = [];
let aliasBusy = false;

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

function setMetrics(metrics: PopupMetricsState): void {
  state.metrics = metrics;
}

function formatMetric(value: number | null): string {
  return value == null ? '—' : new Intl.NumberFormat('ru-RU').format(value);
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
  const socialRatingToggle = $('socialRatingToggle') as HTMLInputElement | null;
  const customNicknamesToggle = $('customNicknamesToggle') as HTMLInputElement | null;
  if (primary) primary.disabled = view.busy;
  if (secondary) secondary.disabled = view.busy;
  if (socialRatingToggle) {
    socialRatingToggle.disabled = view.busy;
    socialRatingToggle.checked = view.socialRatingEnabled;
  }
  if (customNicknamesToggle) {
    customNicknamesToggle.disabled = view.busy;
    customNicknamesToggle.checked = view.customNicknamesEnabled;
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

  renderAliasControls();

  setText('metricsState', view.metricsText);
  setText('metricsChannel', view.metricsChannel ? `· ${view.metricsChannel}` : '');
  setText('swagScore', formatMetric(view.swagScore));
  setText('socialScore', formatMetric(view.socialScore));
  setHidden('metricsValues', view.metricsState !== 'ready');
  $('metricsPanel')?.classList.toggle('metrics--loading', view.metricsState === 'loading');
}

async function getActiveChannelLogin(): Promise<string | null> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return getChannelLoginFromUrl(tabs[0]?.url);
}

async function loadMetrics(accountLogin: string, generation: number): Promise<void> {
  setMetrics({ state: 'loading', channel: null, rating: null });
  render();
  try {
    const channel = await getActiveChannelLogin();
    if (!shouldApplyMetricsResponse(metricsRequestGeneration, generation, state.account?.twitchLogin, accountLogin)) return;
    if (!channel) {
      setMetrics({ state: 'missing-channel', channel: null, rating: null });
      render();
      return;
    }

    let rating: UserRatingResponse;
    try {
      rating = await browser.runtime.sendMessage({ type: 'GET_USER_RATING', channelLogin: channel }) as UserRatingResponse;
    } catch {
      if (!shouldApplyMetricsResponse(metricsRequestGeneration, generation, state.account?.twitchLogin, accountLogin)) return;
      setMetrics({ state: 'error', channel, rating: null });
      render();
      return;
    }
    if (!shouldApplyMetricsResponse(metricsRequestGeneration, generation, state.account?.twitchLogin, accountLogin)) return;
    const hasScore = rating?.enabled === true && Number.isSafeInteger(rating.swag_score ?? rating.score);
    setMetrics({ state: hasScore ? 'ready' : 'unavailable', channel, rating: hasScore ? rating : null });
    render();
  } catch {
    if (!shouldApplyMetricsResponse(metricsRequestGeneration, generation, state.account?.twitchLogin, accountLogin)) return;
    setMetrics({ state: 'error', channel: null, rating: null });
    render();
  }
}

async function loadState(): Promise<void> {
  const generation = ++metricsRequestGeneration;
  const [accountRes, settingsRes, feedbackRes] = await Promise.all([
    sendMessage<ViewerAccountResponse>({ type: 'viewer:getAccount' }),
    sendMessage<SettingsResponse>({ type: 'settings:get' }),
    sendMessage<AuthFeedbackResponse>({ type: 'viewer:getAuthFeedback' }),
  ]);
  if (generation !== metricsRequestGeneration) return;

  state.account = accountRes && accountRes.ok ? accountRes.account : null;
  state.settings = settingsRes && settingsRes.ok ? settingsRes.settings : DEFAULT_SETTINGS;
  feedbackBanner = buildPopupErrorBanner(feedbackRes && feedbackRes.ok ? feedbackRes.feedback : null);
  state.hydrated = true;
  if (!state.account?.twitchLogin) {
    setMetrics({ state: 'idle', channel: null, rating: null });
    render();
    return;
  }
  render();
  await loadMetrics(state.account.twitchLogin, generation);
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
  metricsRequestGeneration += 1;
  state.uiStatus = 'idle';
  transientBanner = null;
  state.account = null;
  setMetrics({ state: 'idle', channel: null, rating: null });
  render();
  await sendMessage({ type: 'viewer:disconnect' });
  await loadState();
}

async function onToggleChange(
  toggle: HTMLInputElement,
  setting: keyof ExtensionSettings,
): Promise<void> {
  const next = await sendMessage<SettingsResponse>({
    type: 'settings:update',
    settings: { [setting]: toggle.checked },
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

// ── Алиасы ─────────────────────────────────────────────────────────────────

function setAliasStatus(text: string | null, tone: 'info' | 'ok' | 'error' = 'info'): void {
  const el = $('aliasStatus');
  if (!el) return;
  el.hidden = !text;
  el.textContent = text ?? '';
  el.classList.toggle('alias-status--ok', tone === 'ok');
  el.classList.toggle('alias-status--error', tone === 'error');
}

function aliasErrorText(error: string | undefined): string {
  if (error === 'not_authenticated') return 'Войдите в аккаунт, чтобы синхронизировать алиасы.';
  return 'Сервер не ответил. Алиасы сохранены в браузере, синхронизируются позже.';
}

function renderAliasControls(): void {
  setHidden('aliasSync', !state.account?.twitchLogin);
  setHidden('aliasSyncSpinner', !aliasBusy);
  for (const id of ['aliasImport', 'aliasSync']) {
    const button = $(id) as HTMLButtonElement | null;
    if (button) button.disabled = aliasBusy;
  }
  const exportButton = $('aliasExport') as HTMLButtonElement | null;
  if (exportButton) exportButton.disabled = aliasBusy || aliasItems.length === 0;
}

function renderAliasList(): void {
  setText('aliasCount', aliasItems.length > 0 ? formatAliasCount(aliasItems.length) : '');
  setHidden('aliasEmpty', aliasItems.length > 0);

  const list = $('aliasList');
  if (list) {
    list.hidden = aliasItems.length === 0;
    // Только textContent: алиас — произвольный пользовательский текст.
    list.replaceChildren(...aliasItems.map(({ login, alias }) => {
      const row = document.createElement('li');
      row.className = 'alias-row';

      const loginEl = document.createElement('span');
      loginEl.className = 'alias-login';
      loginEl.textContent = login;
      loginEl.title = login;

      const arrow = document.createElement('span');
      arrow.className = 'alias-arrow';
      arrow.textContent = '→';
      arrow.setAttribute('aria-hidden', 'true');

      const aliasEl = document.createElement('span');
      aliasEl.className = 'alias-name';
      aliasEl.textContent = alias;
      aliasEl.title = alias;

      const remove = document.createElement('button');
      remove.className = 'alias-delete';
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = 'Удалить алиас';
      remove.setAttribute('aria-label', `Удалить алиас ${alias} для ${login}`);
      remove.disabled = aliasBusy;
      remove.addEventListener('click', () => { void removeAliasFromList(login); });

      row.append(loginEl, arrow, aliasEl, remove);
      return row;
    }));
  }
  renderAliasControls();
}

async function loadAliases(): Promise<void> {
  const res = await sendMessage<AliasesResponse>({ type: 'GET_ALIASES' });
  aliasItems = toSortedAliasItems(res?.aliases);
  renderAliasList();
}

async function withAliasBusy(task: () => Promise<void>): Promise<void> {
  if (aliasBusy) return;
  aliasBusy = true;
  renderAliasList();
  try {
    await task();
  } finally {
    aliasBusy = false;
    await loadAliases();
  }
}

async function removeAliasFromList(login: string): Promise<void> {
  await withAliasBusy(async () => {
    // Локально удаляется всегда; ok: false означает, что не дошло только до сервера.
    await sendMessage<AliasMutationResponse>({ type: 'DELETE_ALIAS', login });
    setAliasStatus(null);
  });
}

async function exportAliasList(): Promise<void> {
  const res = await sendMessage<AliasExportResponse>({ type: 'EXPORT_ALIASES' });
  const data = res?.data ?? [];
  if (data.length === 0) {
    setAliasStatus('Экспортировать нечего.');
    return;
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = aliasExportFilename(new Date());
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  setAliasStatus(`Сохранено: ${formatAliasCount(data.length)}.`, 'ok');
}

// Firefox закрывает popup, как только открывается системный диалог выбора файла,
// и событие change до страницы уже не доходит. Поэтому там импорт идёт из обычной вкладки.
const isFirefox = navigator.userAgent.includes('Firefox');
const openedAsTab = new URLSearchParams(location.search).has('tab');

function startAliasImport(): void {
  if (isFirefox && !openedAsTab) {
    void browser.tabs
      .create({ url: browser.runtime.getURL('src/popup/popup.html?tab=aliases'), active: true })
      .then(() => window.close());
    return;
  }
  ($('aliasImportFile') as HTMLInputElement | null)?.click();
}

async function importAliasFile(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  const parsed = parseAliasImport(await file.text());
  if (!parsed.ok) {
    setAliasStatus(parsed.error, 'error');
    return;
  }

  await withAliasBusy(async () => {
    const res = await sendMessage<AliasMutationResponse>({ type: 'IMPORT_ALIASES', data: parsed.items });
    const imported = res?.imported ?? 0;
    const skippedText = parsed.skipped > 0 ? ` Пропущено некорректных: ${parsed.skipped}.` : '';
    if (!res) {
      setAliasStatus('Расширение не ответило на импорт.', 'error');
    } else if (res.ok) {
      setAliasStatus(`Импортировано: ${formatAliasCount(imported)}.${skippedText}`, 'ok');
    } else if (res.error === 'bad_request') {
      setAliasStatus('Файл не прошёл проверку расширения.', 'error');
    } else {
      setAliasStatus(`Импортировано локально: ${formatAliasCount(imported)}. ${aliasErrorText(res.error)}`, 'error');
    }
  });
}

async function syncAliasList(): Promise<void> {
  await withAliasBusy(async () => {
    const res = await sendMessage<AliasMutationResponse>({ type: 'SYNC_ALIASES' });
    if (res?.ok) setAliasStatus('Синхронизировано с сервером.', 'ok');
    else setAliasStatus(aliasErrorText(res?.error), 'error');
  });
}

function bindAliasEvents(): void {
  $('aliasExport')?.addEventListener('click', () => { void exportAliasList(); });
  $('aliasImport')?.addEventListener('click', startAliasImport);
  $('aliasSync')?.addEventListener('click', () => { void syncAliasList(); });
  const fileInput = $('aliasImportFile') as HTMLInputElement | null;
  fileInput?.addEventListener('change', () => { void importAliasFile(fileInput); });

  // Фон дописывает алиасы при синхронизации, карточки на Twitch — при переименовании.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && 'aliases' in changes && !aliasBusy) void loadAliases();
  });
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

  const socialRatingToggle = $('socialRatingToggle') as HTMLInputElement | null;
  socialRatingToggle?.addEventListener('change', () => {
    void onToggleChange(socialRatingToggle, 'socialRatingEnabled');
  });

  const customNicknamesToggle = $('customNicknamesToggle') as HTMLInputElement | null;
  customNicknamesToggle?.addEventListener('change', () => {
    void onToggleChange(customNicknamesToggle, 'customNicknamesEnabled');
  });
}

bindEvents();
bindAliasEvents();
render();
void loadState();
void loadAliases();

browser.tabs.onActivated.addListener(() => { void loadState(); });
browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) void loadState();
});
