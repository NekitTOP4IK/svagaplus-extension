'use strict';

// webextension-polyfill бросает «This script should only be loaded in a browser
// extension», если не видит chrome.runtime.id. Из-за этого модули, импортирующие
// shared/browser (в частности features/tribute-badges/index), нельзя было
// подключить в node-тестах вовсе.
//
// Заглушка минимальная и намеренно «глупая»: sendMessage резолвится в null,
// слушатели никуда не подписываются. Тестам нужен факт загрузки модуля, а не
// работающий messaging — если конкретному тесту нужно поведение, он подменяет
// нужный метод сам, уже после вызова.
function stubExtensionApis() {
  const noopListener = { addListener() {}, removeListener() {}, hasListener() { return false; } };

  const chrome = {
    runtime: {
      id: 'test-extension-id',
      lastError: undefined,
      sendMessage: () => Promise.resolve(null),
      onMessage: noopListener,
      getURL: (path) => `chrome-extension://test-extension-id/${String(path).replace(/^\//, '')}`,
      getManifest: () => ({ version: '0.0.0-test' }),
    },
    storage: {
      local: {
        get: () => Promise.resolve({}),
        set: () => Promise.resolve(),
        remove: () => Promise.resolve(),
      },
      session: {
        get: () => Promise.resolve({}),
        set: () => Promise.resolve(),
        remove: () => Promise.resolve(),
      },
      onChanged: noopListener,
    },
    tabs: {
      query: () => Promise.resolve([]),
      sendMessage: () => Promise.resolve(null),
      create: () => Promise.resolve({}),
    },
  };

  global.chrome = chrome;
  global.browser = chrome;
  if (typeof globalThis !== 'undefined') {
    globalThis.chrome = chrome;
    globalThis.browser = chrome;
  }
  return chrome;
}

module.exports = { stubExtensionApis };
