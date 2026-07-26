const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

// Проверяется исходный шаблон, а не собранный артефакт: сборка внутри теста была
// побочным эффектом, из-за которого CI проверял dev-сборку, которую никто не заказывал.
// Собранные манифесты проверяет отдельный шаг CI.
const manifest = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'manifest.firefox.json'), 'utf8')
);

assert.ok(manifest.browser_specific_settings, 'Firefox manifest must include browser_specific_settings');
assert.ok(manifest.browser_specific_settings.gecko, 'Firefox manifest must include gecko settings');
assert.strictEqual(
  manifest.browser_specific_settings.gecko.id,
  'tributealerts@nekittop4ik.qzz.io',
  'Firefox manifest must keep the Gecko extension id'
);

// Каждый фоновый скрипт обязан соответствовать entry в webpack.config.js, иначе Firefox
// получит манифест, ссылающийся на файл, которого сборка не производит.
const webpackConfig = require(path.join(rootDir, 'webpack.config.js'))({ firefox: true });
const emitted = new Set(Object.keys(webpackConfig.entry).map((name) => `${name}.js`));

assert.ok(Array.isArray(manifest.background?.scripts), 'Firefox manifest must declare background.scripts');
for (const script of manifest.background.scripts) {
  assert.ok(
    emitted.has(script),
    `manifest.firefox.json background.scripts references ${script}, which webpack does not emit. Emitted: ${[...emitted].join(', ')}`
  );
}

console.log('firefox-manifest: PASS');
