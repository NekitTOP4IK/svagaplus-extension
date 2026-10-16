const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/build-globals').defineBuildGlobals();
const chrome = require('./helpers/extension-env').stubExtensionApis();

const requests = [];
const routes = new Map();
global.fetch = async (url) => {
  requests.push(String(url));
  const path = new URL(String(url)).pathname;
  const route = routes.get(path);
  if (!route) return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
  return route();
};

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body };
}

require('../dist-types/app/background.js');
const [listener] = chrome.__runtimeMessageListeners;
const send = (message) => listener(message, { id: 'test-extension-id' });
const requestsFor = (channel) => requests.filter((url) => url.includes(`/channels/${channel}/`));

test('a known channel answers badge requests from the snapshot', async () => {
  routes.set('/api/v3/channels/snapchan/snapshot', () => json(200, {
    success: true,
    data: {
      channel: { login: 'snapchan' },
      rev: 4,
      global_rev: 2,
      badges: { b1: { image_url: '/b1.png' } },
      font_presets: {},
      viewers: { alice: { badge_ids: ['b1'] } },
    },
  }));

  assert.deepEqual(await send({ type: 'SNAPSHOT_OPEN', channelLogin: 'snapchan' }), { ok: true, mode: 'snapshot' });
  const response = await send({ type: 'FETCH_CHANNEL_BADGES', channelLogin: 'snapchan', logins: ['alice', 'bob'] });
  assert.deepEqual(response, {
    ok: true,
    badges: { b1: { image_url: '/b1.png' } },
    font_presets: {},
    viewers: { alice: { badge_ids: ['b1'] }, bob: { badge_ids: [] } },
  });

  await send({
    type: 'SNAPSHOT_EVENT',
    channelLogin: 'snapchan',
    event: { type: 'user_update', rev: 5, data: { twitch_username: 'bob', badge_ids: ['b1'], badges: { b1: { image_url: '/b1.png' } } } },
  });
  const patched = await send({ type: 'FETCH_CHANNEL_BADGES', channelLogin: 'snapchan', logins: ['bob'] });
  assert.deepEqual(patched.viewers, { bob: { badge_ids: ['b1'] } });
  assert.deepEqual(requestsFor('snapchan'), ['https://example.test/api/v3/channels/snapchan/snapshot']);
});

test('an unknown channel answers empty and needs no socket', async () => {
  routes.set('/api/v3/channels/ghostchan/snapshot', () => json(404, { success: false, error: 'channel_not_found' }));

  assert.deepEqual(await send({ type: 'SNAPSHOT_OPEN', channelLogin: 'ghostchan' }), { ok: true, mode: 'unknown' });
  const response = await send({ type: 'FETCH_CHANNEL_BADGES', channelLogin: 'ghostchan', logins: ['alice'] });
  assert.deepEqual(response, { ok: true, badges: {}, font_presets: {}, viewers: { alice: { badge_ids: [] } } });
  assert.equal(requestsFor('ghostchan').length, 1);
});

test('an old backend without the snapshot route keeps the batch path', async () => {
  routes.set('/api/v3/channels/oldchan/badges', () => json(200, {
    data: { badges: {}, font_presets: {}, viewers: { alice: { badge_ids: [], name_color: '#123456' } } },
  }));

  assert.deepEqual(await send({ type: 'SNAPSHOT_OPEN', channelLogin: 'oldchan' }), { ok: true, mode: 'legacy' });
  const response = await send({ type: 'FETCH_CHANNEL_BADGES', channelLogin: 'oldchan', logins: ['alice'] });
  assert.deepEqual(response.viewers, { alice: { badge_ids: [], name_color: '#123456' } });
  assert.deepEqual(requestsFor('oldchan').map((url) => new URL(url).pathname), [
    '/api/v3/channels/oldchan/snapshot',
    '/api/v3/channels/oldchan/badges',
  ]);
});

test('snapshot messages reject malformed input', async () => {
  assert.deepEqual(await send({ type: 'SNAPSHOT_OPEN', channelLogin: 'x' }), { ok: false, error: 'bad_request' });
  assert.deepEqual(await send({ type: 'SNAPSHOT_SYNC', channelLogin: 'snapchan', rev: 'a', global_rev: 1 }), { ok: false, error: 'bad_request' });
  assert.deepEqual(await send({ type: 'SNAPSHOT_EVENT', channelLogin: 'snapchan', event: { type: 'nope' } }), { ok: false, error: 'bad_request' });
});
