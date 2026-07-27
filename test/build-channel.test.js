const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bc = require('../scripts/build-channel.cjs');

// Канал определяется единственным признаком — флагом --env prod.
assert.strictEqual(bc.channelOf({ prod: true }), 'prod');
assert.strictEqual(bc.channelOf({}), 'staging');
assert.strictEqual(bc.channelOf({ firefox: true }), 'staging');

// Четыре независимых выходных каталога: dev и prod больше не перезаписывают друг друга.
assert.strictEqual(bc.outDirOf({ prod: true }), path.join('dist', 'chrome-prod'));
assert.strictEqual(bc.outDirOf({}), path.join('dist', 'chrome-dev'));
assert.strictEqual(bc.outDirOf({ prod: true, firefox: true }), path.join('dist', 'firefox-prod'));
assert.strictEqual(bc.outDirOf({ firefox: true }), path.join('dist', 'firefox-dev'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-'));
try {
  // Папка без маркера — отказ, а не молчаливый пропуск: иначе достаточно
  // подсунуть произвольный каталог, чтобы обойти проверку.
  assert.throws(() => bc.assertProdChannel(tmp), /build-info\.json/);

  fs.writeFileSync(
    path.join(tmp, bc.BUILD_INFO_FILE),
    JSON.stringify({
      channel: 'staging',
      backendUrl: 'https://svaga-staging.nekittop4ik.qzz.io',
      version: '1.0.7',
      builtAt: '2026-07-26T00:00:00.000Z',
    })
  );
  assert.throws(() => bc.assertProdChannel(tmp), /staging/);

  fs.writeFileSync(
    path.join(tmp, bc.BUILD_INFO_FILE),
    JSON.stringify({
      channel: 'prod',
      backendUrl: 'https://svagaplus.qzz.io',
      version: '1.0.7',
      builtAt: '2026-07-26T00:00:00.000Z',
    })
  );
  assert.doesNotThrow(() => bc.assertProdChannel(tmp));
  assert.strictEqual(bc.readBuildInfo(tmp).backendUrl, 'https://svagaplus.qzz.io');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('build-channel: PASS');
