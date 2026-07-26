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

const ALIASES = { alpha: 'Альфа', beta: 'Бета', gamma: 'Гамма' };
chrome.runtime.sendMessage = () => Promise.resolve({ aliases: ALIASES });

const { initAliasManager } = require('../dist-types/features/social-rating/alias-manager.js');
const injector = require('../dist-types/features/social-rating/alias-injector.js');

(async () => {
  await initAliasManager();

  const host = document.getElementById('host');
  const NODES = 20;
  for (let i = 0; i < NODES; i++) {
    const el = document.createElement('div');
    el.className = 'pinned-chat__pinned-by';
    el.textContent = 'закрепил alpha, а до него beta';
    host.appendChild(el);
  }

  // Прогрев: первый проход в любом случае компилирует регэкспы.
  injector.applyAliasesToPinnedChat();

  // Считаем компиляции на втором проходе — при кэше их быть не должно.
  let compiled = 0;
  const NativeRegExp = global.RegExp;
  global.RegExp = new Proxy(NativeRegExp, {
    construct(target, args) { compiled++; return new target(...args); },
  });

  injector.applyAliasesToPinnedChat();

  global.RegExp = NativeRegExp;

  assert.strictEqual(
    compiled,
    0,
    `на втором проходе скомпилировано ${compiled} регэкспов ` +
    `(${NODES} узлов × ${Object.keys(ALIASES).length} алиасов) — кэша нет`
  );

  // Подмена не должна ломать саму подстановку.
  const first = host.querySelector('.pinned-chat__pinned-by');
  assert.ok(
    first.textContent.includes('Альфа') && first.textContent.includes('Бета'),
    `алиасы не подставились: ${first.textContent}`
  );

  console.log('perf-alias-regex-cache: PASS');
})();
