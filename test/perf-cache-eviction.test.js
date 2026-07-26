const assert = require('assert');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<div></div>', { url: 'https://www.twitch.tv/testchannel' });

global.window = dom.window;
global.document = dom.window.document;
global.location = dom.window.location;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
require('./helpers/build-globals').defineBuildGlobals();
require('./helpers/extension-env').stubExtensionApis();

const mod = require('../dist-types/features/tribute-badges/index.js');

// 600 записей, из них 400 просрочены час назад.
const hourAgo = Date.now() - 60 * 60 * 1000;
for (let i = 0; i < 600; i++) {
  mod.__seedViewerBadgeCache('testchannel', 'viewer' + i, i < 400 ? hourAgo : Date.now() + 60_000);
}

assert.strictEqual(mod.__getViewerCacheSize(), 600, 'подготовка кэша не удалась');

const removed = mod.__sweepViewerBadgeCache();
assert.strictEqual(removed, 400, `подметено ${removed} записей вместо 400`);
assert.strictEqual(
  mod.__getViewerCacheSize(),
  200,
  `в кэше осталось ${mod.__getViewerCacheSize()} записей вместо 200 — просрочка не удаляется`
);

// Повторное подметание ничего не находит: живые записи не трогаются.
assert.strictEqual(mod.__sweepViewerBadgeCache(), 0, 'подметание удалило живые записи');

console.log('perf-cache-eviction: PASS');
