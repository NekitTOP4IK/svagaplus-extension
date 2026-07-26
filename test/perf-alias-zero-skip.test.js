const assert = require('assert');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<div id="host"></div>', { url: 'https://www.twitch.tv/testchannel' });

global.window = dom.window;
global.document = dom.window.document;
global.location = dom.window.location;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.NodeFilter = dom.window.NodeFilter;
require('./helpers/build-globals').defineBuildGlobals();
const chrome = require('./helpers/extension-env').stubExtensionApis();

chrome.runtime.sendMessage = () => Promise.resolve({ aliases: {} });

const aliasManager = require('../dist-types/features/social-rating/alias-manager.js');
const injector = require('../dist-types/features/social-rating/alias-injector.js');

// Считаем обходы документа, которые делает пакетное переприменение.
let queries = 0;
const originalQsa = dom.window.Document.prototype.querySelectorAll;
dom.window.Document.prototype.querySelectorAll = function (...args) {
  queries++;
  return originalQsa.apply(this, args);
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

(async () => {
  await aliasManager.initAliasManager();
  assert.deepStrictEqual(aliasManager.getAllAliases(), {}, 'подготовка: алиасов быть не должно');

  // ── Ноль алиасов: обходить девять зон интерфейса незачем.
  queries = 0;
  injector.scheduleBatchReapply();
  await settle();

  assert.strictEqual(
    queries,
    0,
    `при нуле алиасов выполнено ${queries} обходов документа — девять зон обходятся впустую каждые 50 мс`
  );

  // ── Есть алиас: работа обязана выполняться, иначе правка ломает функциональность.
  chrome.runtime.sendMessage = () => Promise.resolve({ ok: true });
  await aliasManager.setAlias('alpha', 'Альфа');
  assert.ok(Object.keys(aliasManager.getAllAliases()).length > 0, 'подготовка: алиас не установился');

  queries = 0;
  injector.scheduleBatchReapply();
  await settle();

  assert.ok(
    queries > 0,
    'при наличии алиасов переприменение не выполняется — ранний выход слишком широк'
  );

  console.log('perf-alias-zero-skip: PASS');
})();
