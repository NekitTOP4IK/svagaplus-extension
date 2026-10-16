'use strict';

function createFakeSocket(url, options) {
  const handlers = new Map();
  const socket = {
    url,
    options,
    emits: [],
    connectCalls: 0,
    // Arrays like socket.io's Emitter, so a duplicate registration fires twice.
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
    },
    off(event, handler) {
      const list = handlers.get(event);
      const index = list ? list.indexOf(handler) : -1;
      if (index >= 0) list.splice(index, 1);
    },
    handlerCount(event) {
      return handlers.get(event)?.length ?? 0;
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
