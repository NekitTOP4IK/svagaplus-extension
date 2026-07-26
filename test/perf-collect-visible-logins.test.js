const assert = require('assert');
const { JSDOM } = require('jsdom');

const dom = new JSDOM(`
  <div class="chat-line__message">
    <span class="chat-author__display-name" data-a-user="inchat">inchat</span>
  </div>
  <div class="chat-line__message">
    <span class="chatter-name">alsoinchat</span>
  </div>
  <div class="seventv-user-message">
    <span class="seventv-chat-user-username">seventvuser</span>
  </div>

  <!-- Вне чата: карточка зрителя, закреплённое сообщение, mod view -->
  <div class="viewer-card">
    <span class="message-author__display-name">cardonly</span>
  </div>
  <div class="pinned-chat">
    <span class="chatter-name">pinnedonly</span>
  </div>
`, { url: 'https://www.twitch.tv/testchannel' });

global.window = dom.window;
global.document = dom.window.document;
global.location = dom.window.location;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
require('./helpers/build-globals').defineBuildGlobals();
require('./helpers/extension-env').stubExtensionApis();

const { collectVisibleLogins } = require('../dist-types/features/tribute-badges/index.js');

const logins = collectVisibleLogins().sort();

assert.deepStrictEqual(
  logins,
  ['alsoinchat', 'inchat', 'seventvuser'],
  `собраны логины вне чата — префикс .chat-line__message цепляется только ` +
  `к первому селектору группы. Получено: ${JSON.stringify(logins)}`
);

console.log('perf-collect-visible-logins: PASS');
