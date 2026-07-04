const assert = require('assert');

const {
  buildPopupErrorBanner,
} = require('../dist-types/popup/error-banner.js');

const mismatchBanner = buildPopupErrorBanner({
  error: 'redirect_uri_mismatch',
  redirectUri: 'chrome-extension://expected/viewer-auth',
  actualRedirectUri: 'https://actual.example/callback',
  details: 'redirect mismatch',
  source: 'oauth',
});

assert.equal(mismatchBanner.title, 'Twitch отклонил redirect URI');
assert.match(mismatchBanner.detail, /chrome-extension:\/\/expected\/viewer-auth/);
assert.match(mismatchBanner.detail, /https:\/\/actual\.example\/callback/);

const cancelledBanner = buildPopupErrorBanner({
  error: 'oauth_cancelled',
  source: 'oauth',
});

assert.equal(cancelledBanner.title, 'Не удалось открыть авторизацию Twitch');
assert.match(cancelledBanner.detail, /oauth_cancelled/);
