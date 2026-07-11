const assert = require('assert');
const { JSDOM } = require('jsdom');

function setupDom(html) {
  const dom = new JSDOM(html, { url: 'https://www.twitch.tv/testchannel' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Element = dom.window.Element;
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  return dom;
}

async function tick() {
  await Promise.resolve();
  await Promise.resolve();
}

function awaitRaf() {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

setupDom(`
  <div class="chat-line__message">
    <span class="chat-line__message--badges"></span>
    <span class="chat-line__username"><span class="chat-author__display-name" data-a-user="viewerone">viewerone</span></span>
  </div>
  <div class="seventv-user-message">
    <div class="seventv-chat-user">
      <span class="seventv-chat-user-username">viewertwo</span>
      <span class="seventv-chat-user-badge-list"></span>
    </div>
  </div>
`);

const { processNativeMessage } = require('../dist-types/features/tribute-badges/native-chat.js');
const { processSevenTVMessage } = require('../dist-types/features/tribute-badges/seventv-chat.js');
const { clearBadgeRenderState, getBadgeRenderState } = require('../dist-types/features/tribute-badges/render-state.js');

(async () => {
  // ── 1. Native async-safe render: replacing the badge container after the synchronous
  //    start must still receive the badge image once the promise resolves (re-query inside IIFE).
  const message = document.querySelector('.chat-line__message');
  let calls = 0;
  const context = {
    getCurrentChannel: () => 'testchannel',
    getCachedUser: () => undefined,
    resolveBadgesForLogin: async () => {
      calls += 1;
      return [{ image_url: 'https://example.test/badge.png', title: 'Badge', source: 'tra', rank: 1 }];
    },
  };

  processNativeMessage(message, context);
  document.querySelector('.chat-line__message--badges').replaceWith(document.createElement('span'));
  document.querySelector('.chat-line__message span').className = 'chat-line__message--badges';
  await tick();

  assert.equal(calls, 1);
  assert.equal(document.querySelectorAll('.chat-line__message--badges .tcb-badge-img').length, 1);

  // ── 2. Repair after external badge removal (mirrors the repair-observer path, which
  //    clears render state before re-processing).
  document.querySelector('.tcb-badge-img').remove();
  clearBadgeRenderState(message);
  processNativeMessage(message, context);
  await tick();

  assert.equal(document.querySelectorAll('.chat-line__message--badges .tcb-badge-img').length, 1);

  // ── 3. Empty result is cached as 'empty' — a second call for the same login must skip.
  let emptyCalls = 0;
  const trackContext = {
    getCurrentChannel: () => 'testchannel',
    getCachedUser: () => undefined,
    resolveBadgesForLogin: async () => { emptyCalls += 1; return []; },
  };
  clearBadgeRenderState(message);
  processNativeMessage(message, trackContext);
  await tick();
  assert.equal(emptyCalls, 1);
  processNativeMessage(message, trackContext);
  await tick();
  assert.equal(emptyCalls, 1, 'second call for same login with empty state must skip');

  // ── 4. Failure-retry: rejected resolveBadgesForLogin sets state to 'failed', next call retries.
  clearBadgeRenderState(message);
  let failAttempts = 0;
  let shouldFail = true;
  const failContext = {
    getCurrentChannel: () => 'testchannel',
    getCachedUser: () => undefined,
    resolveBadgesForLogin: async () => {
      failAttempts += 1;
      if (shouldFail) throw new Error('network down');
      return [{ image_url: 'https://example.test/retry.png', title: 'Retry', source: 'tra', rank: 1 }];
    },
  };
  processNativeMessage(message, failContext);
  await tick();
  assert.equal(failAttempts, 1);
  assert.equal(getBadgeRenderState(message), 'failed', 'state must be failed after rejection');
  assert.equal(document.querySelectorAll('.tcb-badge-img').length, 0, 'no badge after failure');

  shouldFail = false;
  processNativeMessage(message, failContext);
  await tick();
  assert.equal(failAttempts, 2, 'failed state must retry on next call');
  assert.equal(document.querySelectorAll('.tcb-badge-img').length, 1, 'badge rendered after retry');
  assert.equal(getBadgeRenderState(message), 'rendered');

  // ── 5. Token guard: when clearBadgeRenderState is called between two renders
  //    (e.g., repair observer fires), the stale IIFE must no-op on token mismatch.
  clearBadgeRenderState(message);
  let slowResolve;
  const slowPromise = new Promise((r) => { slowResolve = r; });
  const slowContext = {
    getCurrentChannel: () => 'testchannel',
    getCachedUser: () => undefined,
    resolveBadgesForLogin: () => slowPromise,
  };
  processNativeMessage(message, slowContext); // starts render with token T
  // Repair path clears state and starts a new render with token T+1
  clearBadgeRenderState(message);
  processNativeMessage(message, context); // context resolves fast, token T+1
  await tick();
  // Now resolve the slow (stale, token T) promise — its IIFE must no-op due to token mismatch
  slowResolve([{ image_url: 'https://example.test/stale.png', title: 'Stale', source: 'tra', rank: 1 }]);
  await tick();
  const imgs = document.querySelectorAll('.tcb-badge-img');
  assert.equal(imgs.length, 1, 'stale render must not append; only current render wins');
  assert.notEqual(imgs[0].src, 'https://example.test/stale.png', 'stale badge must not be present');

  // ── 6. 7TV render path: async-safe re-query, badge appended to badge-list.
  const sevMsg = document.querySelector('.seventv-user-message');
  const sevContext = {
    getCurrentChannel: () => 'testchannel',
    getCachedUser: () => undefined,
    resolveBadgesForLogin: async () => [{ image_url: 'https://example.test/stv.png', title: '7TV', source: 'tra', rank: 1 }],
  };
  processSevenTVMessage(sevMsg, sevContext);
  await tick();
  assert.equal(document.querySelectorAll('.seventv-chat-user-badge-list .tcb-badge-img').length, 1);

  // ── 7. 7TV repair after external removal.
  document.querySelector('.seventv-chat-user-badge-list .tcb-badge-img').remove();
  clearBadgeRenderState(sevMsg);
  processSevenTVMessage(sevMsg, sevContext);
  await tick();
  assert.equal(document.querySelectorAll('.seventv-chat-user-badge-list .tcb-badge-img').length, 1);

  // ── 8. No infinite repair loop: re-render (self-initiated removal) must not trigger
  //    another repair. Simulate by re-processing an already-rendered message — the IIFE
  //    removes old badges and adds new ones, but the guard "still has badges" must prevent
  //    scheduleMessageRepair from firing.
  clearBadgeRenderState(message);
  processNativeMessage(message, context);
  await tick();
  const badgeCountBefore = document.querySelectorAll('.tcb-badge-img').length;
  // Re-process — old badges removed, new added in same sync block
  clearBadgeRenderState(message);
  processNativeMessage(message, context);
  await tick();
  await awaitRaf(); // let any rAF-scheduled repair run
  const badgeCountAfter = document.querySelectorAll('.tcb-badge-img').length;
  assert.equal(badgeCountAfter, badgeCountBefore, 're-render must not cause badge loss or duplication');

  // ── 9. Recycle during async fetch (C3): original detached, badge attaches to replacement live node for same login.
  clearBadgeRenderState(message);
  let recResolve;
  const recP = new Promise(r => { recResolve = r; });
  const recCtx = { getCurrentChannel: () => 'testchannel', getCachedUser: () => undefined, resolveBadgesForLogin: () => recP };
  processNativeMessage(message, recCtx);
  const replacement = document.createElement('div');
  replacement.className = 'chat-line__message';
  replacement.innerHTML = '<span class="chat-line__message--badges"></span><span class="chat-line__username"><span class="chat-author__display-name" data-a-user="viewerone">viewerone</span></span>';
  document.body.appendChild(replacement);
  message.remove();
  recResolve([{ image_url: 'https://example.test/rec.png', title: 'Rec', source: 'tra', rank: 1 }]);
  await tick();
  assert.equal(replacement.querySelectorAll('.tcb-badge-img').length, 1, 'recycle fallback must attach');
  replacement.remove();

  console.log('tribute-dom-stability: PASS (9 checks)');
})().catch((e) => { console.error('tribute-dom-stability: FAIL', e); process.exit(1); });
