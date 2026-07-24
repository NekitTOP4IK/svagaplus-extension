const assert = require('assert');
const { JSDOM } = require('jsdom');

function buildChatHtml(count) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const login = i % 2 === 0 ? 'alice' : 'bob';
    rows.push(`
      <div class="chat-line__message">
        <span class="chat-line__message--badges"></span>
        <span class="chat-line__username">
          <span class="chat-author__display-name" data-a-user="${login}">${login}</span>
        </span>
      </div>
    `);
  }
  return rows.join('');
}

function setupDom() {
  const dom = new JSDOM(`
    <body>
      ${buildChatHtml(20)}
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
            const key = String(login).toLowerCase();
            viewers[key] = { badge_ids: [`${key}-badge`] };
          }
          return {
            ok: true,
            badges: {
              'alice-badge': {
                url: 'https://example.test/alice.png',
                title: 'Alice Badge',
                source: 'tra',
                rank: 1,
              },
              'bob-badge': {
                url: 'https://example.test/bob.png',
                title: 'Bob Badge',
                source: 'tra',
                rank: 1,
              },
            },
            font_presets: {},
            viewers,
          };
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

  // Wait for batch debounce (~80ms) + paint settle + a couple startup scan ticks.
  await wait(500);

  const renderedBefore = document.querySelectorAll('[data-tcb-render-state="rendered"]').length;
  assert.ok(renderedBefore >= 2, `expected some rendered messages, got ${renderedBefore}`);

  const badgeCountBefore = document.querySelectorAll('.tcb-badge-img').length;
  assert.ok(badgeCountBefore > 0, 'expected tribute badges after first batch');

  // Wait another batch window without new messages / WS — no refresh storm.
  await wait(200);

  const badgeCountAfter = document.querySelectorAll('.tcb-badge-img').length;
  assert.ok(badgeCountAfter > 0, 'badges must remain after idle wait (no refresh storm)');
  assert.equal(
    badgeCountAfter,
    badgeCountBefore,
    `badge count should be stable without WS; before=${badgeCountBefore} after=${badgeCountAfter}`,
  );

  const fetches = messages.filter((m) => m?.type === 'FETCH_CHANNEL_BADGES');
  assert.equal(fetches.length, 1, `expected single batch fetch, got ${fetches.length}`);

  console.log('tribute-batch-no-refresh-storm: PASS');
})().catch((error) => {
  console.error('tribute-batch-no-refresh-storm: FAIL', error);
  process.exit(1);
});
