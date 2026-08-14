'use strict';

// webextension-polyfill бросает «This script should only be loaded in a browser
// extension», если не видит chrome.runtime.id. Из-за этого модули, импортирующие
// shared/browser (в частности features/tribute-badges/index), нельзя было
// подключить в node-тестах вовсе.
//
// Заглушка минимальная и намеренно «глупая»: sendMessage резолвится в null.
// Runtime message listeners сохраняются для интеграционных тестов; остальные
// слушатели никуда не подписываются. Если тесту нужно другое поведение, он
// подменяет нужный метод сам после вызова.
function stubExtensionApis() {
  const noopListener = { addListener() {}, removeListener() {}, hasListener() { return false; } };
  const runtimeMessageListeners = [];
  const runtimeMessageListener = {
    addListener(listener) { runtimeMessageListeners.push(listener); },
    removeListener(listener) {
      const index = runtimeMessageListeners.indexOf(listener);
      if (index >= 0) runtimeMessageListeners.splice(index, 1);
    },
    hasListener(listener) { return runtimeMessageListeners.includes(listener); },
  };

  const chrome = {
    __runtimeMessageListeners: runtimeMessageListeners,
    runtime: {
      id: 'test-extension-id',
      lastError: undefined,
      sendMessage: () => Promise.resolve(null),
      onMessage: runtimeMessageListener,
      // app/background регистрирует их на верхнем уровне модуля, то есть
      // прямо при импорте в тесте.
      onInstalled: noopListener,
      onStartup: noopListener,
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
