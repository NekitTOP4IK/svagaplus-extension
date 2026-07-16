const assert = require('assert');

// Compile types first in verify step; for pure module we can require from dist-types after tsc,
// or keep implementation pure JS-friendly TS (no decorators).
// Plan: tsc emits dist-types/shared/request-cooldown.js

async function main() {
  // After Task 1 implementation exists:
  const {
    RequestCooldown,
    channelBadgesKey,
    ratingKey,
    NOT_FOUND_TTL_MS,
    TRANSIENT_TTL_MS,
  } = require('../dist-types/shared/request-cooldown.js');

  const cd = new RequestCooldown();
  const key = channelBadgesKey('Jeens');
  assert.strictEqual(key, 'channel-badges:jeens');
  assert.strictEqual(ratingKey('Jeens', 'User_One'), 'rating:jeens:user_one');

  assert.strictEqual(cd.isBlocked(key), false);
  cd.markFromStatus(key, 404);
  assert.strictEqual(cd.isBlocked(key), true);
  assert.strictEqual(cd.get(key)?.kind, 'not_found');
  assert.ok((cd.get(key)?.until ?? 0) >= Date.now() + NOT_FOUND_TTL_MS - 1000);

  cd.clear(key);
  assert.strictEqual(cd.isBlocked(key), false);

  cd.markFromStatus(key, 503);
  assert.strictEqual(cd.get(key)?.kind, 'transient');
  const untilTransient = cd.get(key).until;
  assert.ok(untilTransient <= Date.now() + TRANSIENT_TTL_MS + 50);

  cd.markFromStatus(key, 'network');
  assert.strictEqual(cd.get(key)?.kind, 'transient');

  cd.markFromStatus(channelBadgesKey('a'), 404);
  cd.markFromStatus(channelBadgesKey('b'), 404);
  cd.markFromStatus(ratingKey('a', 'x'), 404);
  cd.clearPrefix('channel-badges:');
  assert.strictEqual(cd.isBlocked(channelBadgesKey('a')), false);
  assert.strictEqual(cd.isBlocked(channelBadgesKey('b')), false);
  assert.strictEqual(cd.isBlocked(ratingKey('a', 'x')), true);

  // Expired entry not blocked
  const cd2 = new RequestCooldown({ now: () => 1_000_000 });
  cd2.markFromStatus('k', 404); // until = 1_000_000 + NOT_FOUND
  const cd3 = new RequestCooldown({
    now: () => 1_000_000 + NOT_FOUND_TTL_MS + 1,
    // share storage? easier: inject clock on same instance
  });
  // Prefer single instance with injectable now:
  let now = 0;
  const cd4 = new RequestCooldown({ now: () => now });
  now = 1000;
  cd4.markFromStatus('exp', 404);
  assert.strictEqual(cd4.isBlocked('exp'), true);
  now = 1000 + NOT_FOUND_TTL_MS + 1;
  assert.strictEqual(cd4.isBlocked('exp'), false);

  console.log('request-cooldown: OK');
}

main().catch((e) => {
  console.error('request-cooldown: FAIL', e);
  process.exit(1);
});
