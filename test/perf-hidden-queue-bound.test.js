const assert = require('assert');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<div id="chat"></div>', { url: 'https://www.twitch.tv/testchannel' });

global.window = dom.window;
global.document = dom.window.document;
global.location = dom.window.location;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
require('./helpers/build-globals').defineBuildGlobals();
require('./helpers/extension-env').stubExtensionApis();

// Вкладка в фоне: сообщения уходят в очередь, а не обрабатываются.
Object.defineProperty(dom.window.document, 'hidden', { value: true, configurable: true });

const mod = require('../dist-types/features/tribute-badges/index.js');

const chat = document.getElementById('chat');
for (let i = 0; i < 1000; i++) {
  const el = document.createElement('div');
  el.className = 'chat-line__message';
  chat.appendChild(el);
  mod.enqueueOrProcessMessage(el, 'native');
  // Twitch подрезает буфер чата примерно до 150 строк: элемент становится
  // detached, но ссылка в Set удерживает всё поддерево от сборки.
  chat.removeChild(el);
}

const size = mod.__getHiddenQueueSize();
assert.ok(
  size <= 200,
  `очередь скрытых сообщений не ограничена: ${size} элементов после 1000 сообщений. ` +
  `Все они detached и всё равно будут выброшены при сливе по !isConnected.`
);

console.log('perf-hidden-queue-bound: PASS');
