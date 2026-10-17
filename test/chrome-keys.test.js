const assert = require('assert');
const keys = require('../scripts/chrome-keys.cjs');
const makeWebpackConfig = require('../webpack.config.js');

for (const name of ['store', 'staging']) {
  assert.doesNotThrow(() => keys.assertKeyMatchesId(name), `${name} key must give its recorded ID`);
  assert.match(keys.CHROME_KEYS[name].id, /^[a-p]{32}$/);
}
assert.notStrictEqual(keys.CHROME_KEYS.store.id, keys.CHROME_KEYS.staging.id);

const saved = { ...keys.CHROME_KEYS.staging };
try {
  keys.CHROME_KEYS.staging.id = 'a'.repeat(32);
  assert.throws(() => keys.assertKeyMatchesId('staging'), /даёт ID/);
  keys.CHROME_KEYS.staging.key = '';
  assert.throws(() => keys.assertKeyMatchesId('staging'), /не задан/);
} finally {
  Object.assign(keys.CHROME_KEYS.staging, saved);
}

const withKey = JSON.parse(keys.withManifestKey('{"name":"x","version":"1.0.0"}', 'abc'));
assert.deepStrictEqual(withKey, { name: 'x', version: '1.0.0', key: 'abc' });

function builtManifest(env) {
  const copyPlugin = makeWebpackConfig(env).plugins.find((p) => p.constructor.name === 'CopyPlugin');
  const pattern = copyPlugin.patterns.find((p) => p.to === 'manifest.json');
  return JSON.parse(pattern.transform(require('fs').readFileSync(pattern.from)));
}

assert.strictEqual(keys.extensionIdFromKey(builtManifest({}).key), keys.CHROME_KEYS.staging.id);
assert.ok(!('key' in builtManifest({ prod: true })), 'Chrome Web Store build must not carry a key');
assert.ok(!('key' in builtManifest({ firefox: true })), 'Firefox ID comes from gecko.id');
assert.ok(!('key' in builtManifest({ prod: true, firefox: true })));

console.log('chrome-keys: PASS');
