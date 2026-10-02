const assert = require('node:assert/strict');
const test = require('node:test');

require('./helpers/build-globals').defineBuildGlobals();
const chrome = require('./helpers/extension-env').stubExtensionApis();

const store = {};
chrome.storage.local.get = (keys) => {
  const list = Array.isArray(keys) ? keys : [keys];
  return Promise.resolve(Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]])));
};
chrome.storage.local.set = (patch) => {
  Object.assign(store, patch);
  return Promise.resolve();
};

const fetchCalls = [];
global.fetch = async (url, init = {}) => {
  fetchCalls.push({ url: String(url), method: init.method ?? 'GET' });
  if (String(url).endsWith('/api/v3/social/aliases')) {
    return new Response(JSON.stringify([{ target_login: 'remote', alias: 'С сервера' }]), { status: 200 });
  }
  return new Response('{}', { status: 200 });
};

const { syncAliasesIfStale, ALIAS_SYNC_MIN_INTERVAL_MS } = require('../dist-types/features/social-rating/background.js');

const ACCOUNT = { token: 't', twitchLogin: 'me', avatarUrl: null, telegramLinked: true, lastCheckedAt: 1 };

test.beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  fetchCalls.length = 0;
});

test('without an account nothing is requested', async () => {
  const res = await syncAliasesIfStale();
  assert.deepEqual(res, { ok: false, error: 'not_authenticated' });
  assert.equal(fetchCalls.length, 0);
});

test('first sync merges server aliases and pushes local-only ones', async () => {
  store.svagaplus_viewer_account = ACCOUNT;
  store.aliases = { local: 'Локальный' };

  const res = await syncAliasesIfStale();
  assert.equal(res.ok, true);
  assert.deepEqual(store.aliases, { remote: 'С сервера', local: 'Локальный' });
  assert.ok(typeof store.aliasesSyncedAt === 'number');
  assert.ok(fetchCalls.some((c) => c.url.endsWith('/api/v3/social/aliases/import') && c.method === 'POST'));
});

test('service-worker wake-ups within the interval do not hit the server again', async () => {
  store.svagaplus_viewer_account = ACCOUNT;
  store.aliasesSyncedAt = Date.now() - 1000;

  const res = await syncAliasesIfStale();
  assert.deepEqual(res, { ok: true, skipped: true });
  assert.equal(fetchCalls.length, 0);
});

test('stale sync runs again', async () => {
  store.svagaplus_viewer_account = ACCOUNT;
  store.aliasesSyncedAt = Date.now() - ALIAS_SYNC_MIN_INTERVAL_MS - 1;

  const res = await syncAliasesIfStale();
  assert.equal(res.ok, true);
  assert.ok(fetchCalls.some((c) => c.url.endsWith('/api/v3/social/aliases')));
});
