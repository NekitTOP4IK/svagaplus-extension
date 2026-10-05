const assert = require('node:assert/strict');

require('./helpers/build-globals').defineBuildGlobals();
const chrome = require('./helpers/extension-env').stubExtensionApis();

const bg = require('../dist-types/app/background.js');

const nativeSetTimeout = global.setTimeout;
const originalFetch = global.fetch;

function viewersResponse(logins, version) {
  const viewers = {};
  for (const login of logins) viewers[login] = { badge_ids: [], name_color: `#${version}-${login}` };
  return { ok: true, status: 200, json: async () => ({ data: { badges: {}, font_presets: {}, viewers } }) };
}

function requestedViewers(url) {
  return new URL(url).searchParams.get('viewers').split(',');
}

async function waitFor(predicate) {
  while (!predicate()) await new Promise((resolve) => nativeSetTimeout(resolve, 0));
}

(async () => {
  try {
    const runtimeListener = chrome.__runtimeMessageListeners[0];

    // Invalidating one viewer mid-flight must refetch only that viewer.
    {
      const requests = [];
      global.fetch = (url) => new Promise((resolve) => requests.push({ url: String(url), resolve }));

      const lookup = bg.__fetchChannelBadges('stalechan', ['alice', 'bob', 'carol']);
      await waitFor(() => requests.length === 1);

      await runtimeListener(
        { type: 'INVALIDATE_TRIBUTE_BADGE_CACHE', channelLogin: 'stalechan', login: 'alice' },
        { id: chrome.runtime.id },
      );
      requests[0].resolve(viewersResponse(['alice', 'bob', 'carol'], 'old'));

      await waitFor(() => requests.length === 2);
      assert.deepEqual(requestedViewers(requests[1].url), ['alice'], 'only the invalidated viewer is refetched');
      requests[1].resolve(viewersResponse(['alice'], 'new'));

      const result = await lookup;
      assert.equal(result.ok, true);
      assert.equal(result.viewers.alice.name_color, '#new-alice');
      assert.equal(result.viewers.bob.name_color, '#old-bob');
      assert.equal(result.viewers.carol.name_color, '#old-carol');
    }

    // A realtime upsert that lands while a request is in flight wins over the late response.
    {
      const requests = [];
      global.fetch = (url) => new Promise((resolve) => requests.push({ url: String(url), resolve }));

      const lookup = bg.__fetchChannelBadges('upsertchan', ['alice']);
      await waitFor(() => requests.length === 1);
      await runtimeListener(
        { type: 'UPSERT_TRIBUTE_BADGE_CACHE', channelLogin: 'upsertchan', login: 'alice', viewer: { badge_ids: [], name_color: '#realtime' } },
        { id: chrome.runtime.id },
      );
      requests[0].resolve(viewersResponse(['alice'], 'late'));
      const result = await lookup;
      assert.equal(result.viewers.alice.name_color, '#realtime');
    }

    // Two callers whose logins straddle the 100-login chunk boundary both get complete data.
    {
      const requests = [];
      global.fetch = async (url) => {
        const logins = requestedViewers(String(url));
        requests.push(logins);
        return viewersResponse(logins, 'v');
      };
      const first = Array.from({ length: 60 }, (_, i) => `aaa${String(i).padStart(3, '0')}`);
      const second = Array.from({ length: 60 }, (_, i) => `bbb${String(i).padStart(3, '0')}`);

      const [a, b] = await Promise.all([
        bg.__fetchChannelBadges('chunkchan', first),
        bg.__fetchChannelBadges('chunkchan', second),
      ]);
      assert.equal(requests.length, 2, 'two chunks for 120 logins');
      assert.equal(a.ok, true);
      assert.equal(b.ok, true, 'caller split across chunks must not see a partial cache as a failure');
      assert.equal(Object.keys(b.viewers).length, 60);
    }

    console.log('bg-partial-stale-batch: PASS');
  } finally {
    global.fetch = originalFetch;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
