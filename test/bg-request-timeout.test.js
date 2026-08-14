const assert = require('node:assert/strict');

require('./helpers/build-globals').defineBuildGlobals();
require('./helpers/extension-env').stubExtensionApis();

const bg = require('../dist-types/app/background.js');

const nativeSetTimeout = global.setTimeout;
const originalFetch = global.fetch;
let rejectionTimer;
let requests = 0;

global.setTimeout = (callback, delay, ...args) =>
  nativeSetTimeout(callback, delay === 10_000 ? 0 : delay, ...args);

global.fetch = (_url, init = {}) => new Promise((_resolve, reject) => {
  requests += 1;
  init.signal?.addEventListener('abort', () => {
    reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  });
});

(async () => {
  try {
    const results = await Promise.race([
      Promise.all([
        bg.__fetchChannelBadges('timeoutchan', ['alice']),
        bg.__fetchChannelBadges('timeoutchan', ['alice']),
      ]),
      new Promise((_resolve, reject) => {
        rejectionTimer = nativeSetTimeout(
          () => reject(new Error('background request did not settle')),
          250,
        );
      }),
    ]);

    assert.equal(requests, 1, 'same-viewer waiters must share one timed request');
    assert.equal(results.length, 2, 'all coalesced waiters must settle');
    const transientFailure = { ok: false, badges: {}, font_presets: {}, viewers: {} };
    assert.deepEqual(results[0], transientFailure, 'timeout without cached data must be a transient failure');
    assert.deepEqual(results[1], transientFailure, 'all waiters must receive the transient failure');
    assert.equal(
      bg.__getCachedChannelBadges('timeoutchan', ['alice']),
      null,
      'timeout must not cache an authoritative empty viewer',
    );

    const cooldownResult = await bg.__fetchChannelBadges('timeoutchan', ['alice']);
    assert.deepEqual(cooldownResult, transientFailure, 'cooldown lookup without cached data must stay a failure');
    assert.equal(requests, 1, 'network cooldown must suppress an immediate retry');

    bg.__seedChannelViewer('partialtimeoutchan', 'alice', { badge_ids: [], name_color: '#cached' });
    const partialResult = await bg.__fetchChannelBadges('partialtimeoutchan', ['alice', 'bob']);
    assert.deepEqual(
      partialResult,
      transientFailure,
      'network failure with incomplete cached coverage must stay a transient failure',
    );
    assert.equal(
      bg.__getCachedChannelBadges('partialtimeoutchan', ['alice']).viewers.alice.name_color,
      '#cached',
      'transient failure must retain the existing cached viewer',
    );
    assert.equal(
      bg.__getCachedChannelBadges('partialtimeoutchan', ['bob']),
      null,
      'transient failure must not cache an authoritative empty missing viewer',
    );
  } finally {
    if (rejectionTimer) clearTimeout(rejectionTimer);
    global.setTimeout = nativeSetTimeout;
    global.fetch = originalFetch;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
