const assert = require('node:assert/strict');
const test = require('node:test');
require('./helpers/build-globals').defineBuildGlobals();

const polyfillPath = require.resolve('webextension-polyfill');
require.cache[polyfillPath] = {
  id: polyfillPath,
  filename: polyfillPath,
  loaded: true,
  exports: { runtime: { sendMessage: async () => ({}) } },
};
const { normalizeViewerBadges } = require('../dist-types/features/tribute-badges/api.js');

test('normalizes v3 badge_ids in server-provided order and preserves collectible metadata', () => {
  const payload = {
    badges: {
      service: { id: 'service', url: '/service.png', title: 'Service', source: 'service' },
      subscriber: { id: 'subscriber', url: '/subscriber.png', title: 'Subscriber', source: 'subscriber' },
      collectible: { id: 'collectible', url: '/collectible.gif', title: 'Collector', source: 'collectible', rarity: 'mythic', is_animated: true },
      social: { id: 'social', url: '/social.png', title: 'Social', source: 'social_rating', rank: 1 },
    },
    viewers: {
      alice: { badge_ids: ['service', 'subscriber', 'collectible', 'social'] },
    },
  };

  const badges = normalizeViewerBadges(payload, 'alice');

  assert.deepEqual(badges.map((badge) => badge.title), ['Service', 'Subscriber', 'Collector', 'Social']);
  assert.equal(badges[2].source, 'collectible');
  assert.equal(badges[2].rarity, 'mythic');
  assert.equal(badges[2].is_animated, true);
});

test('legacy socket payload places collectible badges between subscriber and social groups', () => {
  const badges = normalizeViewerBadges({
    tra_badges: [
      { url: '/service.png', title: 'Service' },
      { url: '/subscriber.png', title: 'Subscriber' },
    ],
    collectible_badges: [
      { url: '/collectible.png', title: 'Collector', source: 'collectible' },
    ],
    tsr_badges: [
      { url: '/social.png', title: 'Social' },
    ],
  });

  assert.deepEqual(badges.map((badge) => badge.title), ['Service', 'Subscriber', 'Collector', 'Social']);
});
