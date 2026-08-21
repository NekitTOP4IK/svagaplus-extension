const assert = require('assert');

const { derivePopupView } = require('../dist-types/popup/view-model.js');
const { buildPopupErrorBanner } = require('../dist-types/popup/error-banner.js');

const SETTINGS = { socialRatingEnabled: true, customNicknamesEnabled: true };
const ACCOUNT = {
  twitchLogin: 'nekittop4ik',
  avatarUrl: 'https://cdn.example/avatar.png',
  telegramLinked: true,
  lastCheckedAt: 0,
};

function state(patch) {
  return {
    hydrated: true,
    uiStatus: 'idle',
    account: null,
    settings: SETTINGS,
    banner: null,
    ...patch,
  };
}

// ── 1. Before the first background round-trip: skeleton, never "Не подключено".
//    (A cold popup used to flash the disconnected state before data arrived.)
const cold = derivePopupView(state({ hydrated: false }));
assert.equal(cold.accountView, 'loading');
assert.equal(cold.statusText, 'Проверка…');
assert.equal(cold.statusTone, 'loading');

// ── 2. Hydrated with no account.
const empty = derivePopupView(state({}));
assert.equal(empty.accountView, 'disconnected');
assert.equal(empty.statusText, 'Не подключено');
assert.equal(empty.statusTone, 'idle');
assert.equal(empty.primaryLabel, 'Подключить аккаунт');
assert.equal(empty.primaryAction, 'connect');
assert.equal(empty.showSecondary, false, 'no "Выйти" button when nothing is connected');

// ── 3. Connected.
const connected = derivePopupView(state({ account: ACCOUNT }));
assert.equal(connected.accountView, 'connected');
assert.equal(connected.statusText, 'Подключено');
assert.equal(connected.statusTone, 'success');
assert.equal(connected.primaryLabel, 'Настройки');
assert.equal(connected.primaryAction, 'settings');
assert.equal(connected.showSecondary, true);
assert.equal(connected.login, 'nekittop4ik');
assert.equal(connected.avatarUrl, 'https://cdn.example/avatar.png');
assert.equal(connected.telegramLinked, true);
assert.equal(connected.telegramText, 'Telegram подключен');

// ── 4. Connected without Telegram → warning copy.
const noTelegram = derivePopupView(state({ account: { ...ACCOUNT, telegramLinked: false } }));
assert.equal(noTelegram.telegramLinked, false);
assert.equal(noTelegram.telegramText, 'Telegram не подключен');

// ── 5. Busy: the primary button must stay visible with a spinner instead of
//    disappearing and leaving an empty action row (regression from the old popup).
const busy = derivePopupView(state({ uiStatus: 'loading' }));
assert.equal(busy.busy, true);
assert.equal(busy.primaryLabel, 'Подключение…');
assert.equal(busy.statusText, 'Подключение…');
assert.equal(busy.statusTone, 'loading');

// ── 6. Busy outranks a connected account in the status pill.
const busyConnected = derivePopupView(state({ uiStatus: 'loading', account: ACCOUNT }));
assert.equal(busyConnected.statusText, 'Подключение…');
assert.equal(busyConnected.accountView, 'connected', 'account stays on screen while reconnecting');

// ── 7. Error status wins over hydration/connection state.
const failed = derivePopupView(state({
  uiStatus: 'error',
  banner: buildPopupErrorBanner({ error: 'oauth_cancelled', source: 'oauth' }),
}));
assert.equal(failed.statusText, 'Ошибка');
assert.equal(failed.statusTone, 'error');
assert.equal(failed.banner.code, 'oauth_cancelled');

// ── 8. Settings pass through so a failed settings:update can roll the switch back.
const off = derivePopupView(state({
  settings: { socialRatingEnabled: false, customNicknamesEnabled: false },
}));
assert.equal(off.socialRatingEnabled, false);
assert.equal(off.customNicknamesEnabled, false);

console.log('popup-view-model: PASS (8 checks)');
