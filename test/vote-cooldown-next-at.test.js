const assert = require('assert');

global.__BACKEND_URL__ = 'https://example.test';
global.__FRONTEND_URL__ = 'https://example.test';
global.__WS_BACKEND_URL__ = 'wss://example.test';

const polyfillPath = require.resolve('webextension-polyfill');
require.cache[polyfillPath] = {
  id: polyfillPath,
  filename: polyfillPath,
  loaded: true,
  exports: {
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    runtime: { sendMessage: async () => ({}) },
  },
};

const {
  parseNextVoteAtMs,
  extractVoteErrorPayload,
} = require('../dist-types/features/social-rating/background.js');

const isoNaive = '2026-07-25T12:00:00';
const expectedMs = Date.parse('2026-07-25T12:00:00Z');
assert.equal(parseNextVoteAtMs(isoNaive), expectedMs, 'naive ISO must be treated as UTC');

const isoWithZ = '2026-07-25T12:00:00.123456Z';
assert.equal(parseNextVoteAtMs(isoWithZ), Date.parse(isoWithZ));

assert.equal(parseNextVoteAtMs(1700000000), 1700000000 * 1000);
assert.equal(parseNextVoteAtMs(1700000000000), 1700000000000);

const flask = extractVoteErrorPayload({
  success: false,
  message: 'vote cooldown is active for this target',
  next_vote_at: '2026-07-25T12:00:00.500000',
}, 429);
assert.equal(flask.error, 'vote cooldown is active for this target');
assert.equal(flask.nextVoteAt, Date.parse('2026-07-25T12:00:00.500000Z'));
assert.notEqual(flask.error, '429');
assert.ok(typeof flask.nextVoteAt === 'number' && flask.nextVoteAt > 0);

const fastapi = extractVoteErrorPayload({
  detail: { message: '24 hours', next_vote_at: 1700000000 },
}, 429);
assert.equal(fastapi.error, '24 hours');
assert.equal(fastapi.nextVoteAt, 1700000000 * 1000);

const bare = extractVoteErrorPayload({}, 429);
assert.equal(bare.error, '429');
assert.equal(bare.nextVoteAt, undefined);

assert.equal(Number.isNaN(parseNextVoteAtMs('2026-07-25T12:00:00') * 1), false);

console.log('vote-cooldown-next-at: PASS');
