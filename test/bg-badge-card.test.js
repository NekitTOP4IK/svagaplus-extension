const assert = require('node:assert/strict');
const test = require('node:test');

require('./helpers/build-globals').defineBuildGlobals();
require('./helpers/extension-env').stubExtensionApis();

const requested = [];
let status = 200;
global.fetch = async (url) => {
  requested.push(String(url));
  return {
    ok: status === 200,
    status,
    json: async () => ({ success: true, data: { kind: 'sub', name: 'Ветеран' } }),
  };
};

const bg = require('../dist-types/app/background.js');

test('fetches the card from the v3 API and links to the site page', async () => {
  const result = await bg.__fetchBadgeCard('/badges/sub/12');

  assert.deepEqual(result, { ok: true, card: { kind: 'sub', name: 'Ветеран' }, url: 'https://example.test/badges/sub/12' });
  assert.deepEqual(requested, ['https://example.test/api/v3/badges/sub/12']);
});

test('serves a repeated card from memory', async () => {
  requested.length = 0;
  await bg.__fetchBadgeCard('/badges/sub/12');
  assert.deepEqual(requested, []);
});

test('reports a missing badge', async () => {
  status = 404;
  const result = await bg.__fetchBadgeCard('/badges/collectible/nope');
  assert.deepEqual(result, { ok: false, error: 'http_404' });
});
