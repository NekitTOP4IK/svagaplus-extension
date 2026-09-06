const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const dom = new JSDOM(`
  <body>
    <div class="chat-line__message">
      <span class="chat-line__message--badges"></span>
      <span class="chat-author__display-name" data-a-user="alice">alice</span>
    </div>
    <div class="viewer-card"><span class="viewer-card-header__display-name"><a href="/alice">alice</a></span></div>
    <div class="seventv-user-message"><div class="seventv-chat-user"><span class="seventv-chat-user-username">alice</span></div></div>
  </body>
`, { url: 'https://www.twitch.tv/channel' });

global.window = dom.window;
global.document = dom.window.document;
global.Element = dom.window.Element;
global.HTMLElement = dom.window.HTMLElement;

const { processNativeMessage } = require('../dist-types/features/tribute-badges/native-chat.js');
const { processUserCard } = require('../dist-types/features/tribute-badges/usercard.js');
const { processSevenTVMessage } = require('../dist-types/features/tribute-badges/seventv-chat.js');
const { applyViewerNameStyle } = require('../dist-types/features/tribute-badges/dom.js');
const { clearBadgeRenderState } = require('../dist-types/features/tribute-badges/render-state.js');

const style = {
  name_css: 'background: linear-gradient(90deg, #00ffff, #ff00ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; -webkit-text-stroke: 2px #111111; paint-order: stroke fill; filter: drop-shadow(0 0 4px #00ffff);',
};
let cachedStyle = style;
const context = {
  getCurrentChannel: () => 'channel',
  getCachedUser: () => cachedStyle,
  resolveBadgesForLogin: async () => [],
};

test('applies server name effects before badges resolve and removes every controlled effect on reset', () => {
  const chatName = document.querySelector('.chat-author__display-name');
  const card = document.querySelector('.viewer-card');
  const cardName = document.querySelector('.viewer-card-header__display-name');

  processNativeMessage(document.querySelector('.chat-line__message'), context);
  processUserCard(card, context);

  for (const element of [chatName, cardName]) {
    assert.equal(element.style.getPropertyValue('-webkit-text-stroke'), '2px #111111');
    assert.equal(element.style.getPropertyValue('paint-order'), 'stroke fill');
    assert.match(element.style.getPropertyValue('filter'), /drop-shadow/);
  }

  applyViewerNameStyle(chatName, undefined);
  assert.equal(chatName.style.getPropertyValue('filter'), '');
  assert.equal(chatName.style.getPropertyValue('-webkit-text-stroke'), '');
  assert.equal(chatName.style.getPropertyValue('paint-order'), '');
  assert.equal(chatName.style.getPropertyValue('background'), '');
});

test('7TV applies no-badge effects and clears them through its renderer after a cache refresh', () => {
  const message = document.querySelector('.seventv-user-message');
  const name = document.querySelector('.seventv-chat-user-username');

  cachedStyle = style;
  processSevenTVMessage(message, context);
  assert.match(name.style.getPropertyValue('background'), /linear-gradient/);
  assert.equal(name.style.getPropertyValue('-webkit-text-stroke'), '2px #111111');
  assert.equal(name.style.getPropertyValue('paint-order'), 'stroke fill');
  assert.match(name.style.getPropertyValue('filter'), /drop-shadow/);

  cachedStyle = undefined;
  clearBadgeRenderState(message);
  processSevenTVMessage(message, context);
  assert.equal(name.style.getPropertyValue('background'), '');
  assert.equal(name.style.getPropertyValue('-webkit-text-stroke'), '');
  assert.equal(name.style.getPropertyValue('paint-order'), '');
  assert.equal(name.style.getPropertyValue('filter'), '');
});
