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

// webextension-polyfill throws when loaded outside an extension; stub it before
// requiring chat-badges (which pulls in api.ts -> webextension-polyfill).
const polyfillPath = require.resolve('webextension-polyfill');
require.cache[polyfillPath] = {
  id: polyfillPath,
  filename: polyfillPath,
  loaded: true,
  exports: { runtime: { sendMessage: async () => ({}) } },
};

setupDom(`
  <div class="chat-line__message" data-a-user="viewerone">
    <span class="chat-line__message--badges"></span>
    <span class="chat-line__username"><span class="chat-author__display-name">viewerone</span></span>
  </div>
`);

const chatBadges = require('../dist-types/features/social-rating/chat-badges.js');

(async () => {
  const message = document.querySelector('.chat-line__message');

  // ── 1. Initial render appends one tsr badge image.
  const restore = chatBadges.__testOnlySetGrantsFor(async () => [
    { image_url: 'https://example.test/tsr.png', title: 'Top', kind: 'high', rank: 1, login: 'viewerone' },
  ]);

  await chatBadges.processNativeChatBadges(message, 'testchannel');
  assert.equal(document.querySelectorAll('.tsr-chat-badge-img').length, 1);

  // ── 2. Repair after external removal: clearing DONE_ATTR and re-running re-renders.
  document.querySelector('.tsr-chat-badge-img').remove();
  message.removeAttribute('data-tsr-chat-badges-done');
  await chatBadges.processNativeChatBadges(message, 'testchannel');
  await tick();
  assert.equal(document.querySelectorAll('.tsr-chat-badge-img').length, 1);

  // ── 3. Settled DONE_ATTR for the same login must skip (no duplicate render).
  const imgCountBefore = document.querySelectorAll('.tsr-chat-badge-img').length;
  await chatBadges.processNativeChatBadges(message, 'testchannel');
  assert.equal(document.querySelectorAll('.tsr-chat-badge-img').length, imgCountBefore);

  // ── 4. Failure-retry: grants resolver rejects → DONE_ATTR removed → next call retries.
  message.removeAttribute('data-tsr-chat-badges-done');
  document.querySelectorAll('.tsr-chat-badge-img').forEach((el) => el.remove());
  let failAttempts = 0;
  let shouldFail = true;
  const failRestore = chatBadges.__testOnlySetGrantsFor(async () => {
    failAttempts += 1;
    if (shouldFail) throw new Error('grants fetch failed');
    return [{ image_url: 'https://example.test/retry.png', title: 'Retry', kind: 'high', rank: 1, login: 'viewerone' }];
  });

  await chatBadges.processNativeChatBadges(message, 'testchannel');
  await tick();
  assert.equal(failAttempts, 1);
  assert.equal(document.querySelectorAll('.tsr-chat-badge-img').length, 0, 'no badge after failure');
  assert.equal(message.getAttribute('data-tsr-chat-badges-done'), null, 'DONE_ATTR must be cleared on failure');

  shouldFail = false;
  await chatBadges.processNativeChatBadges(message, 'testchannel');
  await tick();
  assert.equal(failAttempts, 2, 'failed state must retry on next call');
  assert.equal(document.querySelectorAll('.tsr-chat-badge-img').length, 1, 'badge rendered after retry');

  failRestore();

  // ── 5. No infinite repair loop: re-render (self-initiated removal) must not trigger
  //    another repair. The "still has badges" guard in scheduleSocialBadgeRepair prevents it.
  message.removeAttribute('data-tsr-chat-badges-done');
  await chatBadges.processNativeChatBadges(message, 'testchannel');
  await tick();
  const badgeCountBefore = document.querySelectorAll('.tsr-chat-badge-img').length;
  // Re-process — old badges removed, new added in same sync block
  message.removeAttribute('data-tsr-chat-badges-done');
  await chatBadges.processNativeChatBadges(message, 'testchannel');
  await tick();
  await awaitRaf();
  const badgeCountAfter = document.querySelectorAll('.tsr-chat-badge-img').length;
  assert.equal(badgeCountAfter, badgeCountBefore, 're-render must not cause badge loss or duplication');

  // ── 6. Recycle during async: fallback to live node.
  message.removeAttribute('data-tsr-chat-badges-done');
  document.querySelectorAll('.tsr-chat-badge-img').forEach(e => e.remove());
  let recPResolve;
  const recP = new Promise(r => recPResolve = r);
  const recRestore = chatBadges.__testOnlySetGrantsFor(() => recP);
  chatBadges.processNativeChatBadges(message, 'testchannel');
  const sReplacement = document.createElement('div');
  sReplacement.className = 'chat-line__message';
  sReplacement.setAttribute('data-a-user', 'viewerone');
  sReplacement.innerHTML = '<span class="chat-line__message--badges"></span><span class="chat-line__username"><span class="chat-author__display-name">viewerone</span></span>';
  document.body.appendChild(sReplacement);
  message.remove();
  recPResolve([{ image_url: 'https://example.test/srec.png', title: 'SRec', kind: 'high', rank: 1, login: 'viewerone' }]);
  await tick();
  assert.equal(sReplacement.querySelectorAll('.tsr-chat-badge-img').length, 1);
  sReplacement.remove();
  recRestore();

  restore();
  console.log('social-rating-dom-stability: PASS (6 checks)');
})().catch((e) => { console.error('social-rating-dom-stability: FAIL', e); process.exit(1); });
