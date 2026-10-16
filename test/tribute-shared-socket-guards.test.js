const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const dom = new JSDOM(`
  <div class="chat-line__message">
    <span class="chat-line__message--badges"></span>
    <span class="chat-line__username"><span class="chat-author__display-name" data-a-user="alice">alice</span></span>
  </div>
`, { url: 'https://www.twitch.tv/a' });
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

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const io = require('./helpers/fake-io').installFakeIo();

const log = [];
const messages = [];
const polyfillPath = require.resolve('webextension-polyfill');
require.cache[polyfillPath] = {
  id: polyfillPath,
  filename: polyfillPath,
  loaded: true,
  exports: {
    runtime: {
      sendMessage: async (message) => {
        messages.push(message);
        if (message?.type === 'SNAPSHOT_OPEN') {
          log.push(['SNAPSHOT_OPEN', message.channelLogin]);
          return { ok: true, mode: 'snapshot' };
        }
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

const { getSharedSocket } = require('../dist-types/shared/socket.js');
const shared = getSharedSocket();
let onConnectSubscribers = 0;
const onConnect = shared.onConnect.bind(shared);
shared.onConnect = (handler) => {
  onConnectSubscribers += 1;
  return onConnect(handler);
};

const content = require('../dist-types/features/tribute-badges/index.js');

const of = (type, channel) => messages.filter((m) => m.type === type && (channel === undefined || m.channelLogin === channel));
const userUpdate = (rev) => ({ type: 'user_update', rev, data: { twitch_username: 'bob' } });

test('join guards on the shared socket', { timeout: 20_000 }, async (t) => {
  const originalRandom = Math.random;
  Math.random = () => 0;
  t.after(() => { Math.random = originalRandom; });

  content.startTributeBadgesContent();
  const socket = io.socket();
  socket.emit = ((emit) => (...args) => {
    log.push([args[0], args[1]?.channel_name]);
    return emit(...args);
  })(socket.emit);
  socket.fire('connect');
  await wait();

  messages.length = 0;
  socket.fire('badge_update', userUpdate(1));
  await wait();
  assert.deepEqual(of('SNAPSHOT_EVENT').map((m) => m.channelLogin), ['a'],
    'the first join on a fresh connection has no old room, so nothing is dropped before its ack');
  socket.ackJoin('a', { channel: 'a', known: true, rev: 1, global_rev: 1 });
  await wait();

  content.__seedViewerBadgeCache('a', 'alice', Date.now() - 1);
  socket.fire('disconnect', 'transport close');
  messages.length = 0;
  socket.fire('connect');
  socket.fire('badge_update', userUpdate(2));
  await wait(200);
  assert.deepEqual(of('SNAPSHOT_EVENT').map((m) => m.channelLogin), ['a'], 'a reconnect join does not drop events');
  assert.equal(of('FETCH_CHANNEL_BADGES').length, 0, 'the reconnect fetch waits for the ack');
  socket.ackJoin('a', { channel: 'a', known: true, rev: 2, global_rev: 1 });
  await wait(200);
  assert.equal(of('SNAPSHOT_SYNC')[0].reconnect, true);
  assert.deepEqual(of('FETCH_CHANNEL_BADGES', 'a').map((m) => m.logins), [['alice']], 'the ack releases the reconnect fetch');

  socket.fire('disconnect', 'transport close');
  socket.fire('connect');
  const staleAck = socket.lastJoin('a')[2];

  log.length = 0;
  messages.length = 0;
  history.pushState({}, '', '/b');
  await wait();
  assert.deepEqual(log, [['leave_channel', 'a'], ['SNAPSHOT_OPEN', 'b'], ['join_channel', 'b']]);
  staleAck({ channel: 'a', known: true, rev: 5, global_rev: 1 });
  socket.fire('badge_update', userUpdate(3));
  await wait();
  assert.equal(of('SNAPSHOT_SYNC').length, 0, 'the ack of a join that was left is ignored');
  assert.equal(of('SNAPSHOT_EVENT').length, 0, 'a stale ack does not open the gate of the current join');
  await wait(2_100);
  assert.equal(of('FETCH_CHANNEL_BADGES', 'a').length, 0, 'neither the stale ack nor the stale timer fetches the old channel');

  log.length = 0;
  messages.length = 0;
  history.pushState({}, '', '/a');
  await wait();
  assert.deepEqual(log, [['leave_channel', 'b'], ['SNAPSHOT_OPEN', 'a'], ['join_channel', 'a']]);
  staleAck({ channel: 'a', known: true, rev: 6, global_rev: 1 });
  socket.fire('badge_update', userUpdate(4));
  await wait();
  assert.equal(of('SNAPSHOT_SYNC').length, 0, 'A->B->A: the first ack of A is still stale');
  assert.equal(of('SNAPSHOT_EVENT').length, 0, 'A->B->A: the gate stays closed until the current ack');
  socket.ackJoin('a', { channel: 'a', known: true, rev: 7, global_rev: 1 });
  socket.fire('badge_update', userUpdate(8));
  await wait();
  assert.deepEqual(of('SNAPSHOT_SYNC').map((m) => [m.channelLogin, m.rev]), [['a', 7]]);
  assert.deepEqual(of('SNAPSHOT_EVENT').map((m) => m.event.rev), [8]);

  log.length = 0;
  history.pushState({}, '', '/directory');
  await wait();
  history.pushState({}, '', '/a');
  await wait();
  assert.deepEqual(log, [['leave_channel', 'a'], ['SNAPSHOT_OPEN', 'a'], ['join_channel', 'a']],
    'returning from /directory rejoins without another leave');

  for (const event of ['badge_update', 'badge_grants_updated', 'social_rating_update']) {
    assert.equal(socket.handlerCount(event), 1, `${event} is registered once`);
  }
  assert.equal(onConnectSubscribers, 1, 'tribute badges subscribe to onConnect once');
  assert.equal(io.sockets.length, 1);
});
