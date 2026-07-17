const assert = require('assert');
const { JSDOM } = require('jsdom');

function setupDom() {
  const dom = new JSDOM(`
    <div class="chat-line__message">
      <span class="chat-line__message--badges"></span>
      <span class="chat-line__username"><span class="chat-author__display-name" data-a-user="alice">alice</span></span>
    </div>
    <div class="chat-line__message">
      <span class="chat-line__message--badges"></span>
      <span class="chat-line__username"><span class="chat-author__display-name" data-a-user="bob">bob</span></span>
    </div>
    <div class="chat-line__message">
      <span class="chat-line__message--badges"></span>
      <span class="chat-line__username"><span class="chat-author__display-name" data-a-user="carol">carol</span></span>
    </div>
  `, { url: 'https://www.twitch.tv/olesha' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Element = dom.window.Element;
  global.Node = dom.window.Node;
  global.MutationObserver = dom.window.MutationObserver;
  global.location = dom.window.location;
  global.history = dom.window.history;
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  global.chrome = { runtime: { onMessage: { addListener: () => {} } } };
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const messages = [];
global.__BACKEND_URL__ = 'https://example.test';
global.__FRONTEND_URL__ = 'https://example.test';
global.__WS_BACKEND_URL__ = 'wss://example.test';

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
          return { ok: true, badges: {}, font_presets: {}, viewers: {} };
        }
        if (message?.type === 'INVALIDATE_TRIBUTE_BADGE_CACHE') return { ok: true };
        return {};
      },
    },
  },
};

setupDom();

const { startTributeBadgesContent } = require('../dist-types/features/tribute-badges/index.js');

(async () => {
  startTributeBadgesContent();
  await wait(120);
  messages.length = 0;

  document.dispatchEvent(new window.Event('visibilitychange'));
  await wait(120);

  const badgeRequests = messages.filter((message) => message?.type === 'FETCH_CHANNEL_BADGES');
  assert.equal(badgeRequests.length, 1, `expected one forced batch request, got ${badgeRequests.length}`);
  assert.deepEqual(badgeRequests[0].logins.sort(), ['alice', 'bob', 'carol']);

  console.log('tribute-force-batch: PASS');
})().catch((error) => {
  console.error('tribute-force-batch: FAIL', error);
  process.exit(1);
});
