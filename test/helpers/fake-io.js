'use strict';

function createFakeSocket(url, options) {
  const handlers = new Map();
  const socket = {
    url,
    options,
    emits: [],
    connectCalls: 0,
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
    },
    off(event, handler) {
      handlers.get(event)?.delete(handler);
    },
    emit(...args) {
      socket.emits.push(args);
    },
    connect() {
      socket.connectCalls += 1;
    },
    fire(event, ...args) {
      for (const handler of [...(handlers.get(event) ?? [])]) handler(...args);
    },
    joins() {
      return socket.emits.filter(([event]) => event === 'join_channel');
    },
    lastJoin(channel) {
      const joins = socket.joins().filter(([, data]) => channel === undefined || data?.channel_name === channel);
      return joins[joins.length - 1];
    },
    ackJoin(channel, ack = { channel, known: true }) {
      const join = socket.lastJoin(channel);
      if (!join) throw new Error(`no join_channel emitted for ${channel}`);
      join[2](ack);
    },
  };
  return socket;
}

function installFakeIo() {
  const sockets = [];
  global.io = (url, options) => {
    const socket = createFakeSocket(url, options);
    sockets.push(socket);
    return socket;
  };
  return { sockets, socket: () => sockets[sockets.length - 1] };
}

module.exports = { installFakeIo, createFakeSocket };
