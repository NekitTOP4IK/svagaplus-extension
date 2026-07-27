const assert = require('assert');
require('./helpers/build-globals').defineBuildGlobals();

const polyfillPath = require.resolve('webextension-polyfill');
const messages = [];
require.cache[polyfillPath] = {
  id: polyfillPath,
  filename: polyfillPath,
  loaded: true,
  exports: {
    runtime: {
      sendMessage: async (message) => {
        messages.push(message);
        if (message.type !== 'FETCH_CHANNEL_BADGES') return null;
        return {
          ok: true,
          badges: {
            'social-badge': {
              url: '/badges/social.png',
              source: 'social_rating',
              rank: 2,
              title: 'Social badge',
              period_id: 'weekly',
            },
          },
          font_presets: {},
          viewers: { alice: { badge_ids: ['social-badge'] } },
        };
      },
    },
  },
};

const api = require('../dist-types/features/social-rating/api.js');

(async () => {
  const grants = await api.fetchBadgeGrants('testchannel', ['alice']);

  assert.deepStrictEqual(
    messages.map((message) => message.type),
    ['FETCH_CHANNEL_BADGES'],
    'Social Rating must use the shared channel-badges request instead of its own endpoint path',
  );
  assert.deepStrictEqual(grants, [{
    login: 'alice',
    kind: 'high',
    rank: 2,
    image_url: 'https://example.test/badges/social.png',
    title: 'Social badge',
    period_label: 'weekly',
  }]);

  console.log('social-badges-shared-cache: PASS');
})().catch((error) => {
  console.error('social-badges-shared-cache: FAIL', error);
  process.exit(1);
});
