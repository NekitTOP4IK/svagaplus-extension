const assert = require('assert');

// webextension-polyfill throws when loaded outside an extension; stub before require.
const polyfillPath = require.resolve('webextension-polyfill');
require.cache[polyfillPath] = {
  id: polyfillPath,
  filename: polyfillPath,
  loaded: true,
  exports: {
    runtime: { sendMessage: async () => ({}) },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      },
    },
  },
};

// tsc leaves webpack DefinePlugin globals unresolved; set them for node tests.
global.__BACKEND_URL__ = 'https://example.test';
global.__FRONTEND_URL__ = 'https://example.test';
global.__WS_BACKEND_URL__ = 'wss://example.test';

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
  const {
    prefetchChannelBadgeGrants,
    fetchBadgeGrants,
    invalidateChannelBadgeGrants,
    fetchRatingForCard,
  } = require('../dist-types/features/social-rating/background.js');
  const { apiCooldown, channelBadgesKey } = require('../dist-types/shared/request-cooldown.js');

  // Reset singleton cooldown between sections.
  apiCooldown.clearPrefix('channel-badges:');
  invalidateChannelBadgeGrants();

  // ── 1. Triple prefetch on 404 → exactly one network call to badges (no viewers).
  {
    const mock = mockFetch(() => jsonResponse(404, { detail: 'not found' }));
    try {
      await Promise.all([
        prefetchChannelBadgeGrants('jeens'),
        prefetchChannelBadgeGrants('jeens'),
        prefetchChannelBadgeGrants('jeens'),
      ]);
      // Sequential triple after first settles also must not re-hit network.
      await prefetchChannelBadgeGrants('jeens');
      await prefetchChannelBadgeGrants('jeens');

      const badgeCalls = mock.calls.filter((c) => c.url.includes('/channels/jeens/badges'));
      assert.strictEqual(badgeCalls.length, 1, `expected 1 badges fetch, got ${badgeCalls.length}`);
      assert.ok(
        !badgeCalls[0].url.includes('viewers='),
        `prefetch must not include viewers param: ${badgeCalls[0].url}`,
      );
      assert.strictEqual(apiCooldown.isBlocked(channelBadgesKey('jeens')), true);
    } finally {
      mock.restore();
    }
  }

  // ── 2. After prefetch 404, fetchBadgeGrants for different logins → 0 additional network.
  {
    const mock = mockFetch(() => {
      throw new Error('unexpected fetch after channel badges cooldown');
    });
    try {
      const a = await fetchBadgeGrants('jeens', ['alice']);
      const b = await fetchBadgeGrants('jeens', ['bob']);
      assert.deepStrictEqual(a, []);
      assert.deepStrictEqual(b, []);
      assert.strictEqual(mock.calls.length, 0, `expected 0 network after cooldown, got ${mock.calls.length}`);
    } finally {
      mock.restore();
    }
  }

  // ── 3. invalidateChannelBadgeGrants clears cooldown → prefetch allowed again.
  {
    invalidateChannelBadgeGrants('jeens');
    assert.strictEqual(apiCooldown.isBlocked(channelBadgesKey('jeens')), false);

    const mock = mockFetch(() => jsonResponse(404, { detail: 'not found' }));
    try {
      await prefetchChannelBadgeGrants('jeens');
      const badgeCalls = mock.calls.filter((c) => c.url.includes('/channels/jeens/badges'));
      assert.strictEqual(badgeCalls.length, 1, 'prefetch after invalidate must fetch again');
    } finally {
      mock.restore();
    }
  }

  // ── 4. Grants-alone path: first 404 once, second different login 0 network.
  {
    apiCooldown.clearPrefix('channel-badges:');
    invalidateChannelBadgeGrants();

    let fetchCount = 0;
    const mock = mockFetch(() => {
      fetchCount += 1;
      return jsonResponse(404, { detail: 'not found' });
    });
    try {
      const first = await fetchBadgeGrants('otherchan', ['alice']);
      assert.deepStrictEqual(first, []);
      assert.strictEqual(fetchCount, 1);

      const second = await fetchBadgeGrants('otherchan', ['bob']);
      assert.deepStrictEqual(second, []);
      assert.strictEqual(fetchCount, 1, 'channel-level cooldown must block second grants fetch');
      assert.strictEqual(apiCooldown.isBlocked(channelBadgesKey('otherchan')), true);
    } finally {
      mock.restore();
    }
  }

  // ── 5. Empty OK viewers still caches channel map (no re-fetch until invalidate).
  {
    apiCooldown.clearPrefix('channel-badges:');
    invalidateChannelBadgeGrants();

    let fetchCount = 0;
    const mock = mockFetch(() => {
      fetchCount += 1;
      return jsonResponse(200, { data: { viewers: {}, badges: {} } });
    });
    try {
      await prefetchChannelBadgeGrants('emptychan');
      await prefetchChannelBadgeGrants('emptychan');
      assert.strictEqual(fetchCount, 1, 'empty viewers must still write channelGrantsMap cache');
    } finally {
      mock.restore();
    }
  }

  // ── 6. Network error returns [] (does not throw) and blocks transient cooldown.
  {
    apiCooldown.clearPrefix('channel-badges:');
    invalidateChannelBadgeGrants();

    let fetchCount = 0;
    const mock = mockFetch(() => {
      fetchCount += 1;
      throw new Error('network down');
    });
    try {
      const grants = await fetchBadgeGrants('netfail', ['user1']);
      assert.deepStrictEqual(grants, []);
      assert.strictEqual(fetchCount, 1);

      const again = await fetchBadgeGrants('netfail', ['user2']);
      assert.deepStrictEqual(again, []);
      assert.strictEqual(fetchCount, 1, 'transient cooldown must suppress retry');
    } finally {
      mock.restore();
    }
  }

  // ── 7. Rating negative cache: 404 once, second call 0 network.
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
