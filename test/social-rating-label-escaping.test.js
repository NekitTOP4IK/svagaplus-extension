const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');

// webextension-polyfill throws outside an extension; stub it before cards.ts pulls it in.
const polyfillPath = require.resolve('webextension-polyfill');
require.cache[polyfillPath] = {
  id: polyfillPath,
  filename: polyfillPath,
  loaded: true,
  exports: { runtime: { sendMessage: async () => ({}) } },
};

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://www.twitch.tv/testchannel' });
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.CSS = { escape: (value) => String(value).replace(/["\\]/g, '\\$&') };
global.__FRONTEND_URL__ = 'https://svagaplus.com';

const { updateBadgeScore } = require('../dist-types/features/social-rating/cards.js');

function mountBadge(channel) {
  document.body.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.setAttribute('data-tsr-badge', 'viewerone');
  wrap.setAttribute('data-tsr-channel', channel);
  const label = document.createElement('div');
  label.setAttribute('data-tsr-label', '');
  wrap.appendChild(label);
  document.body.appendChild(wrap);
  return label;
}

const PAYLOAD = '<img src=x onerror="window.__pwned = true">';

for (const [name, score] of [['normal label', 5], ['low-rating label', -5]]) {
  test(`${name}: channel from the DOM is rendered as text, not HTML`, () => {
    const label = mountBadge(PAYLOAD);
    updateBadgeScore('viewerone', score);

    assert.equal(label.querySelector('img'), null);
    assert.ok(label.textContent.startsWith(`${PAYLOAD} / `));
  });
}

test('low-rating label keeps the warning icon and the text span', () => {
  const label = mountBadge('somechannel');
  updateBadgeScore('viewerone', -1);

  assert.equal(label.children.length, 2);
  assert.equal(label.children[0].tagName.toLowerCase(), 'svg');
  assert.equal(label.children[1].tagName, 'SPAN');
  assert.equal(label.children[1].textContent, 'somechannel / Низкий рейтинг');
});

test('normal label is a single text span', () => {
  const label = mountBadge('somechannel');
  updateBadgeScore('viewerone', 3);

  assert.equal(label.children.length, 1);
  assert.equal(label.children[0].tagName, 'SPAN');
  assert.equal(label.children[0].textContent, 'somechannel / Свагометр (соц. рейтинг)');
});
