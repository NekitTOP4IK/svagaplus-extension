const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<body></body>', { url: 'https://www.twitch.tv/foo' });
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

const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
const { installFakeIo } = require('./helpers/fake-io');
const io = installFakeIo();

const log = [];
const messages = [];
const modes = { foo: 'legacy', bar: 'snapshot', baz: 'snapshot', ghost: 'unknown', qux: 'snapshot', old: 'legacy' };
const pendingOpens = {};
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
          if (message.channelLogin === 'slow') {
            return new Promise((resolve) => { pendingOpens.slow = resolve; });
          }
          return { ok: true, mode: modes[message.channelLogin] };
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

const { startTributeBadgesContent } = require('../dist-types/features/tribute-badges/index.js');
const { getSharedSocket } = require('../dist-types/shared/socket.js');

function socketLog(socket) {
  const emit = socket.emit;
  socket.emit = (...args) => {
    log.push([args[0], args[1]?.channel_name]);
    return emit(...args);
  };
}

function snapshotEvents() {
  return messages.filter((m) => m.type === 'SNAPSHOT_EVENT');
}

test('tribute badges ride the shared socket across channel changes', { timeout: 15_000 }, async (t) => {
  const originalRandom = Math.random;
  Math.random = () => 0;
  t.after(() => { Math.random = originalRandom; });

  startTributeBadgesContent();
  assert.equal(io.sockets.length, 1, 'the shared socket is created once');
  const socket = io.socket();
  socketLog(socket);

  socket.fire('connect');
  assert.equal(socket.joins().length, 0, 'no join before SNAPSHOT_OPEN answers');
  await wait();
  assert.deepEqual(socket.lastJoin('foo').slice(0, 2), ['join_channel', { channel_name: 'foo' }]);
  assert.equal(typeof socket.lastJoin('foo')[2], 'function');
  socket.ackJoin('foo');
  await wait();

  log.length = 0;
  history.pushState({}, '', '/bar');
  await wait();
  assert.deepEqual(log, [
    ['leave_channel', 'foo'],
    ['SNAPSHOT_OPEN', 'bar'],
    ['join_channel', 'bar'],
  ]);
  assert.equal(io.sockets.length, 1, 'switching channels must not create another socket');

  messages.length = 0;
  socket.fire('badge_update', { type: 'channel_refresh', rev: 3 });
  await wait();
  assert.equal(snapshotEvents().length, 0, 'badge_update before the join ack is a late event from the old room');
  assert.ok(!messages.some((m) => m.type === 'INVALIDATE_TRIBUTE_BADGE_CACHE'), 'late event must not invalidate anything');

  socket.ackJoin('bar', { channel: 'bar', known: true, rev: 5, global_rev: 1 });
  await wait();
  assert.deepEqual(messages.find((m) => m.type === 'SNAPSHOT_SYNC'), {
    type: 'SNAPSHOT_SYNC', channelLogin: 'bar', rev: 5, global_rev: 1, reconnect: false,
  });

  messages.length = 0;
  socket.fire('badge_update', { type: 'channel_refresh', rev: 6 });
  await wait();
  const invalidations = messages.filter((m) => m.type === 'INVALIDATE_TRIBUTE_BADGE_CACHE' && !m.login);
  assert.deepEqual(invalidations.map((m) => m.channelLogin), ['bar'], 'channel_refresh targets the current channel');
  assert.deepEqual(snapshotEvents().map((m) => m.channelLogin), ['bar']);

  log.length = 0;
  messages.length = 0;
  history.pushState({}, '', '/baz');
  await wait();
  assert.deepEqual(log, [['leave_channel', 'bar'], ['SNAPSHOT_OPEN', 'baz'], ['join_channel', 'baz']]);
  socket.lastJoin('baz')[2]({ channel: 'bar', known: true, rev: 9, global_rev: 1 });
  await wait();
  assert.equal(messages.filter((m) => m.type === 'SNAPSHOT_SYNC').length, 0, 'an ack for another channel is ignored');
  socket.fire('badge_update', { type: 'user_update', rev: 10, data: { twitch_username: 'alice' } });
  await wait();
  assert.equal(snapshotEvents().length, 0, 'events stay dropped until the ack of the current join');
  socket.ackJoin('baz', { channel: 'baz', known: true, rev: 10, global_rev: 1 });
  socket.fire('badge_update', { type: 'user_update', rev: 11, data: { twitch_username: 'alice' } });
  await wait();
  assert.deepEqual(messages.find((m) => m.type === 'SNAPSHOT_SYNC').channelLogin, 'baz');
  assert.deepEqual(snapshotEvents().map((m) => [m.channelLogin, m.event.rev]), [['baz', 11]]);
  assert.ok(messages.some((m) => m.type === 'INVALIDATE_TRIBUTE_BADGE_CACHE' && m.channelLogin === 'baz' && m.login === 'alice'));

  log.length = 0;
  messages.length = 0;
  history.pushState({}, '', '/ghost');
  await wait();
  assert.deepEqual(log, [['leave_channel', 'baz'], ['SNAPSHOT_OPEN', 'ghost']], 'an unknown channel is never joined');
  assert.equal(getSharedSocket().state().connected, true, 'the socket stays alive on an unknown channel');
  socket.fire('badge_update', { type: 'user_update', rev: 12, data: { twitch_username: 'alice' } });
  socket.fire('badge_grants_updated', { channel: 'ghost', rev: 4 });
  socket.fire('disconnect', 'transport close');
  socket.fire('connect');
  await wait();
  assert.equal(socket.lastJoin('ghost'), undefined, 'reconnect does not join an unknown channel');
  assert.deepEqual(messages.filter((m) => m.type !== 'SNAPSHOT_OPEN' && m.type !== 'FETCH_CHANNEL_BADGES'), [],
    'nothing is forwarded to the worker for an unknown channel');

  log.length = 0;
  history.pushState({}, '', '/slow');
  await wait();
  history.pushState({}, '', '/qux');
  await wait();
  pendingOpens.slow({ ok: true, mode: 'snapshot' });
  await wait();
  assert.deepEqual(log, [
    ['SNAPSHOT_OPEN', 'slow'],
    ['SNAPSHOT_OPEN', 'qux'],
    ['join_channel', 'qux'],
  ], 'a SNAPSHOT_OPEN answer for a channel already left is ignored');
  socket.ackJoin('qux', { channel: 'qux', known: true, rev: 1, global_rev: 1 });
  await wait();

  messages.length = 0;
  history.pushState({}, '', '/old');
  await wait();
  socket.fire('badge_update', { type: 'channel_refresh' });
  await wait();
  assert.ok(!messages.some((m) => m.type === 'INVALIDATE_TRIBUTE_BADGE_CACHE'), 'dropped while the ack is pending');
  await wait(2_100);
  socket.fire('badge_update', { type: 'channel_refresh' });
  await wait();
  assert.ok(messages.some((m) => m.type === 'INVALIDATE_TRIBUTE_BADGE_CACHE' && m.channelLogin === 'old'),
    'an old backend that never acks is handled after the timeout');

  log.length = 0;
  messages.length = 0;
  history.pushState({}, '', '/directory');
  await wait();
  socket.fire('disconnect', 'transport close');
  socket.fire('connect');
  await wait();
  assert.deepEqual(log, [['leave_channel', 'old']], 'a page without a channel leaves and never joins');
  assert.equal(getSharedSocket().state().connected, true, 'the socket lives on /directory');
  socket.fire('badge_update', { type: 'channel_refresh', rev: 2 });
  socket.fire('badge_grants_updated', { channel: 'old', rev: 2 });
  await wait();
  assert.deepEqual(messages, [], 'no channel, nothing handled or forwarded');

  assert.equal(io.sockets.length, 1);
});
