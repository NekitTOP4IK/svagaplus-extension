const assert = require('assert');

require('./helpers/build-globals').defineBuildGlobals();
require('./helpers/extension-env').stubExtensionApis();

const bg = require('../dist-types/app/background.js');

let releaseAlice;
let aliceRequestStarted;
const aliceStarted = new Promise((resolve) => { aliceRequestStarted = resolve; });
const requestedViewers = [];

global.fetch = async (url) => {
  const viewers = new URL(String(url)).searchParams.get('viewers');
  requestedViewers.push(viewers);

  if (viewers === 'alice') {
    aliceRequestStarted();
    await new Promise((resolve) => { releaseAlice = resolve; });
  }

  const login = viewers;
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        badges: {},
        font_presets: {},
        viewers: { [login]: { badge_ids: [] } },
      },
    }),
  };
};

(async () => {
  const first = bg.__fetchChannelBadges('dedupechan', ['alice']);
  await aliceStarted;

  // A second batch overlaps the first one. It must not re-request alice while
  // her first request is still in flight.
  const second = bg.__fetchChannelBadges('dedupechan', ['alice', 'bob']);
  await Promise.resolve();
  assert.deepStrictEqual(requestedViewers, ['alice'], 'overlapping request duplicated alice before the first response');

  releaseAlice();
  await Promise.all([first, second]);

  assert.deepStrictEqual(
    requestedViewers.sort(),
    ['alice', 'bob'],
    `expected each viewer once across overlapping batches, got ${JSON.stringify(requestedViewers)}`,
  );

  console.log('bg-overlapping-badge-batches: PASS');
})().catch((error) => {
  console.error('bg-overlapping-badge-batches: FAIL', error);
  process.exit(1);
});
