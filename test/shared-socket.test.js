const assert = require('assert');
const test = require('node:test');
require('./helpers/build-globals').defineBuildGlobals();
const { reconnectDelay, createSharedSocket, getSharedSocket } = require('../dist-types/shared/socket.js');

function setup({ random = 0.5 } = {}) {
  const handlers = new Map();
  const calls = { io: [], connect: 0, emit: [] };
  const fakeSocket = {
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
    },
    off(event, handler) {
      handlers.get(event)?.delete(handler);
    },
    emit(...args) {
      calls.emit.push(args);
    },
    connect() {
      calls.connect += 1;
    },
  };
  const fire = (event, ...args) => {
    for (const handler of [...(handlers.get(event) ?? [])]) handler(...args);
  };

  let time = 1_000;
  let nextTimerId = 1;
  const timers = new Map();
  const deps = {
    io: (url, opts) => {
      calls.io.push([url, opts]);
      return fakeSocket;
    },
    url: 'https://backend.test',
    now: () => time,
    random: () => random,
    setTimer: (fn, ms) => {
      const id = nextTimerId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id);
    },
  };
  const shared = createSharedSocket(deps);
  return {
    shared,
    calls,
    fire,
    timers,
    setTime: (value) => { time = value; },
    runTimers: () => {
      const pending = [...timers.entries()];
      timers.clear();
      for (const [, timer] of pending) timer.fn();
    },
  };
}

test('reconnectDelay follows the capped exponential formula with jitter', () => {
  assert.strictEqual(reconnectDelay(1, 0.5), 1000);
  assert.strictEqual(reconnectDelay(4, 0.5), 8000);
  assert.strictEqual(reconnectDelay(10, 0.5), 15000);
  assert.strictEqual(reconnectDelay(1, 0), 300);
  assert.strictEqual(reconnectDelay(1, 1), 1700);
});

test('creates the socket with manual reconnection', () => {
  const { calls } = setup();
  assert.deepStrictEqual(calls.io, [['https://backend.test', { transports: ['websocket'], reconnection: false }]]);
});

test('three connect_error in a row schedule a retry from the third attempt', () => {
  const { shared, fire, timers } = setup({ random: 0.25 });
  assert.deepStrictEqual(shared.state(), { connected: false, failedAttempts: 0, nextRetryAt: null });
  fire('connect_error', new Error('x'));
  fire('connect_error', new Error('x'));
  fire('connect_error', new Error('x'));
  const state = shared.state();
  assert.strictEqual(state.failedAttempts, 3);
  assert.strictEqual(state.connected, false);
  assert.strictEqual(state.nextRetryAt, 1_000 + reconnectDelay(3, 0.25));
  assert.strictEqual(timers.size, 1);
  assert.strictEqual([...timers.values()][0].ms, reconnectDelay(3, 0.25));
});

test('the retry timer calls connect()', () => {
  const { shared, fire, calls, runTimers } = setup();
  fire('connect_error', new Error('x'));
  assert.strictEqual(calls.connect, 0);
  runTimers();
  assert.strictEqual(calls.connect, 1);
  assert.strictEqual(shared.state().nextRetryAt, null);
  assert.strictEqual(shared.state().failedAttempts, 1);
});

test('a second failure while a retry is pending keeps a single timer', () => {
  const { fire, timers, calls, runTimers } = setup();
  fire('connect_error', new Error('x'));
  fire('disconnect', 'transport close');
  assert.strictEqual(timers.size, 1);
  runTimers();
  assert.strictEqual(calls.connect, 1);
});

test('a manual disconnect does not schedule a retry', () => {
  const { shared, fire, timers } = setup();
  fire('connect');
  fire('disconnect', 'io client disconnect');
  assert.strictEqual(timers.size, 0);
  assert.deepStrictEqual(shared.state(), { connected: false, failedAttempts: 0, nextRetryAt: null });
});

test('a server-side disconnect schedules a retry', () => {
  const { shared, fire, timers } = setup();
  fire('connect');
  fire('disconnect', 'transport close');
  assert.strictEqual(timers.size, 1);
  assert.strictEqual(shared.state().failedAttempts, 1);
  assert.strictEqual(shared.state().connected, false);
});

test('connect resets the state, cancels the retry and notifies onConnect subscribers', () => {
  const { shared, fire, timers } = setup();
  let first = 0;
  let second = 0;
  shared.onConnect(() => { first += 1; });
  shared.onConnect(() => { second += 1; });
  fire('connect_error', new Error('x'));
  fire('connect_error', new Error('x'));
  fire('connect');
  assert.deepStrictEqual(shared.state(), { connected: true, failedAttempts: 0, nextRetryAt: null });
  assert.strictEqual(timers.size, 0);
  assert.strictEqual(first, 1);
  assert.strictEqual(second, 1);
  fire('disconnect', 'transport close');
  fire('connect');
  assert.strictEqual(first, 2);
});

test('onConnect fires immediately when already connected', () => {
  const { shared, fire } = setup();
  fire('connect');
  let called = 0;
  shared.onConnect(() => { called += 1; });
  assert.strictEqual(called, 1);
});

test('onConnect unsubscribe stops further calls', () => {
  const { shared, fire } = setup();
  let called = 0;
  const off = shared.onConnect(() => { called += 1; });
  off();
  fire('connect');
  assert.strictEqual(called, 0);
});

test('onState reports every transition and can be unsubscribed', () => {
  const { shared, fire } = setup();
  const seen = [];
  const off = shared.onState((s) => seen.push(s));
  fire('connect_error', new Error('x'));
  fire('connect');
  assert.deepStrictEqual(seen.map((s) => [s.connected, s.failedAttempts]), [[false, 1], [true, 0]]);
  off();
  fire('disconnect', 'transport close');
  assert.strictEqual(seen.length, 2);
});

test('on() subscribes to socket events and returns an unsubscribe', () => {
  const { shared, fire } = setup();
  const got = [];
  const off = shared.on('badge_update', (msg) => got.push(msg));
  fire('badge_update', { a: 1 });
  off();
  fire('badge_update', { a: 2 });
  assert.deepStrictEqual(got, [{ a: 1 }]);
});

test('emit forwards to the socket while connected', () => {
  const { shared, fire, calls } = setup();
  fire('connect');
  shared.emit('join_channel', { channel_name: 'x' });
  assert.deepStrictEqual(calls.emit, [['join_channel', { channel_name: 'x' }]]);
});

test('emit sends no trailing arguments for missing data or ack', () => {
  const { shared, fire, calls } = setup();
  fire('connect');
  const ack = () => {};
  shared.emit('subscribe_banners');
  shared.emit('leave_channel', { channel_name: 'x' });
  shared.emit('join_channel', { channel_name: 'x' }, ack);
  assert.deepStrictEqual(calls.emit, [
    ['subscribe_banners'],
    ['leave_channel', { channel_name: 'x' }],
    ['join_channel', { channel_name: 'x' }, ack],
  ]);
});

test('connect_error logs its message once per failure', () => {
  const { fire, runTimers } = setup();
  const warn = console.warn;
  const logged = [];
  console.warn = (...args) => logged.push(args);
  try {
    fire('connect_error', new Error('xhr poll error'));
    runTimers();
  } finally {
    console.warn = warn;
  }
  assert.deepStrictEqual(logged, [['[Svaga+ socket]', 'connect_error', 'xhr poll error']]);
});

test('emit passes the ack callback through to the socket', () => {
  const { shared, fire, calls } = setup();
  fire('connect');
  const ack = () => {};
  shared.emit('join_channel', { channel_name: 'x' }, ack);
  assert.deepStrictEqual(calls.emit, [['join_channel', { channel_name: 'x' }, ack]]);
});

test('an offline emit drops its ack callback', () => {
  const { shared, calls } = setup();
  let acked = 0;
  shared.emit('join_channel', { channel_name: 'x' }, () => { acked += 1; });
  assert.deepStrictEqual(calls.emit, []);
  assert.strictEqual(acked, 0);
});

test('emit is a no-op while disconnected so the send buffer cannot replay it', () => {
  const { shared, fire, calls } = setup();
  shared.emit('join_channel', { channel_name: 'x' });
  fire('connect');
  fire('disconnect', 'transport close');
  shared.emit('subscribe_banners');
  assert.deepStrictEqual(calls.emit, []);
});

test('a throwing state listener does not stop the retry timer from calling connect()', () => {
  const { shared, fire, calls, runTimers } = setup();
  const warn = console.warn;
  console.warn = () => {};
  try {
    shared.onState(() => { throw new Error('boom'); });
    let reached = 0;
    shared.onState(() => { reached += 1; });
    fire('connect_error', new Error('x'));
    runTimers();
    assert.strictEqual(calls.connect, 1);
    assert.strictEqual(reached, 2);
  } finally {
    console.warn = warn;
  }
});

test('a throwing onConnect handler does not stop the others', () => {
  const { shared, fire } = setup();
  const warn = console.warn;
  console.warn = () => {};
  try {
    let called = 0;
    shared.onConnect(() => { throw new Error('boom'); });
    shared.onConnect(() => { called += 1; });
    fire('connect');
    assert.strictEqual(called, 1);
    assert.strictEqual(shared.state().connected, true);
  } finally {
    console.warn = warn;
  }
});

test('a failure after a fired retry timer counts as the next attempt with one pending timer', () => {
  const { shared, fire, calls, timers, runTimers, setTime } = setup({ random: 0.25 });
  const seen = [];
  shared.onState((s) => seen.push({ ...s }));
  fire('connect_error', new Error('x'));
  runTimers();
  assert.strictEqual(calls.connect, 1);
  assert.deepStrictEqual(seen[seen.length - 1], { connected: false, failedAttempts: 1, nextRetryAt: null });
  setTime(5_000);
  fire('connect_error', new Error('x'));
  const state = shared.state();
  assert.strictEqual(state.failedAttempts, 2);
  assert.strictEqual(state.nextRetryAt, 5_000 + reconnectDelay(2, 0.25));
  assert.strictEqual(timers.size, 1);
});

test('handlers registered with on() keep receiving events after a reconnect', () => {
  const { shared, fire, runTimers } = setup();
  const got = [];
  shared.on('badge_update', (msg) => got.push(msg));
  fire('connect');
  fire('disconnect', 'transport close');
  runTimers();
  fire('connect');
  fire('badge_update', { a: 1 });
  assert.deepStrictEqual(got, [{ a: 1 }]);
});

test('getSharedSocket is lazy, null without a global io, and a singleton otherwise', () => {
  assert.strictEqual(getSharedSocket(), null);
  let created = 0;
  global.io = () => {
    created += 1;
    return { on() {}, off() {}, emit() {}, connect() {} };
  };
  try {
    assert.strictEqual(created, 0);
    const first = getSharedSocket();
    assert.ok(first);
    assert.strictEqual(getSharedSocket(), first);
    assert.strictEqual(created, 1);
  } finally {
    delete global.io;
  }
});
