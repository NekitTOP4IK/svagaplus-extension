const assert = require('node:assert/strict');

require('./helpers/build-globals').defineBuildGlobals();
const chrome = require('./helpers/extension-env').stubExtensionApis();

const bg = require('../dist-types/app/background.js');

const nativeSetTimeout = global.setTimeout;
const originalFetch = global.fetch;
const pendingResponses = [];
let secondRequestStarted;
const secondStarted = new Promise((resolve) => { secondRequestStarted = resolve; });

function response(nameColor) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        badges: {},
        font_presets: {},
        viewers: { alice: { badge_ids: [], name_color: nameColor } },
      },
    }),
  };
}

global.fetch = () => new Promise((resolve) => {
  pendingResponses.push(resolve);
  if (pendingResponses.length === 2) secondRequestStarted();
});

(async () => {
  try {
    const firstLookup = bg.__fetchChannelBadges('racechan', ['alice']);
    while (pendingResponses.length < 1) {
      await new Promise((resolve) => nativeSetTimeout(resolve, 0));
    }

    const runtimeListener = chrome.__runtimeMessageListeners[0];
    assert.equal(typeof runtimeListener, 'function', 'background runtime listener must be captured');

    bg.__seedChannelViewer('alpha', 'alice', { badge_ids: [], name_color: '#alpha' });
    bg.__seedChannelViewer('beta', 'alice', { badge_ids: [], name_color: '#beta' });
    await runtimeListener(
      { type: 'INVALIDATE_TRIBUTE_BADGE_CACHE', channelLogin: 'alpha', login: 'alice' },
      { id: chrome.runtime.id },
    );
    assert.equal(
      bg.__getCachedChannelBadges('alpha', ['alice']),
      null,
      'exact invalidation must remove the viewer from its channel',
    );
    assert.equal(
      bg.__getCachedChannelBadges('beta', ['alice']).viewers.alice.name_color,
      '#beta',
      'exact invalidation must retain the same viewer in other channels',
    );

    await runtimeListener(
      { type: 'INVALIDATE_TRIBUTE_BADGE_CACHE', channelLogin: 'racechan', login: 'alice' },
      { id: chrome.runtime.id },
    );

    const secondLookup = bg.__fetchChannelBadges('racechan', ['alice']);
    const startedNewGeneration = await Promise.race([
      secondStarted.then(() => true),
      new Promise((resolve) => nativeSetTimeout(() => resolve(false), 250)),
    ]);

    if (!startedNewGeneration) {
      pendingResponses[0](response('#old'));
      await Promise.all([firstLookup, secondLookup]);
    }

    assert.equal(
      startedNewGeneration,
      true,
      'lookup after invalidation must start a new-generation request instead of reusing the old one',
    );

    pendingResponses[1](response('#new'));
    const secondResult = await secondLookup;
    assert.equal(secondResult.viewers.alice.name_color, '#new');

    pendingResponses[0](response('#old'));
    const firstResult = await firstLookup;
    assert.equal(firstResult.viewers.alice.name_color, '#new', 'invalidated caller must not return stale viewer state');
    assert.equal(
      bg.__getCachedChannelBadges('racechan', ['alice']).viewers.alice.name_color,
      '#new',
      'late old response must not overwrite the refreshed cache',
    );

    const mixedPendingResponses = [];
    let mixedSecondRequestStarted;
    const mixedSecondStarted = new Promise((resolve) => { mixedSecondRequestStarted = resolve; });
    const mixedResponse = (version) => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          badges: {},
          font_presets: {},
          viewers: {
            alice: { badge_ids: [], name_color: `#${version}-alice` },
            bob: { badge_ids: [], name_color: `#${version}-bob` },
          },
        },
      }),
    });
    global.fetch = () => new Promise((resolve) => {
      mixedPendingResponses.push(resolve);
      if (mixedPendingResponses.length === 2) mixedSecondRequestStarted();
    });

    const firstMixedLookup = bg.__fetchChannelBadges('mixedracechan', ['alice', 'bob']);
    while (mixedPendingResponses.length < 1) {
      await new Promise((resolve) => nativeSetTimeout(resolve, 0));
    }

    await runtimeListener(
      { type: 'INVALIDATE_TRIBUTE_BADGE_CACHE', channelLogin: 'mixedracechan', login: 'alice' },
      { id: chrome.runtime.id },
    );

    const secondMixedLookup = bg.__fetchChannelBadges('mixedracechan', ['alice', 'bob']);
    const mixedStartedNewGeneration = await Promise.race([
      mixedSecondStarted.then(() => true),
      new Promise((resolve) => nativeSetTimeout(() => resolve(false), 250)),
    ]);

    if (!mixedStartedNewGeneration) {
      mixedPendingResponses[0](mixedResponse('old'));
      await Promise.race([
        mixedSecondStarted,
        new Promise((_resolve, reject) => nativeSetTimeout(
          () => reject(new Error('cleanup request did not start after resolving old mixed batch')),
          500,
        )),
      ]);
      mixedPendingResponses[1](mixedResponse('new'));
      await Promise.all([firstMixedLookup, secondMixedLookup]);
    }

    assert.equal(
      mixedStartedNewGeneration,
      true,
      'mixed lookup must not wait for the old shared promise through a non-invalidated viewer',
    );

    mixedPendingResponses[1](mixedResponse('new'));
    await secondMixedLookup;

    mixedPendingResponses[0](mixedResponse('old'));
    await firstMixedLookup;

    const mixedCache = bg.__getCachedChannelBadges('mixedracechan', ['alice', 'bob']);
    assert.equal(mixedCache.viewers.alice.name_color, '#new-alice');
    assert.equal(mixedCache.viewers.bob.name_color, '#new-bob');
  } finally {
    global.fetch = originalFetch;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
