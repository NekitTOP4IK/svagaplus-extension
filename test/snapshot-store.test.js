const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ChannelSnapshotStore } = require('../dist-types/features/tribute-badges/snapshot-store.js');
const { RequestCooldown, channelBadgesKey } = require('../dist-types/shared/request-cooldown.js');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function snapshotBody(rev, globalRev, viewers = {}, badges = {}, fontPresets = {}) {
  return {
    success: true,
    data: { channel: { login: 'olesha' }, rev, global_rev: globalRev, badges, font_presets: fontPresets, viewers },
  };
}

function reply(status, body, etag) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => (name.toLowerCase() === 'etag' ? etag ?? null : null) },
    json: async () => body,
  };
}

function okSnapshot(rev, globalRev, viewers, badges, fontPresets) {
  return reply(200, snapshotBody(rev, globalRev, viewers, badges, fontPresets), `"${rev}.${globalRev}"`);
}

function harness(responses, options = {}) {
  const calls = [];
  const queue = [...responses];
  const fetch = async (url, init) => {
    calls.push({ url, headers: { ...(init?.headers || {}) } });
    const next = queue.shift();
    if (!next) throw new Error('unexpected fetch');
    const value = typeof next === 'function' ? await next() : next;
    if (value instanceof Error) throw value;
    return value;
  };
  const cooldown = new RequestCooldown();
  const store = new ChannelSnapshotStore({
    backendUrl: 'https://example.test',
    fetch,
    cooldown,
    holdMs: 30,
    jitterMs: 0,
    random: () => 0,
    ...options,
  });
  return { store, calls, cooldown, queue };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const ALICE = { badge_ids: ['b1'], name_color: '#ff0000', font_preset_id: 'f1' };

test('200 snapshot answers every login with no further requests', async () => {
  const { store, calls } = harness([
    okSnapshot(10, 3, { alice: ALICE }, { b1: { image_url: '/b1.png' }, b2: { image_url: '/b2.png' } }, { f1: { name: 'F' } }),
  ]);
  assert.equal(await store.open('olesha'), 'snapshot');
  assert.equal(calls[0].url, 'https://example.test/api/v3/channels/olesha/snapshot');

  const answer = await store.answer('olesha', ['alice', 'bob']);
  assert.deepEqual(answer, {
    ok: true,
    badges: { b1: { image_url: '/b1.png' } },
    font_presets: { f1: { name: 'F' } },
    viewers: { alice: ALICE, bob: { badge_ids: [] } },
  });
  await store.answer('olesha', ['carol']);
  assert.equal(calls.length, 1);
});

test('answer loads the snapshot lazily when no tab opened it', async () => {
  const { store, calls } = harness([okSnapshot(1, 1, { alice: ALICE })]);
  const answer = await store.answer('olesha', ['alice']);
  assert.deepEqual(answer.viewers.alice, ALICE);
  assert.equal(calls.length, 1);
});

test('tabs opening the same channel share one request', async () => {
  const { store, calls } = harness([okSnapshot(1, 1)]);
  const modes = await Promise.all([store.open('olesha'), store.open('olesha')]);
  assert.deepEqual(modes, ['snapshot', 'snapshot']);
  assert.equal(await store.open('olesha'), 'snapshot');
  assert.equal(calls.length, 1);
});

test('channel_not_found marks the channel unknown for the cooldown period', async () => {
  const { store, calls, cooldown } = harness([
    reply(404, { success: false, error: 'channel_not_found' }),
  ]);
  assert.equal(await store.open('nobody'), 'unknown');
  assert.equal(cooldown.get(channelBadgesKey('nobody'))?.kind, 'not_found');
  assert.deepEqual(await store.answer('nobody', ['alice']), {
    ok: true, badges: {}, font_presets: {}, viewers: { alice: { badge_ids: [] } },
  });
  assert.equal(await store.open('nobody'), 'unknown');
  assert.equal(calls.length, 1);
});

test('a channel already in not_found cooldown is unknown without a request', async () => {
  const { store, calls, cooldown } = harness([]);
  cooldown.mark(channelBadgesKey('nobody'), 'not_found');
  assert.equal(await store.open('nobody'), 'unknown');
  assert.equal(calls.length, 0);
});

for (const [name, response] of [
  ['plain 404 from an old backend', reply(404, { success: false })],
  ['5xx', reply(503, {})],
  ['network failure', new Error('offline')],
  ['malformed body', reply(200, { success: true, data: { viewers: {} } })],
]) {
  test(`${name} falls back to legacy mode`, async () => {
    const { store, calls, cooldown } = harness([response]);
    assert.equal(await store.open('olesha'), 'legacy');
    assert.equal(await store.answer('olesha', ['alice']), null);
    assert.equal(cooldown.isBlocked(channelBadgesKey('olesha')), false);
    assert.equal(await store.open('olesha'), 'legacy');
    assert.equal(calls.length, 1);
  });
}

test('user_update with the next rev patches the viewer without a request', async () => {
  const { store, calls } = harness([okSnapshot(10, 3, { alice: ALICE }, { b1: {} }, { f1: {} })]);
  await store.open('olesha');

  store.event('olesha', {
    type: 'user_update',
    rev: 11,
    data: {
      twitch_username: 'Bob',
      badge_ids: ['b9'],
      name_color: '#00ff00',
      font_preset_id: 'f9',
      badges: { b9: { image_url: '/b9.png' } },
      font_presets: { f9: { name: 'Nine' } },
    },
  });
  assert.equal(store.revisionOf('olesha'), 11);
  assert.deepEqual(await store.answer('olesha', ['bob']), {
    ok: true,
    badges: { b9: { image_url: '/b9.png' } },
    font_presets: { f9: { name: 'Nine' } },
    viewers: { bob: { badge_ids: ['b9'], name_color: '#00ff00', font_preset_id: 'f9' } },
  });

  store.event('olesha', { type: 'user_update', rev: 11, data: { twitch_username: 'bob', badge_ids: [] } });
  store.event('olesha', { type: 'user_update', rev: 5, data: { twitch_username: 'alice', badge_ids: [] } });
  assert.deepEqual((await store.answer('olesha', ['alice', 'bob'])).viewers, {
    alice: ALICE,
    bob: { badge_ids: ['b9'], name_color: '#00ff00', font_preset_id: 'f9' },
  });
  assert.equal(calls.length, 1);
});

test('out-of-order revs within the hold window apply without a refetch', async () => {
  const { store, calls } = harness([okSnapshot(10, 3)]);
  await store.open('olesha');
  store.event('olesha', { type: 'user_update', rev: 12, data: { twitch_username: 'bob', badge_ids: [] } });
  store.event('olesha', { type: 'user_update', rev: 11, data: { twitch_username: 'alice', badge_ids: ['b1'], badges: { b1: {} } } });
  assert.equal(store.revisionOf('olesha'), 12);
  await wait(60);
  assert.equal(calls.length, 1);
});

test('a gap that is not filled within the hold window refetches', async () => {
  const { store, calls } = harness([
    okSnapshot(10, 3),
    okSnapshot(13, 3, { bob: { badge_ids: ['b2'] } }, { b2: {} }),
  ]);
  await store.open('olesha');
  store.event('olesha', { type: 'user_update', rev: 12, data: { twitch_username: 'bob', badge_ids: ['b2'], badges: { b2: {} } } });
  const answer = await store.answer('olesha', ['bob']);
  assert.deepEqual(answer.viewers.bob, { badge_ids: ['b2'] });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers['If-None-Match'], '"10.3"');
  assert.equal(store.revisionOf('olesha'), 13);
});

test('channel_refresh refetches and answers wait for the new snapshot', async () => {
  const { store, calls } = harness([
    okSnapshot(10, 3, { alice: ALICE }, { b1: {} }, { f1: {} }),
    okSnapshot(11, 3, {}),
  ], { jitterMs: 40, random: () => 0.5 });
  await store.open('olesha');
  store.event('olesha', { type: 'channel_refresh', rev: 11 });
  store.event('olesha', { type: 'channel_refresh', rev: 11 });
  const answer = await store.answer('olesha', ['alice']);
  assert.deepEqual(answer.viewers, { alice: { badge_ids: [] } });
  assert.equal(calls.length, 2);
});

test('badge_grants_updated refetches', async () => {
  const { store, calls } = harness([okSnapshot(10, 3), okSnapshot(11, 3)]);
  await store.open('olesha');
  store.event('olesha', { type: 'badge_grants_updated', rev: 11 });
  await store.answer('olesha', ['alice']);
  assert.equal(calls.length, 2);
  assert.equal(store.revisionOf('olesha'), 11);
});

test('viewer_refresh refetches only on a global_rev mismatch', async () => {
  const { store, calls } = harness([okSnapshot(10, 3), okSnapshot(10, 4)]);
  await store.open('olesha');
  store.event('olesha', { type: 'viewer_refresh', global_rev: 3 });
  await store.answer('olesha', ['alice']);
  assert.equal(calls.length, 1);
  store.event('olesha', { type: 'viewer_refresh', global_rev: 4 });
  await store.answer('olesha', ['alice']);
  assert.equal(calls.length, 2);
});

test('join ack sync refetches once on a mismatch', async () => {
  const { store, calls } = harness([okSnapshot(10, 3), okSnapshot(12, 3)]);
  await store.open('olesha');
  store.sync('olesha', 10, 3, false);
  await store.answer('olesha', []);
  assert.equal(calls.length, 1);
  store.sync('olesha', 12, 3, true);
  store.sync('olesha', 12, 3, true);
  await store.answer('olesha', ['alice']);
  assert.equal(calls.length, 2);
  assert.equal(store.revisionOf('olesha'), 12);
});

test('304 keeps the loaded data', async () => {
  const { store, calls } = harness([okSnapshot(10, 3, { alice: ALICE }, { b1: {} }, { f1: {} }), reply(304, null)]);
  await store.open('olesha');
  store.sync('olesha', 10, 4, false);
  const answer = await store.answer('olesha', ['alice']);
  assert.deepEqual(answer.viewers.alice, ALICE);
  assert.equal(calls.length, 2);
  assert.equal(store.revisionOf('olesha'), 10);
});

test('events during an in-flight fetch apply only when newer than the snapshot', async () => {
  const gate = deferred();
  const { store, calls } = harness([async () => { await gate.promise; return okSnapshot(10, 3, { alice: ALICE }, { b1: {} }, { f1: {} }); }]);
  const opening = store.open('olesha');
  store.event('olesha', { type: 'user_update', rev: 9, data: { twitch_username: 'alice', badge_ids: [] } });
  store.event('olesha', { type: 'user_update', rev: 11, data: { twitch_username: 'bob', badge_ids: ['b1'], badges: { b1: {} } } });
  gate.resolve();
  assert.equal(await opening, 'snapshot');
  const answer = await store.answer('olesha', ['alice', 'bob']);
  assert.deepEqual(answer.viewers, { alice: ALICE, bob: { badge_ids: ['b1'] } });
  assert.equal(store.revisionOf('olesha'), 11);
  assert.equal(calls.length, 1);
});

test('a failed refetch drops to legacy mode', async () => {
  const { store } = harness([okSnapshot(10, 3), reply(500, {})]);
  await store.open('olesha');
  store.event('olesha', { type: 'channel_refresh', rev: 11 });
  assert.equal(await store.answer('olesha', ['alice']), null);
});

test('events in legacy mode are ignored', async () => {
  const { store, calls } = harness([reply(404, {})]);
  await store.open('olesha');
  store.event('olesha', { type: 'channel_refresh', rev: 11 });
  store.sync('olesha', 11, 1, true);
  await wait(10);
  assert.equal(calls.length, 1);
});

test('user_update without rev patches a loaded snapshot', async () => {
  const { store, calls } = harness([okSnapshot(10, 3)]);
  await store.open('olesha');
  store.event('olesha', { type: 'user_update', data: { twitch_username: 'bob', badge_ids: ['b1'], badges: { b1: {} } } });
  assert.deepEqual((await store.answer('olesha', ['bob'])).viewers.bob, { badge_ids: ['b1'] });
  assert.equal(store.revisionOf('olesha'), 10);
  assert.equal(calls.length, 1);
});

test('user_update that cannot be patched refetches', async () => {
  const { store, calls } = harness([okSnapshot(10, 3), okSnapshot(11, 3, { bob: { badge_ids: ['b1'] } }, { b1: {} })]);
  await store.open('olesha');
  store.event('olesha', { type: 'user_update', rev: 11, data: { twitch_username: 'bob' } });
  assert.deepEqual((await store.answer('olesha', ['bob'])).viewers.bob, { badge_ids: ['b1'] });
  assert.equal(calls.length, 2);
});

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: async (key) => values.get(key),
    set: async (key, value) => { values.set(key, JSON.parse(JSON.stringify(value))); },
    remove: async (key) => { values.delete(key); },
  };
}

test('a restarted worker revalidates the stored snapshot and answers from it on 304', async () => {
  const storage = memoryStorage();
  const first = harness([okSnapshot(10, 3, { alice: ALICE }, { b1: { url: 'b1' } })], { storage });
  await first.store.open('olesha');
  assert.ok(storage.values.has('channel-snapshot:olesha'));

  const restarted = harness([reply(304, null)], { storage });
  const answer = await restarted.store.answer('olesha', ['alice']);
  assert.equal(restarted.calls.length, 1);
  assert.equal(restarted.calls[0].headers['If-None-Match'], '"10.3"');
  assert.deepEqual(answer.viewers.alice.badge_ids, ['b1']);
  assert.deepEqual(answer.badges, { b1: { url: 'b1' } });
  assert.equal(restarted.store.revisionOf('olesha'), 10);
});

test('a stored snapshot that changed while the worker slept is replaced', async () => {
  const storage = memoryStorage();
  await harness([okSnapshot(10, 3, { alice: ALICE })], { storage }).store.open('olesha');

  const restarted = harness([okSnapshot(11, 3, { alice: { badge_ids: ['b2'] } })], { storage });
  const answer = await restarted.store.answer('olesha', ['alice']);
  assert.deepEqual(answer.viewers.alice.badge_ids, ['b2']);
  assert.equal(storage.values.get('channel-snapshot:olesha').data.rev, 11);
});

test('corrupted or unreadable stored snapshots fall back to a plain fetch', async () => {
  const corrupted = memoryStorage({ 'channel-snapshot:olesha': { etag: '"1.1"', data: { rev: 'x' } } });
  const a = harness([okSnapshot(10, 3)], { storage: corrupted });
  await a.store.open('olesha');
  assert.equal(a.calls[0].headers['If-None-Match'], undefined);

  const failing = { get: async () => { throw new Error('quota'); }, set: async () => { throw new Error('quota'); }, remove: async () => {} };
  const b = harness([okSnapshot(10, 3)], { storage: failing });
  assert.equal(await b.store.open('olesha'), 'snapshot');
  assert.equal(b.calls[0].headers['If-None-Match'], undefined);
});

test('a channel that turns unknown drops its stored snapshot', async () => {
  const storage = memoryStorage();
  await harness([okSnapshot(10, 3)], { storage }).store.open('olesha');
  const restarted = harness([reply(404, { error: 'channel_not_found' })], { storage });
  assert.equal(await restarted.store.open('olesha'), 'unknown');
  assert.equal(storage.values.has('channel-snapshot:olesha'), false);
});
