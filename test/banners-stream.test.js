const assert = require('node:assert/strict');
const test = require('node:test');

require('./helpers/build-globals').defineBuildGlobals();
const { installFakeBrowser } = require('./helpers/fake-browser');
const { installFakeIo } = require('./helpers/fake-io');

const fake = installFakeBrowser();
const io = installFakeIo();

const { applySnapshot, startBannerStream } = require('../dist-types/features/banners/stream.js');
const { startBannerChecks } = require('../dist-types/features/banners/background.js');
const { BANNER_STATE_KEY } = require('../dist-types/shared/storage.js');
const { getSharedSocket } = require('../dist-types/shared/socket.js');

const wire = (id, extra = {}) => ({
  id,
  type: 'info',
  title: null,
  message: `banner ${id}`,
  dismissible: true,
  targets: ['chat', 'popup'],
  ...extra,
});
const snap = (revision, ...ids) => ({ revision, banners: ids.map((id) => wire(id)) });

function reset(state) {
  for (const key of Object.keys(fake.store)) delete fake.store[key];
  if (state) fake.store[BANNER_STATE_KEY] = state;
  fake.setCalls = 0;
}

const stored = () => fake.store[BANNER_STATE_KEY];

test('the same revision is written once', async () => {
  reset();
  assert.equal(await applySnapshot(snap('r1', 1)), true);
  assert.equal(await applySnapshot(snap('r1', 1)), false);
  assert.equal(fake.setCalls, 1);
  assert.equal(stored().snapshot.revision, 'r1');
});

test('a new revision replaces the snapshot', async () => {
  reset();
  await applySnapshot(snap('r1', 1));
  assert.equal(await applySnapshot(snap('r2', 1, 2)), true);
  assert.deepEqual(stored().snapshot.banners.map((b) => b.id), [1, 2]);
  assert.equal(fake.setCalls, 2);
});

test('garbage leaves storage untouched', async () => {
  reset();
  for (const raw of [null, 'x', 42, {}, { revision: 1, banners: [] }, { revision: 'r', banners: 'no' }]) {
    assert.equal(await applySnapshot(raw), false);
  }
  assert.equal(fake.setCalls, 0);
});

test('a stored snapshot drops dismissed ids that are gone from it', async () => {
  reset({ snapshot: snap('r1', 1, 2, 3), dismissed: [1, 2, 3] });
  assert.equal(await applySnapshot(snap('r2', 2, 4)), true);
  assert.deepEqual(stored().dismissed, [2]);
  assert.deepEqual(stored().snapshot.banners.map((b) => b.id), [2, 4]);
});

test('startBannerStream subscribes on connect and stores streamed snapshots', async () => {
  reset();
  startBannerStream();
  const socket = io.socket();
  assert.deepEqual(socket.emits, []);

  socket.fire('connect');
  assert.deepEqual(socket.emits, [['subscribe_banners']]);

  socket.fire('extension_banners', snap('r9', 7));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stored().snapshot.revision, 'r9');
  assert.deepEqual(stored().snapshot.banners.map((b) => b.id), [7]);

  socket.fire('disconnect', 'transport close');
  socket.fire('connect');
  assert.equal(socket.emits.filter(([event]) => event === 'subscribe_banners').length, 2);

  getSharedSocket().state();
});

test('startBannerChecks registers listeners synchronously and arms the alarm', async () => {
  startBannerChecks();
  assert.equal(fake.onAlarm.list.length, 1);
  assert.equal(fake.onStartup.list.length, 1);
  assert.equal(fake.onInstalled.list.length, 1);

  reset();
  const requests = [];
  global.fetch = async (url, init) => {
    requests.push([url, init]);
    return requests.length === 1
      ? { ok: true, status: 200, json: async () => snap('r5', 1) }
      : { ok: false, status: 304, json: async () => assert.fail('304 has no body') };
  };

  fake.onInstalled.list[0]({ reason: 'install' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(fake.alarmCreates.at(-1), ['svagaplus-banners-check', { periodInMinutes: 30 }]);
  assert.equal(requests[0][0], 'https://example.test/api/extension/banners');
  assert.equal(stored().snapshot.revision, 'r5');
  assert.equal(fake.setCalls, 1);

  fake.onAlarm.list[0]({ name: 'svagaplus-banners-check' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(requests[1][1].headers['If-None-Match'], '"r5"');
  assert.equal(fake.setCalls, 1);

  fake.onAlarm.list[0]({ name: 'something-else' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(requests.length, 2);
});

test('a failed poll changes nothing', async () => {
  reset();
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  fake.onStartup.list[0]();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fake.setCalls, 0);
  global.fetch = async () => { throw new Error('offline'); };
  fake.onStartup.list[0]();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fake.setCalls, 0);
});
