const assert = require('node:assert/strict');
const test = require('node:test');

const { derivePopupView, shouldApplyMetricsResponse } = require('../dist-types/popup/view-model.js');

const base = {
  hydrated: true,
  uiStatus: 'idle',
  account: { twitchLogin: 'viewer', avatarUrl: null, telegramLinked: false, lastCheckedAt: 0 },
  settings: { socialRatingEnabled: true, customNicknamesEnabled: true },
  banner: null,
};

test('describes metric loading, unavailable channel, errors and verified scores without inventing zero', () => {
  const loading = derivePopupView({ ...base, metrics: { state: 'loading', channel: null, rating: null } });
  assert.equal(loading.metricsState, 'loading');

  const missing = derivePopupView({ ...base, metrics: { state: 'missing-channel', channel: null, rating: null } });
  assert.match(missing.metricsText, /Откройте канал Twitch/);

  const unavailable = derivePopupView({ ...base, metrics: { state: 'unavailable', channel: 'alpha', rating: null } });
  assert.equal(unavailable.swagScore, null);
  assert.equal(unavailable.socialScore, null);

  const failed = derivePopupView({ ...base, metrics: { state: 'error', channel: 'alpha', rating: null } });
  assert.match(failed.metricsText, /Не удалось/);

  const ready = derivePopupView({ ...base, metrics: { state: 'ready', channel: 'alpha', rating: { swag_score: 1234, social_score: -8 } } });
  assert.equal(ready.swagScore, 1234);
  assert.equal(ready.socialScore, -8);
});

test('rejects metrics responses from an older request or a prior account', () => {
  assert.equal(shouldApplyMetricsResponse(4, 4, 'viewer', 'viewer'), true);
  assert.equal(shouldApplyMetricsResponse(5, 4, 'viewer', 'viewer'), false);
  assert.equal(shouldApplyMetricsResponse(4, 4, 'different-viewer', 'viewer'), false);
  assert.equal(shouldApplyMetricsResponse(4, 4, undefined, 'viewer'), false);
});
