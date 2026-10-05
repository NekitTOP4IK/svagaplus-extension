const assert = require('assert');

require('./helpers/build-globals').defineBuildGlobals();
const chrome = require('./helpers/extension-env').stubExtensionApis();

const originalFetch = global.fetch;

function mockFetch(handler) {
  const calls = [];
  global.fetch = async (url, init) => {
    const href = typeof url === 'string' ? url : String(url);
    calls.push({ url: href, init });
    return handler(href, init, calls);
  };
  return {
    calls,
    restore() {
      global.fetch = originalFetch;
    },
  };
}

function jsonResponse(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

async function main() {
  const bg = require('../dist-types/app/background.js');
  const { fetchRatingForCard } = require('../dist-types/features/social-rating/background.js');
  const { apiCooldown, channelBadgesKey } = require('../dist-types/shared/request-cooldown.js');
  const runtimeListener = chrome.__runtimeMessageListeners[0];

  apiCooldown.clearPrefix('channel-badges:');

  // ── 1. 404 → one network call; other viewers on the same channel stay off the network.
  {
    const mock = mockFetch(() => jsonResponse(404, { detail: 'not found' }));
    try {
      await Promise.all([
        bg.__fetchChannelBadges('jeens', ['alice']),
        bg.__fetchChannelBadges('jeens', ['alice']),
      ]);
      await bg.__fetchChannelBadges('jeens', ['bob']);
      await bg.__fetchChannelBadges('jeens', ['carol']);

      const badgeCalls = mock.calls.filter((c) => c.url.includes('/channels/jeens/badges'));
      assert.strictEqual(badgeCalls.length, 1, `expected 1 badges fetch, got ${badgeCalls.length}`);
      assert.strictEqual(apiCooldown.isBlocked(channelBadgesKey('jeens')), true);
    } finally {
      mock.restore();
    }
  }

  // ── 2. Channel invalidation clears the cooldown → fetch allowed again.
  {
    await runtimeListener(
      { type: 'INVALIDATE_TRIBUTE_BADGE_CACHE', channelLogin: 'jeens' },
      { id: chrome.runtime.id },
    );
    assert.strictEqual(apiCooldown.isBlocked(channelBadgesKey('jeens')), false);

    const mock = mockFetch(() => jsonResponse(404, { detail: 'not found' }));
    try {
      await bg.__fetchChannelBadges('jeens', ['dave']);
      const badgeCalls = mock.calls.filter((c) => c.url.includes('/channels/jeens/badges'));
      assert.strictEqual(badgeCalls.length, 1, 'fetch after invalidate must hit the network again');
    } finally {
      mock.restore();
    }
  }

  // ── 3. Network error does not throw and blocks with a transient cooldown.
  {
    let fetchCount = 0;
    const mock = mockFetch(() => {
      fetchCount += 1;
      throw new Error('network down');
    });
    try {
      const first = await bg.__fetchChannelBadges('netfail', ['user1']);
      assert.strictEqual(first.ok, false);
      assert.strictEqual(fetchCount, 1);

      const again = await bg.__fetchChannelBadges('netfail', ['user2']);
      assert.strictEqual(again.ok, false);
      assert.strictEqual(fetchCount, 1, 'transient cooldown must suppress retry');
      assert.strictEqual(apiCooldown.get(channelBadgesKey('netfail')).kind, 'transient');
    } finally {
      mock.restore();
    }
  }

  // ── 4. Rating negative cache: 404 once, second call 0 network.
  {
    const fetchCalls = [];
    global.fetch = async (url) => {
      fetchCalls.push(String(url));
      return { ok: false, status: 404, json: async () => ({}) };
    };
    try {
      const r1 = await fetchRatingForCard('alice', 'otherchannel');
      const r2 = await fetchRatingForCard('alice', 'otherchannel');
      assert.strictEqual(r1, null);
      assert.strictEqual(r2, null);
      assert.strictEqual(fetchCalls.length, 1, 'rating 404 should hit network once');
    } finally {
      global.fetch = originalFetch;
    }
  }

  console.log('api-failure-cooldown.test.js: all passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
