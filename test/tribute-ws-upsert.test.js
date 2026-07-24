const assert = require('assert');
const { JSDOM } = require('jsdom');

function setupDom() {
  const dom = new JSDOM(`
    <body>
      <div class="chat-line__message">
        <span class="chat-line__message--badges"></span>
        <span class="chat-line__username">
          <span class="chat-author__display-name" data-a-user="alice">alice</span>
        </span>
      </div>
    </body>
  `, { url: 'https://www.twitch.tv/olesha' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Element = dom.window.Element;
  global.Node = dom.window.Node;
  global.Text = dom.window.Text;
  global.MutationObserver = dom.window.MutationObserver;
  global.location = dom.window.location;
  global.history = dom.window.history;
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  global.chrome = { runtime: { onMessage: { addListener: () => {} } } };
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  return dom;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const messages = [];
global.__BACKEND_URL__ = 'https://example.test';
global.__FRONTEND_URL__ = 'https://example.test';
global.__WS_BACKEND_URL__ = 'wss://example.test';

/** @type {{ handlers: Record<string, Function>, lastSocket: object | null }} */
const ioState = { handlers: {}, lastSocket: null };

global.io = function mockIo() {
  const handlers = {};
  const socket = {
    on(ev, fn) {
      handlers[ev] = fn;
    },
    emit() {},
    disconnect() {},
    __handlers: handlers,
  };
  ioState.handlers = handlers;
  ioState.lastSocket = socket;
  return socket;
};

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
          const viewers = {};
          for (const login of message.logins || []) {
            viewers[String(login).toLowerCase()] = { badge_ids: [] };
          }
          return { ok: true, badges: {}, font_presets: {}, viewers };
        }
        if (message?.type === 'INVALIDATE_TRIBUTE_BADGE_CACHE') return { ok: true };
        if (message?.type === 'UPSERT_TRIBUTE_BADGE_CACHE') return { ok: true };
        return {};
      },
    },
  },
};

setupDom();
const { startTributeBadgesContent } = require('../dist-types/features/tribute-badges/index.js');

(async () => {
  startTributeBadgesContent();
  await wait(50);

  const handlers = ioState.handlers;
  assert.ok(typeof handlers.badge_update === 'function', 'expected badge_update socket handler');

  messages.length = 0;

  // 1) usable badge_ids + badges payload → UPSERT, not INVALIDATE
  handlers.badge_update({
    type: 'user_update',
    data: {
      twitch_username: 'alice',
      badge_ids: ['b1'],
      badges: {
        b1: { image_url: 'https://example.test/b.png', title: 'B', active: true },
      },
    },
  });
  await wait(50);

  assert.ok(
    messages.some((m) => m.type === 'UPSERT_TRIBUTE_BADGE_CACHE'),
    `expected UPSERT_TRIBUTE_BADGE_CACHE, got: ${JSON.stringify(messages.map((m) => m.type))}`,
  );
  assert.ok(
    !messages.some((m) => m.type === 'INVALIDATE_TRIBUTE_BADGE_CACHE' && m.login === 'alice'),
    'usable badge payload must not INVALIDATE alice',
  );

  const upsert = messages.find((m) => m.type === 'UPSERT_TRIBUTE_BADGE_CACHE');
  assert.equal(upsert.channelLogin, 'olesha');
  assert.equal(upsert.login, 'alice');
  assert.ok(upsert.viewer && Array.isArray(upsert.viewer.badge_ids));
  assert.ok(upsert.badges && upsert.badges.b1);

  messages.length = 0;

  // 2) legacy tra/tsr-only payload → UPSERT with constructed viewer
  handlers.badge_update({
    type: 'user_update',
    data: {
      twitch_username: 'bob',
      tra_badges: [{ id: 't1', title: 'TRA' }],
      tsr_badges: [],
    },
  });
  await wait(50);

  assert.ok(
    messages.some((m) => m.type === 'UPSERT_TRIBUTE_BADGE_CACHE' && m.login === 'bob'),
    'legacy tra/tsr payload must UPSERT',
  );
  assert.ok(
    !messages.some((m) => m.type === 'INVALIDATE_TRIBUTE_BADGE_CACHE' && m.login === 'bob'),
    'legacy tra/tsr payload must not INVALIDATE bob',
  );

  messages.length = 0;

  // 3) unusable payload → still INVALIDATE
  handlers.badge_update({
    type: 'user_update',
    data: {
      twitch_username: 'carol',
    },
  });
  await wait(50);

  assert.ok(
    messages.some((m) => m.type === 'INVALIDATE_TRIBUTE_BADGE_CACHE' && m.login === 'carol'),
    'unusable payload must INVALIDATE',
  );
  assert.ok(
    !messages.some((m) => m.type === 'UPSERT_TRIBUTE_BADGE_CACHE' && m.login === 'carol'),
    'unusable payload must not UPSERT',
  );

  messages.length = 0;

  // 4) channel_refresh → channel-wide INVALIDATE (no UPSERT)
  handlers.badge_update({ type: 'channel_refresh' });
  await wait(50);

  assert.ok(
    messages.some((m) => m.type === 'INVALIDATE_TRIBUTE_BADGE_CACHE' && !m.login),
    'channel_refresh must INVALIDATE channel-wide',
  );
  assert.ok(
    !messages.some((m) => m.type === 'UPSERT_TRIBUTE_BADGE_CACHE'),
    'channel_refresh must not UPSERT',
  );

  console.log('tribute-ws-upsert: PASS');
})().catch((error) => {
  console.error('tribute-ws-upsert: FAIL', error);
  process.exit(1);
});
