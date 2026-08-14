const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bc = require('../scripts/build-channel.cjs');
const makeWebpackConfig = require('../webpack.config.js');

// Канал определяется единственным признаком — флагом --env prod.
assert.strictEqual(bc.channelOf({ prod: true }), 'prod');
assert.strictEqual(bc.channelOf({}), 'staging');
assert.strictEqual(bc.channelOf({ firefox: true }), 'staging');

// Четыре независимых выходных каталога: dev и prod больше не перезаписывают друг друга.
assert.strictEqual(bc.outDirOf({ prod: true }), path.join('dist', 'chrome-prod'));
assert.strictEqual(bc.outDirOf({}), path.join('dist', 'chrome-dev'));
assert.strictEqual(bc.outDirOf({ prod: true, firefox: true }), path.join('dist', 'firefox-prod'));
assert.strictEqual(bc.outDirOf({ firefox: true }), path.join('dist', 'firefox-dev'));

// Продакшен без env-переопределений всегда должен собираться для публичного домена.
const savedBackendProd = process.env.BACKEND_URL_PROD;
const savedFrontendProd = process.env.FRONTEND_URL_PROD;
try {
  delete process.env.BACKEND_URL_PROD;
  delete process.env.FRONTEND_URL_PROD;

  const prodConfig = makeWebpackConfig({ prod: true });
  const definitions = prodConfig.plugins.find(
    (plugin) => plugin.constructor.name === 'DefinePlugin'
  ).definitions;
  assert.strictEqual(definitions.__BACKEND_URL__, '"https://svagaplus.com"');
  assert.strictEqual(definitions.__FRONTEND_URL__, '"https://svagaplus.com"');

  const copyPlugin = prodConfig.plugins.find((plugin) => plugin.constructor.name === 'CopyPlugin');
  const buildInfoPattern = copyPlugin.patterns.find((pattern) => pattern.to === bc.BUILD_INFO_FILE);
  const buildInfo = JSON.parse(buildInfoPattern.transform());
  assert.strictEqual(buildInfo.channel, 'prod');
  assert.strictEqual(buildInfo.backendUrl, 'https://svagaplus.com');
} finally {
  if (savedBackendProd === undefined) delete process.env.BACKEND_URL_PROD;
  else process.env.BACKEND_URL_PROD = savedBackendProd;
  if (savedFrontendProd === undefined) delete process.env.FRONTEND_URL_PROD;
  else process.env.FRONTEND_URL_PROD = savedFrontendProd;
}

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
      backendUrl: 'https://svagaplus.com',
      version: '1.0.7',
      builtAt: '2026-07-26T00:00:00.000Z',
    })
  );
  assert.doesNotThrow(() => bc.assertProdChannel(tmp));
  assert.strictEqual(bc.readBuildInfo(tmp).backendUrl, 'https://svagaplus.com');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('build-channel: PASS');
