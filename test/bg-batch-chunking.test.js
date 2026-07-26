const assert = require('assert');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<div id="chat"></div>', { url: 'https://www.twitch.tv/testchannel' });

global.window = dom.window;
global.document = dom.window.document;
global.location = dom.window.location;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
Object.defineProperty(dom.window.document, 'hidden', { value: false, configurable: true });
require('./helpers/build-globals').defineBuildGlobals();
const chrome = require('./helpers/extension-env').stubExtensionApis();

// Перехватываем запросы бейджей и записываем размеры отправленных батчей.
// Бэкграунд отклоняет всё, что больше 100, — воспроизводим это поведение.
const batchSizes = [];
chrome.runtime.sendMessage = (msg) => {
  if (msg && msg.type === 'FETCH_CHANNEL_BADGES') {
    batchSizes.push(msg.logins.length);
    if (msg.logins.length > 100) return Promise.resolve({ ok: false, error: 'bad_request' });
    return Promise.resolve({ ok: true, badges: {}, font_presets: {}, viewers: {} });
  }
  return Promise.resolve(null);
};

const mod = require('../dist-types/features/tribute-badges/index.js');

(async () => {
  // 250 уникальных логинов в одном окне дебаунса — сценарий channel_refresh
  // или возврата из фоновой вкладки на людном канале с холодным кэшем.
  const pending = [];
  for (let i = 0; i < 250; i++) {
    pending.push(mod.__resolveBadgesForLogin('testchannel', 'viewer' + i));
  }

  await mod.__flushViewerBadgeBatchForTest('testchannel');
  await Promise.all(pending);

  assert.ok(batchSizes.length > 0, 'запросов не было — тест недействителен');

  const tooBig = batchSizes.filter((n) => n > 100);
  assert.deepStrictEqual(
    tooBig,
    [],
    `отправлены батчи больше 100 логинов: ${JSON.stringify(batchSizes)}. ` +
    `Бэкграунд отклоняет их как bad_request, и каждому логину пишется ` +
    `пустой негативный кэш на 30 секунд.`
  );

  const total = batchSizes.reduce((a, b) => a + b, 0);
  assert.strictEqual(
    total,
    250,
    `суммарно отправлено ${total} логинов вместо 250 — часть потеряна при нарезке`
  );

  console.log('bg-batch-chunking: PASS');
})();
