const assert = require('assert');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<div id="chat"></div>', { url: 'https://www.twitch.tv/testchannel' });

global.window = dom.window;
global.document = dom.window.document;
global.location = dom.window.location;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;

// jsdom по умолчанию отдаёт document.hidden === true (visibilityState
// 'prerender'). Проверяемый сценарий — видимая вкладка, получающая
// WS-обновления: там код идёт через rAF, а не через setTimeout.
Object.defineProperty(dom.window.document, 'hidden', { value: false, configurable: true });

// rAF под ручным управлением: нужно различить «до кадра» и «после кадра».
const rafQueue = [];
global.requestAnimationFrame = (cb) => rafQueue.push(cb);
dom.window.requestAnimationFrame = global.requestAnimationFrame;

require('./helpers/build-globals').defineBuildGlobals();
require('./helpers/extension-env').stubExtensionApis();

const mod = require('../dist-types/features/tribute-badges/index.js');

const chat = document.getElementById('chat');
for (let i = 0; i < 40; i++) {
  const msg = document.createElement('div');
  msg.className = 'chat-line__message';
  msg.dataset.tcbUserLogin = 'viewer' + (i % 10);
  msg.innerHTML =
    '<span class="chat-line__message--badges"></span>' +
    `<span class="chat-author__display-name" data-a-user="viewer${i % 10}">viewer${i % 10}</span>`;
  chat.appendChild(msg);
}

let queries = 0;
const originalQsa = dom.window.Document.prototype.querySelectorAll;
dom.window.Document.prototype.querySelectorAll = function (...args) {
  queries++;
  return originalQsa.apply(this, args);
};

// Пачка из 30 событий user_update — типичная при channel_refresh.
for (let i = 0; i < 30; i++) mod.refreshUserInChat('viewer' + (i % 10));

assert.strictEqual(
  queries,
  0,
  `до кадра выполнено ${queries} обходов документа — коалесцирования нет, ` +
  `каждое событие обходит документ четырежды прямо в обработчике сокета`
);

// Проигрываем накопленные кадры.
let guard = 0;
while (rafQueue.length && guard++ < 100) rafQueue.shift()();

assert.ok(
  queries > 0 && queries <= 2,
  `за кадр выполнено ${queries} обходов документа вместо не более двух ` +
  `(по одному на нативный чат и на 7TV)`
);

console.log('perf-refresh-user-coalescing: PASS');
