'use strict';

function createFakeBrowser(initial = {}) {
  const store = { ...initial };
  const changeListeners = [];
  const listener = () => {
    const list = [];
    return { list, addListener: (fn) => list.push(fn) };
  };
  const onAlarm = listener();
  const onStartup = listener();
  const onInstalled = listener();
  const alarms = new Map();

  const fake = {
    store,
    setCalls: 0,
    alarmCreates: [],
    onAlarm,
    onStartup,
    onInstalled,
    storage: {
      local: {
        get: async (key) => (typeof key === 'string' ? (key in store ? { [key]: store[key] } : {}) : { ...store }),
        set: async (values) => {
          fake.setCalls += 1;
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = { oldValue: store[key], newValue: value };
            store[key] = value;
          }
          for (const fn of [...changeListeners]) fn(changes, 'local');
        },
      },
      onChanged: { addListener: (fn) => changeListeners.push(fn) },
    },
    runtime: {
      getManifest: () => ({ version: '1.3.1' }),
      onStartup: { addListener: onStartup.addListener },
      onInstalled: { addListener: onInstalled.addListener },
    },
    alarms: {
      onAlarm: { addListener: onAlarm.addListener },
      get: async (name) => alarms.get(name),
      create: async (name, info) => {
        fake.alarmCreates.push([name, info]);
        alarms.set(name, { name, ...info });
      },
    },
  };
  return fake;
}

function installFakeBrowser(initial) {
  const fake = createFakeBrowser(initial);
  const polyfillPath = require.resolve('webextension-polyfill');
  require.cache[polyfillPath] = { id: polyfillPath, filename: polyfillPath, loaded: true, exports: fake };
  return fake;
}

module.exports = { installFakeBrowser };
