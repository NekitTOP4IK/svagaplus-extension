const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<body><div id="chat"><div class="chat-input"></div></div><div id="stack"></div></body>', {
  url: 'https://www.twitch.tv/foo',
});
const timers = { active: new Map(), next: 1 };
dom.window.setInterval = (fn, ms) => {
  const id = timers.next++;
  timers.active.set(id, { fn, ms });
  return id;
};
dom.window.clearInterval = (id) => {
  timers.active.delete(id);
};
dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.MutationObserver = dom.window.MutationObserver;
require('./helpers/build-globals').defineBuildGlobals();
const { installFakeBrowser } = require('./helpers/fake-browser');
const { installFakeIo } = require('./helpers/fake-io');

const fake = installFakeBrowser();
const io = installFakeIo();

const { startChatNotices, startPopupBanners } = require('../dist-types/features/banners/index.js');
const { BANNER_STATE_KEY } = require('../dist-types/shared/storage.js');

const wait = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));
const intervalOf = (ms) => [...timers.active.values()].find((timer) => timer.ms === ms);
const plateText = () => document.querySelector('#chat .svp-notice')?.textContent ?? null;
const plates = () => document.querySelectorAll('#chat .svp-notice');

const wire = (id, extra = {}) => ({
  id,
  type: 'info',
  title: null,
  message: `banner ${id}`,
  dismissible: true,
  targets: ['chat', 'popup'],
  ...extra,
});

async function putState(banners, dismissed = []) {
  await fake.storage.local.set({ [BANNER_STATE_KEY]: { snapshot: { revision: `r${Math.random()}`, banners }, dismissed } });
  await wait();
}

function failTimes(socket, times) {
  for (let i = 0; i < times; i += 1) socket.fire('connect_error', new Error('down'));
}

test('a chat banner is placed directly above the chat input, once', async () => {
  fake.store[BANNER_STATE_KEY] = { snapshot: { revision: 'r1', banners: [wire(1, { message: 'Hello chat' })] }, dismissed: [] };
  startChatNotices();
  await wait();
  assert.equal(plates().length, 1);
  assert.match(plateText(), /Hello chat/);
  assert.equal(document.querySelector('.chat-input').previousElementSibling, document.querySelector('#chat .svp-notice'));
});

test('the close button dismisses the banner for good and prunes the list', async () => {
  await putState([wire(1, { message: 'low' }), wire(2, { type: 'danger', message: 'urgent' })]);
  assert.match(plateText(), /urgent/);
  document.querySelector('#chat .svp-notice__close').click();
  await wait();
  assert.deepEqual(fake.store[BANNER_STATE_KEY].dismissed, [2]);
  assert.match(plateText(), /low/);
  document.querySelector('#chat .svp-notice__close').click();
  await wait();
  assert.deepEqual([...fake.store[BANNER_STATE_KEY].dismissed].sort(), [1, 2]);
  assert.equal(plates().length, 0);
});

test('the connection-lost plate appears on the third failed attempt and counts down', async () => {
  await putState([wire(3, { message: 'three' })]);
  assert.match(plateText(), /three/);
  const realRandom = Math.random;
  Math.random = () => 0.5;
  const socket = io.socket();
  socket.fire('connect');
  socket.fire('disconnect', 'transport close');
  failTimes(socket, 1);
  assert.match(plateText(), /three/);
  assert.equal(intervalOf(1000), undefined);

  failTimes(socket, 1);
  Math.random = realRandom;
  assert.equal(plates().length, 1);
  assert.match(plateText(), /Потеряно соединение с сервером\./);
  assert.match(plateText(), /Повтор через 4 с…/);
  assert.match(plateText(), /Статус ↗/);
  assert.equal(document.querySelector('#chat .svp-notice a').href, 'https://status.svagaplus.com/');

  const realNow = Date.now;
  Date.now = () => realNow() + 2000;
  intervalOf(1000).fn();
  Date.now = realNow;
  assert.match(plateText(), /Повтор через 2 с…/);
  assert.equal(plates().length, 1);

  socket.fire('connect');
  assert.match(plateText(), /three/);
  assert.equal(intervalOf(1000), undefined);
});

test('closing the connection plate hides it until the next connect', async () => {
  const socket = io.socket();
  socket.fire('disconnect', 'transport close');
  failTimes(socket, 2);
  assert.match(plateText(), /Потеряно соединение/);
  document.querySelector('#chat .svp-notice__close').click();
  assert.match(plateText(), /three/);

  failTimes(socket, 1);
  assert.match(plateText(), /three/);

  socket.fire('connect');
  socket.fire('disconnect', 'transport close');
  failTimes(socket, 2);
  assert.match(plateText(), /Потеряно соединение/);
  socket.fire('connect');
});

test('the plate is re-attached when Twitch rebuilds the chat column', async () => {
  const chat = document.getElementById('chat');
  chat.replaceChildren();
  const fresh = document.createElement('div');
  fresh.className = 'chat-input';
  chat.append(fresh);
  await wait(30);
  assert.equal(plates().length, 1);
  assert.equal(fresh.previousElementSibling, document.querySelector('#chat .svp-notice'));
});

test('an expired maintenance plate leaves on the minute tick without any event', async () => {
  const now = Date.now();
  const payload = {
    starts_at: new Date(now - 60_000).toISOString(),
    ends_at: new Date(now + 30_000).toISOString(),
    affected: ['extension'],
  };
  await putState([wire(9, { type: 'maintenance', message: 'Работы', payload })]);
  assert.match(plateText(), /Техработы — Работы/);

  const realNow = Date.now;
  Date.now = () => realNow() + 60_000;
  intervalOf(60_000).fn();
  await wait();
  Date.now = realNow;
  assert.equal(plates().length, 0);
});

test('the popup stack shows every popup banner in full and dismisses one at a time', async () => {
  const container = document.getElementById('stack');
  await putState([
    wire(11, { title: 'First', message: 'with **bold**' }),
    wire(12, { message: 'second', targets: ['chat'] }),
    wire(13, { type: 'tip', message: 'third' }),
  ]);
  startPopupBanners(container);
  await wait();
  assert.equal(container.querySelectorAll('.svp-notice--expanded').length, 2);
  assert.equal(container.querySelector('b').textContent, 'bold');
  assert.doesNotMatch(container.textContent, /second/);

  container.querySelector('.svp-notice__close').click();
  await wait();
  assert.equal(container.querySelectorAll('.svp-notice').length, 1);
  assert.match(container.textContent, /third/);
  assert.deepEqual(fake.store[BANNER_STATE_KEY].dismissed, [11]);
});

test.after(() => dom.window.close());
