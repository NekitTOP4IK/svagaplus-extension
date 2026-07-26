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

// Бэкграунд не смог ответить: сеть моргнула, воркер спал, бэкенд отдал 500.
chrome.runtime.sendMessage = (msg) => {
  if (msg && msg.type === 'FETCH_CHANNEL_BADGES') return Promise.resolve(null);
  return Promise.resolve(null);
};

const mod = require('../dist-types/features/tribute-badges/index.js');
const { processNativeMessage } = require('../dist-types/features/tribute-badges/native-chat.js');
const { getBadgeRenderState, shouldSkipBadgeRender } = require('../dist-types/features/tribute-badges/render-state.js');

const chat = document.getElementById('chat');
const message = document.createElement('div');
message.className = 'chat-line__message';
message.innerHTML =
  '<span class="chat-line__message--badges"></span>' +
  '<span class="chat-author__display-name" data-a-user="alice">alice</span>';
chat.appendChild(message);

const context = {
  getCurrentChannel: () => 'testchannel',
  getCachedUser: () => undefined,
  resolveBadgesForLogin: (channel, login) => mod.__resolveBadgesForLogin(channel, login),
};

(async () => {
  processNativeMessage(message, context);
  await mod.__flushViewerBadgeBatchForTest('testchannel');
  await new Promise((resolve) => setTimeout(resolve, 20));

  const state = getBadgeRenderState(message);

  assert.notStrictEqual(
    state,
    'empty',
    'сбой запроса защёлкнул сообщение в состояние empty. Выхода из него нет: ' +
    'shouldSkipBadgeRender для empty возвращает true, поэтому бейдж не появится ' +
    'никогда, даже когда негативный кэш истечёт и данные станут доступны.'
  );

  assert.strictEqual(
    state,
    'failed',
    `после сбоя ожидается состояние failed, получено ${state}`
  );

  assert.strictEqual(
    shouldSkipBadgeRender(message, 'alice'),
    false,
    'сообщение после сбоя не будет переобработано'
  );

  console.log('tribute-failure-not-latched: PASS');
})();
