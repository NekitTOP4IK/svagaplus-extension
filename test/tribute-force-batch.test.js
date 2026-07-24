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
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => documentHidden });
  return dom;
}

let documentHidden = false;
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
          const viewers = {};
          for (const login of message.logins || []) {
            viewers[login] = { badge_ids: [] };
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
  // Allow initial startup scan / first batch to settle.
  await wait(400);
  messages.length = 0;

  // Simulate tab hide → show with WARM content cache (no artificial wipe).
  documentHidden = true;
  document.dispatchEvent(new window.Event('visibilitychange'));
  documentHidden = false;
  document.dispatchEvent(new window.Event('visibilitychange'));
  await wait(250);

  const badgeRequests = messages.filter((m) => m?.type === 'FETCH_CHANNEL_BADGES');
  assert.equal(
    badgeRequests.length,
    0,
    `warm cache: expected 0 FETCH_CHANNEL_BADGES on visibility, got ${badgeRequests.length}: ${JSON.stringify(badgeRequests)}`,
  );

  const invalidates = messages.filter((m) => m?.type === 'INVALIDATE_TRIBUTE_BADGE_CACHE');
  assert.equal(
    invalidates.length,
    0,
    `warm cache: expected 0 INVALIDATE on visibility, got ${invalidates.length}`,
  );

  // Force-ish path: no request should carry force:true from visibility recovery.
  for (const req of badgeRequests) {
    assert.notEqual(req.force, true, 'visibility recovery must not set force:true');
  }

  console.log('tribute-force-batch (soft visibility): PASS');
})().catch((error) => {
  console.error('tribute-force-batch (soft visibility): FAIL', error);
  process.exit(1);
});
