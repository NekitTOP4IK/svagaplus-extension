const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const test = require('node:test');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('viewer_refresh invalidates globally and refreshes mounted Twitch and 7TV messages', async () => {
  const dom = new JSDOM(`
    <div class="chat-line__message">
      <span class="chat-line__message--badges"></span>
      <span class="chat-line__username"><span class="chat-author__display-name" data-a-user="alice">alice</span></span>
    </div>
    <div class="seventv-user-message">
      <div class="seventv-chat-user">
        <span class="seventv-chat-user-username">alice</span>
        <span class="seventv-chat-user-badge-list"></span>
      </div>
    </div>
  `, { url: 'https://www.twitch.tv/channel' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Element = dom.window.Element;
  global.Text = dom.window.Text;
  global.MutationObserver = dom.window.MutationObserver;
  global.location = dom.window.location;
  global.history = dom.window.history;
  global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });

  const messages = [];
  const handlers = {};
  global.io = () => ({
    on(event, handler) { handlers[event] = handler; },
    emit() {},
    disconnect() {},
  });
  require('./helpers/build-globals').defineBuildGlobals();
  const polyfillPath = require.resolve('webextension-polyfill');
  require.cache[polyfillPath] = {
    id: polyfillPath,
    filename: polyfillPath,
    loaded: true,
    exports: {
      runtime: {
        sendMessage: async (message) => {
          messages.push(message);
          if (message?.type === 'FETCH_CHANNEL_BADGES') {
            return {
              ok: true,
              badges: { badge: { image_url: 'https://example.test/collectible.gif', title: 'Collector', source: 'collectible', rarity: 'epic', is_animated: true } },
              font_presets: {},
              viewers: Object.fromEntries((message.logins || []).map((login) => [login, { badge_ids: ['badge'] }])),
            };
          }
          return { ok: true };
        },
      },
    },
  };

  const { startTributeBadgesContent } = require('../dist-types/features/tribute-badges/index.js');
  startTributeBadgesContent();
  await wait(250);
  assert.equal(document.querySelectorAll('.tcb-badge-img').length, 2);

  messages.length = 0;
  handlers.badge_update({ type: 'viewer_refresh', data: { viewer: 'alice', reason: 'collectible_badge_changed' } });
  await wait(250);

  assert.equal(document.querySelectorAll('.tcb-badge-list .tcb-badge-img').length, 1);
  assert.equal(document.querySelectorAll('.tcb-badge-list-stv .tcb-badge-img').length, 1);
  assert.ok(messages.some((message) => message.type === 'INVALIDATE_TRIBUTE_BADGE_CACHE' && message.login === 'alice' && !message.channelLogin));
  assert.ok(messages.some((message) => message.type === 'FETCH_CHANNEL_BADGES' && message.logins.includes('alice')));
});
