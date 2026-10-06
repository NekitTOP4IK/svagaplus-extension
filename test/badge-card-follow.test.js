const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const test = require('node:test');

const dom = new JSDOM(
  '<div class="chat" style="overflow-y: auto"><img class="tcb-badge-img" data-tcb-page="/badges/a" src="https://cdn.test/a.png"><img class="tcb-badge-img" data-tcb-page="/badges/b" src="https://cdn.test/b.png"></div>',
  { url: 'https://www.twitch.tv/channel', pretendToBeVisual: true },
);
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;

const { initBadgeCards, closeBadgeCard } = require('../dist-types/features/tribute-badges/badge-card.js');

const card = (name) => ({
  kind: 'collectible',
  name,
  image_url: 'https://cdn.test/x.png',
  rarity: 'rare',
  description: null,
  how_to_get: null,
  owners: 1,
  context: { channel: null, period: null },
});
initBadgeCards((page) => Promise.resolve({ card: card(page), url: `https://svaga.test${page}` }));

const rect = (top, left = 40) => ({ top, bottom: top + 18, left, right: left + 18, width: 18, height: 18, x: left, y: top });
const chat = document.querySelector('.chat');
chat.getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 0, right: 340, width: 340, height: 600, x: 0, y: 0 });
const [first, second] = document.querySelectorAll('.tcb-badge-img');
let firstTop = 300;
first.getBoundingClientRect = () => rect(firstTop);
second.getBoundingClientRect = () => rect(320);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(() => setTimeout(resolve, 0)));
const click = (element) => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
const opened = () => document.querySelector('.tcb-bcard');

test.afterEach(() => {
  closeBadgeCard();
  firstTop = 300;
  if (!first.isConnected) chat.prepend(first);
});

test('a second click on the same badge closes its card', async () => {
  click(first);
  await flush();
  assert.equal(opened().getAttribute('aria-label'), '/badges/a');

  click(first);
  await flush();
  assert.equal(opened(), null);
  assert.ok(!document.documentElement.classList.contains('tcb-bcard-open'));
});

test('a click on another badge switches the card to it', async () => {
  click(first);
  await flush();
  click(second);
  await flush();

  assert.equal(document.querySelectorAll('.tcb-bcard').length, 1);
  assert.equal(opened().getAttribute('aria-label'), '/badges/b');
});

test('the card follows its badge when the chat moves', async () => {
  click(first);
  await flush();
  assert.equal(opened().style.top, '328px');

  firstTop = 200;
  await frame();
  assert.equal(opened().style.top, '228px');
});

test('the card closes once its badge leaves the visible chat', async () => {
  click(first);
  await flush();

  firstTop = -40;
  await frame();
  assert.equal(opened(), null);
});

test('the card closes when its badge is removed from the chat', async () => {
  click(first);
  await flush();

  first.remove();
  await frame();
  assert.equal(opened(), null);
});
