const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const test = require('node:test');

const dom = new JSDOM('<div class="chat"><img class="tcb-badge-img" data-tcb-page="/badges/sub/12" src="https://cdn.test/s.png"><img class="tcb-badge-img" src="https://cdn.test/x.png"></div>', { url: 'https://www.twitch.tv/channel' });
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.KeyboardEvent = dom.window.KeyboardEvent;

const { initBadgeCards, closeBadgeCard } = require('../dist-types/features/tribute-badges/badge-card.js');

const card = {
  kind: 'sub',
  name: 'Ветеран',
  image_url: 'https://cdn.test/s.png',
  rarity: null,
  description: '<b>Выдаётся</b> за подписку',
  owners: 58,
  context: { channel: 'nekit', period: null },
};
const requested = [];
let answer = { card, url: 'https://svaga.test/badges/sub/12' };
initBadgeCards(async (page) => {
  requested.push(page);
  return answer;
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const click = (element) => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

test('a badge with a page opens a card with a link to it', async () => {
  const [linked] = document.querySelectorAll('.tcb-badge-img');
  click(linked);
  await flush();

  const popover = document.querySelector('.tcb-card');
  assert.ok(popover, 'card is shown');
  assert.deepEqual(requested, ['/badges/sub/12']);
  assert.equal(popover.querySelector('.tcb-card__name').textContent, 'Ветеран');
  assert.equal(popover.querySelector('.tcb-card__desc').textContent, '<b>Выдаётся</b> за подписку', 'server text is not parsed as HTML');
  assert.equal(popover.querySelector('.tcb-card__kind').textContent, 'За подписку');
  assert.equal(popover.querySelector('.tcb-card__owners').textContent, '58 подписчиков с ним');
  const link = popover.querySelector('a.tcb-card__link');
  assert.equal(link.href, 'https://svaga.test/badges/sub/12');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
});

test('Escape and an outside click close the card', async () => {
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(document.querySelector('.tcb-card'), null);

  click(document.querySelector('.tcb-badge-img'));
  await flush();
  assert.ok(document.querySelector('.tcb-card'));
  click(document.querySelector('.chat'));
  assert.equal(document.querySelector('.tcb-card'), null);
});

test('badges without a page and failed requests open nothing', async () => {
  requested.length = 0;
  click(document.querySelectorAll('.tcb-badge-img')[1]);
  await flush();
  assert.deepEqual(requested, []);
  assert.equal(document.querySelector('.tcb-card'), null);

  answer = null;
  click(document.querySelector('.tcb-badge-img'));
  await flush();
  assert.equal(document.querySelector('.tcb-card'), null);
  closeBadgeCard();
});
