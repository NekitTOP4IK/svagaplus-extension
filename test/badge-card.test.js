const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const test = require('node:test');

const dom = new JSDOM('<div class="chat"><img class="tcb-badge-img" data-tcb-page="/badges/sub/12" src="https://cdn.test/s.png"><img class="tcb-badge-img" src="https://cdn.test/x.png"><img class="tcb-badge-img" data-tcb-page="/badges/collectible/c1" src="https://cdn.test/c.png"></div>', { url: 'https://www.twitch.tv/channel' });
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.KeyboardEvent = dom.window.KeyboardEvent;

const { initBadgeCards, closeBadgeCard } = require('../dist-types/features/tribute-badges/badge-card.js');

const subCard = {
  kind: 'sub',
  name: 'Ветеран',
  image_url: 'https://cdn.test/s.png',
  rarity: null,
  description: '<b>Свои</b> люди',
  how_to_get: 'Выдаётся за подписку в течение 6 месяцев',
  owners: 58,
  context: { channel: 'nekit', period: null },
};
const epicCard = {
  kind: 'collectible',
  name: 'Тыквенный король',
  image_url: 'https://cdn.test/c.png',
  rarity: 'epic',
  description: null,
  how_to_get: null,
  owners: 1,
  context: { channel: null, period: null },
};
const requested = [];
let pending = null;
const answers = {
  '/badges/sub/12': () => ({ card: subCard, url: 'https://svaga.test/badges/sub/12' }),
  '/badges/collectible/c1': () => ({ card: epicCard, url: 'https://svaga.test/badges/collectible/c1' }),
};
initBadgeCards((page) => {
  requested.push(page);
  if (pending) return pending;
  return Promise.resolve(answers[page] ? answers[page]() : null);
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const click = (element) => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
const badges = () => document.querySelectorAll('.tcb-badge-img');

test('a badge with a page opens a card with name, description, how to get and a link', async () => {
  click(badges()[0]);
  await flush();

  const card = document.querySelector('.tcb-bcard');
  assert.ok(card, 'card is shown');
  assert.deepEqual(requested, ['/badges/sub/12']);
  assert.equal(card.querySelector('.tcb-bcard__name').textContent, 'Ветеран');
  assert.equal(card.querySelector('.tcb-bcard__kind').textContent, 'Подписка на nekit');
  assert.equal(card.querySelector('.tcb-bcard__desc').textContent, '<b>Свои</b> люди', 'server text is not parsed as HTML');
  assert.equal(card.querySelector('.tcb-bcard__how-label').textContent, 'Как получить');
  assert.equal(card.querySelector('.tcb-bcard__how-text').textContent, 'Выдаётся за подписку в течение 6 месяцев');
  assert.equal(card.querySelector('.tcb-bcard__owners').textContent, '58 подписчиков с ним');
  const link = card.querySelector('a.tcb-bcard__link');
  assert.equal(link.href, 'https://svaga.test/badges/sub/12');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.ok(document.documentElement.classList.contains('tcb-bcard-open'), 'hover tooltip is suppressed while the card is open');
});

test('a collectible shows its rarity tag and skips empty text blocks', async () => {
  click(badges()[2]);
  await flush();

  const card = document.querySelector('.tcb-bcard');
  assert.equal(card.dataset.rarity, 'epic');
  const tag = card.querySelector('.tcb-rtag');
  assert.ok(tag.classList.contains('tcb-rtag--epic'));
  assert.ok(tag.classList.contains('tcb-rtag--animated'));
  assert.ok(tag.querySelector('.tcb-rtag__gem'));
  assert.equal(tag.textContent, 'Эпический');
  assert.equal(card.querySelector('.tcb-bcard__body'), null);
  assert.equal(card.querySelector('.tcb-bcard__owners').textContent, '1 владелец');
  assert.equal(document.querySelectorAll('.tcb-bcard').length, 1, 'opening another card replaces the first');
});

test('a skeleton holds the place while the card loads', async () => {
  let resolve;
  pending = new Promise((done) => { resolve = done; });
  click(badges()[0]);

  const skeleton = document.querySelector('.tcb-bcard');
  assert.ok(skeleton.classList.contains('tcb-bcard--loading'));
  assert.equal(skeleton.getAttribute('aria-busy'), 'true');
  assert.ok(skeleton.querySelector('.tcb-bcard__bone'));

  resolve(answers['/badges/sub/12']());
  await flush();
  pending = null;
  assert.equal(document.querySelector('.tcb-bcard--loading'), null);
  assert.equal(document.querySelector('.tcb-bcard__name').textContent, 'Ветеран');
});

test('Escape and an outside click close the card', async () => {
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(document.querySelector('.tcb-bcard'), null);
  assert.ok(!document.documentElement.classList.contains('tcb-bcard-open'));

  click(badges()[0]);
  await flush();
  assert.ok(document.querySelector('.tcb-bcard'));
  click(document.querySelector('.chat'));
  assert.equal(document.querySelector('.tcb-bcard'), null);
});

test('badges without a page and failed requests open nothing', async () => {
  requested.length = 0;
  click(badges()[1]);
  await flush();
  assert.deepEqual(requested, []);
  assert.equal(document.querySelector('.tcb-bcard'), null);

  delete answers['/badges/sub/12'];
  click(badges()[0]);
  await flush();
  assert.equal(document.querySelector('.tcb-bcard'), null);
  closeBadgeCard();
});
