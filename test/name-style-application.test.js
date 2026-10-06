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
  name_css: 'background: linear-gradient(90deg, #00ffff, #ff00ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; filter: drop-shadow(2px 0 0 #111111) drop-shadow(-2px 0 0 #111111) drop-shadow(0 2px 0 #111111) drop-shadow(0 -2px 0 #111111) drop-shadow(0 0 4px #00ffff);',
};
let cachedStyle = style;
const context = {
  getCurrentChannel: () => 'channel',
  getCachedUser: () => cachedStyle,
  resolveBadgesForLogin: async () => [],
};

test('applies server name effects before badges resolve and removes every controlled effect on reset', () => {
  const chatName = document.querySelector('.chat-author__display-name');

  processNativeMessage(document.querySelector('.chat-line__message'), context);
  assert.match(chatName.style.getPropertyValue('filter'), /^drop-shadow\(2px 0 0 #111111\).*drop-shadow\(0 0 4px #00ffff\)$/);

  applyViewerNameStyle(chatName, undefined);
  assert.equal(chatName.style.getPropertyValue('filter'), '');
  assert.equal(chatName.style.getPropertyValue('background'), '');
});

test('native viewer card header name is left untouched', async () => {
  const card = document.querySelector('.viewer-card');
  const cardName = document.querySelector('.viewer-card-header__display-name');

  cachedStyle = style;
  processUserCard(card, context);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(cardName.getAttribute('style'), null);
  assert.equal(cardName.dataset.tcbNameStyle, undefined);
});

test('7TV applies no-badge effects and clears them through its renderer after a cache refresh', () => {
  const message = document.querySelector('.seventv-user-message');
  const name = document.querySelector('.seventv-chat-user-username');

  cachedStyle = style;
  processSevenTVMessage(message, context);
  assert.match(name.style.getPropertyValue('background'), /linear-gradient/);
  assert.match(name.style.getPropertyValue('filter'), /^drop-shadow\(2px 0 0 #111111\).*drop-shadow\(0 0 4px #00ffff\)$/);

  cachedStyle = undefined;
  clearBadgeRenderState(message);
  processSevenTVMessage(message, context);
  assert.equal(name.style.getPropertyValue('background'), '');
  assert.equal(name.style.getPropertyValue('filter'), '');
});

test('7TV name keeps its font rule after our inline gradient lands on it', () => {
  const { updateDynamicStyles } = require('../dist-types/features/tribute-badges/dom.js');
  const message = document.querySelector('.seventv-user-message');
  const name = document.querySelector('.seventv-chat-user-username');
  const fontStyle = { name_css: `${style.name_css} font-family: 'Almendra', sans-serif;` };

  cachedStyle = fontStyle;
  clearBadgeRenderState(message);
  processSevenTVMessage(message, context);
  assert.match(name.getAttribute('style'), /background/);

  updateDynamicStyles({ alice: fontStyle }, {}, '');
  const rules = document.getElementById('tcb-dynamic-styles').textContent.split('\n')
    .filter((line) => line.includes('"alice"') && line.includes('font-family'));
  const selectors = rules.map((line) => line.slice(0, line.indexOf(' {')).trim());
  assert.ok(selectors.some((selector) => name.matches(selector)), `no font rule matches: ${selectors.join(' | ')}`);
});

test('7TV paint written by 7TV itself still keeps our rule off the name', () => {
  const { updateDynamicStyles } = require('../dist-types/features/tribute-badges/dom.js');
  const painted = document.createElement('div');
  painted.innerHTML = '<div class="seventv-chat-user" data-tcb-user="bob"><span class="seventv-chat-user-username" style="background-image: url(paint.png)">bob</span></div>';
  document.body.append(painted);

  updateDynamicStyles({ bob: { name_css: "font-family: 'Almendra', sans-serif;" } }, {}, '');
  const selectors = document.getElementById('tcb-dynamic-styles').textContent.split('\n')
    .filter((line) => line.includes('"bob"'))
    .map((line) => line.slice(0, line.indexOf(' {')).trim());
  const name = painted.querySelector('.seventv-chat-user-username');
  assert.ok(selectors.length > 0);
  assert.equal(selectors.some((selector) => name.matches(selector)), false);
  painted.remove();
});
