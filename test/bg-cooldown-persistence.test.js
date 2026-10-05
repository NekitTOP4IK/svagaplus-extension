const assert = require('node:assert/strict');
const test = require('node:test');

require('./helpers/build-globals').defineBuildGlobals();
const chrome = require('./helpers/extension-env').stubExtensionApis();

const { RequestCooldown, NOT_FOUND_TTL_MS } = require('../dist-types/shared/request-cooldown.js');

test('restore keeps live entries, drops expired and malformed ones, caps the TTL', () => {
  let now = 1_000_000;
  const cooldown = new RequestCooldown({ now: () => now });
  cooldown.restore({
    'channel-badges:live': { kind: 'not_found', until: now + 60_000 },
    'channel-badges:expired': { kind: 'transient', until: now - 1 },
    'channel-badges:bogus': { kind: 'forever', until: now + 60_000 },
    'channel-badges:far': { kind: 'transient', until: now + 10 * NOT_FOUND_TTL_MS },
  });
  assert.equal(cooldown.isBlocked('channel-badges:live'), true);
  assert.equal(cooldown.isBlocked('channel-badges:expired'), false);
  assert.equal(cooldown.isBlocked('channel-badges:bogus'), false);
  now += 31_000;
  assert.equal(cooldown.isBlocked('channel-badges:far'), false, 'transient entry is capped at its kind TTL');
});

test('changes are reported as a snapshot', () => {
  const snapshots = [];
  const cooldown = new RequestCooldown();
  cooldown.setChangeListener((entries) => snapshots.push(entries));
  cooldown.markFromStatus('channel-badges:x', 404);
  cooldown.clear('channel-badges:x');
  cooldown.clear('channel-badges:x');
  assert.equal(snapshots.length, 2, 'clearing a missing key is not a change');
  assert.equal(snapshots[0]['channel-badges:x'].kind, 'not_found');
  assert.deepEqual(snapshots[1], {});
});

test('background restores the cooldown from storage.session and skips the network', async () => {
  const stored = {
    apiCooldown: { 'channel-badges:sleepychan': { kind: 'not_found', until: Date.now() + 60_000 } },
  };
  const writes = [];
  chrome.storage.session.get = async () => stored;
  chrome.storage.session.set = async (items) => { writes.push(items); };

  let fetchCount = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    fetchCount += 1;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    const bg = require('../dist-types/app/background.js');
    const result = await bg.__fetchChannelBadges('sleepychan', ['alice']);
    assert.equal(fetchCount, 0, 'restored 404 cooldown must survive a service worker restart');
    assert.equal(result.ok, false);
    assert.ok(writes.some((items) => items.apiCooldown?.['channel-badges:sleepychan']));
  } finally {
    global.fetch = originalFetch;
  }
});
