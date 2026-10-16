const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<body></body>', { url: 'https://www.twitch.tv/ghostchan' });
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
Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
require('./helpers/build-globals').defineBuildGlobals();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sockets = [];
global.io = function mockIo() {
  const handlers = {};
  const socket = {
    emits: [],
    on(event, fn) { handlers[event] = fn; },
    emit(...args) { socket.emits.push(args); },
    disconnect() {},
    handlers,
  };
  sockets.push(socket);
  return socket;
};

const messages = [];
const modes = { ghostchan: 'unknown', olesha: 'snapshot' };
const polyfillPath = require.resolve('webextension-polyfill');
require.cache[polyfillPath] = {
  id: polyfillPath,
  filename: polyfillPath,
  loaded: true,
  exports: {
    runtime: {
      sendMessage: async (message) => {
        messages.push(message);
        if (message?.type === 'SNAPSHOT_OPEN') return { ok: true, mode: modes[message.channelLogin] };
        if (message?.type === 'FETCH_CHANNEL_BADGES') {
          const viewers = {};
          for (const login of message.logins || []) viewers[login] = { badge_ids: [] };
          return { ok: true, badges: {}, font_presets: {}, viewers };
        }
        return { ok: true };
      },
    },
  },
};

const { startTributeBadgesContent } = require('../dist-types/features/tribute-badges/index.js');

(async () => {
  startTributeBadgesContent();
  await wait(30);
  assert.deepEqual(messages.filter((m) => m.type === 'SNAPSHOT_OPEN'), [{ type: 'SNAPSHOT_OPEN', channelLogin: 'ghostchan' }]);
  assert.equal(sockets.length, 0, 'an unknown channel must not open a socket');

  history.pushState({}, '', '/olesha');
  await wait(30);
  assert.equal(sockets.length, 1, 'a known channel opens the socket');
  const socket = sockets[0];

  socket.handlers.connect();
  const join = socket.emits.find(([event]) => event === 'join_channel');
  assert.deepEqual(join[1], { channel_name: 'olesha' });
  assert.equal(typeof join[2], 'function', 'join_channel must pass an ack callback');

  messages.length = 0;
  join[2]({ channel: 'olesha', known: true, rev: 7, global_rev: 2 });
  await wait(10);
  assert.deepEqual(messages.find((m) => m.type === 'SNAPSHOT_SYNC'), {
    type: 'SNAPSHOT_SYNC', channelLogin: 'olesha', rev: 7, global_rev: 2, reconnect: false,
  });

  messages.length = 0;
  join[2]();
  await wait(10);
  assert.equal(messages.filter((m) => m.type === 'SNAPSHOT_SYNC').length, 0, 'an empty ack from an old backend is ignored');

  messages.length = 0;
  socket.handlers.badge_update({
    type: 'user_update',
    rev: 8,
    data: { twitch_username: 'Alice', badge_ids: ['b1'], badges: { b1: { image_url: '/b1.png' } } },
  });
  await wait(10);
  const types = messages.map((m) => m.type);
  assert.ok(types.indexOf('SNAPSHOT_EVENT') >= 0 && types.indexOf('SNAPSHOT_EVENT') < types.indexOf('UPSERT_TRIBUTE_BADGE_CACHE'), types.join(','));
  assert.deepEqual(messages.find((m) => m.type === 'SNAPSHOT_EVENT'), {
    type: 'SNAPSHOT_EVENT',
    channelLogin: 'olesha',
    event: {
      type: 'user_update',
      rev: 8,
      data: { twitch_username: 'Alice', badge_ids: ['b1'], badges: { b1: { image_url: '/b1.png' } } },
    },
  });

  messages.length = 0;
  socket.handlers.badge_update({ type: 'viewer_refresh', global_rev: 3, data: { viewer: 'bob' } });
  socket.handlers.badge_update({ type: 'channel_refresh', rev: 9, data: {} });
  socket.handlers.badge_grants_updated({ channel: 'olesha', rev: 10 });
  socket.handlers.badge_grants_updated({ channel: 'otherchan', rev: 99 });
  await wait(10);
  assert.deepEqual(messages.filter((m) => m.type === 'SNAPSHOT_EVENT').map((m) => m.event), [
    { type: 'viewer_refresh', global_rev: 3, data: { viewer: 'bob' } },
    { type: 'channel_refresh', rev: 9, data: {} },
    { type: 'badge_grants_updated', rev: 10 },
  ]);

  messages.length = 0;
  socket.handlers.connect();
  const rejoin = socket.emits.filter(([event]) => event === 'join_channel')[1];
  rejoin[2]({ channel: 'olesha', known: true, rev: 12, global_rev: 3 });
  await wait(10);
  assert.equal(messages.find((m) => m.type === 'SNAPSHOT_SYNC').reconnect, true);

  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
