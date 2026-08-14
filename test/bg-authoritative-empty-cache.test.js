const assert = require('node:assert/strict');
require('./helpers/build-globals').defineBuildGlobals();
require('./helpers/extension-env').stubExtensionApis();
const bg = require('../dist-types/app/background.js');

let requests = 0;
global.fetch = async () => {
  requests += 1;
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        badges: {},
        font_presets: {},
        viewers: { bob: { badge_ids: [], color: '#123456' } },
      },
    }),
  };
};

(async () => {
  const logins = ['alice', 'bob', 'carol'];
  await bg.__fetchChannelBadges('mixedchan', logins);
  await bg.__fetchChannelBadges('mixedchan', logins);

  assert.equal(requests, 1, 'successful mixed response must cache every requested viewer');
  assert.deepEqual(bg.__getCachedChannelBadges('mixedchan', logins).viewers, {
    alice: { badge_ids: [] },
    bob: { badge_ids: [], color: '#123456' },
    carol: { badge_ids: [] },
  });
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
