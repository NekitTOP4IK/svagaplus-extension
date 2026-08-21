const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const test = require('node:test');

function setupDom() {
  const dom = new JSDOM(`
    <div class="chat-line__message">
      <span class="chat-line__message--badges"></span>
      <span class="chat-line__username"><span class="chat-author__display-name">viewer</span></span>
    </div>
    <div class="seventv-user-message">
      <div class="seventv-chat-user">
        <span class="seventv-chat-user-username">viewer</span>
        <span class="seventv-chat-user-badge-list"></span>
      </div>
    </div>
  `, { url: 'https://www.twitch.tv/channel' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Element = dom.window.Element;
  global.location = dom.window.location;
  global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
}

test('collectible GIFs use the dedicated Twitch and 7TV slots without rarity effects', async () => {
  setupDom();
  const { processNativeMessage } = require('../dist-types/features/tribute-badges/native-chat.js');
  const { processSevenTVMessage } = require('../dist-types/features/tribute-badges/seventv-chat.js');
  const badge = {
    image_url: 'https://example.test/collectible.gif',
    title: 'Collector',
    source: 'collectible',
    rarity: 'mythic',
    is_animated: true,
  };
  const context = {
    getCurrentChannel: () => 'channel',
    getCachedUser: () => undefined,
    resolveBadgesForLogin: async () => [badge],
  };

  processNativeMessage(document.querySelector('.chat-line__message'), context);
  processSevenTVMessage(document.querySelector('.seventv-user-message'), context);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const nativeImage = document.querySelector('.tcb-badge-list .tcb-badge-img');
  const sevenTvImage = document.querySelector('.tcb-badge-list-stv .tcb-badge-img');
  assert.ok(nativeImage, 'Twitch collectible badge should use the dedicated badge slot');
  assert.ok(sevenTvImage, '7TV collectible badge should use the dedicated badge slot');
  for (const image of [nativeImage, sevenTvImage]) {
    assert.equal(image.src, 'https://example.test/collectible.gif');
    assert.ok(image.classList.contains('tcb-badge-img'));
    assert.ok(!image.className.includes('common') && !image.className.includes('rare') && !image.className.includes('epic') && !image.className.includes('mythic'));
    assert.equal(image.style.filter, '');
  }
});
