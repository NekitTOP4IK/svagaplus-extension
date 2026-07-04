const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

execFileSync('npm', ['run', 'build:firefox'], { stdio: 'inherit' });

const manifestPath = path.join(__dirname, '..', 'dist_firefox', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

assert.ok(manifest.browser_specific_settings, 'Firefox manifest must include browser_specific_settings');
assert.ok(manifest.browser_specific_settings.gecko, 'Firefox manifest must include gecko settings');
assert.strictEqual(
  manifest.browser_specific_settings.gecko.id,
  'tributealerts@nekittop4ik.qzz.io',
  'Firefox manifest must keep the Gecko extension id'
);

