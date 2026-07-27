const assert = require('assert');

require('./helpers/build-globals').defineBuildGlobals();
require('./helpers/extension-env').stubExtensionApis();

const bg = require('../dist-types/app/background.js');
const requests = [];

global.fetch = async (url) => {
  const logins = new URL(String(url)).searchParams.get('viewers').split(',');
  requests.push(logins);
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        badges: {},
        font_presets: {},
        viewers: Object.fromEntries(logins.map((login) => [login, { badge_ids: [] }])),
      },
    }),
  };
};

(async () => {
  await Promise.all([
    bg.__fetchChannelBadges('coalescechan', ['alice']),
    bg.__fetchChannelBadges('coalescechan', ['bob']),
    bg.__fetchChannelBadges('coalescechan', ['carol']),
  ]);

  assert.deepStrictEqual(
    requests,
    [['alice', 'bob', 'carol']],
    `simultaneous single-viewer lookups must share one request, got ${JSON.stringify(requests)}`,
  );

  console.log('bg-shared-badge-coalescing: PASS');
})().catch((error) => {
  console.error('bg-shared-badge-coalescing: FAIL', error);
  process.exit(1);
});
