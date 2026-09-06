const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');

function deferred() {
  let resolve;
  return { promise: new Promise((done) => { resolve = done; }), resolve };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

function popupDocument() {
  return new JSDOM(`
    <body>
      <span id="connectionState"></span><div id="loadingAccount"></div><div id="connectedAccount"></div><div id="disconnectedAccount"></div>
      <button id="primaryAction"></button><button id="secondaryAction"></button><span id="primaryActionLabel"></span><span id="primaryActionSpinner"></span>
      <input id="socialRatingToggle"><input id="customNicknamesToggle"><div id="popupErrorSlot"></div><span id="popupErrorTitle"></span><span id="popupErrorDetail"></span>
      <span id="accountLogin"></span><span id="accountTelegram"></span><span id="accountTelegramMeta"></span><span id="accountTelegramWarning"></span><img id="accountAvatar"><span id="accountAvatarFallback"></span>
      <section id="metricsPanel"></section><span id="metricsState"></span><span id="metricsChannel"></span><dl id="metricsValues"></dl><dd id="swagScore"></dd><dd id="socialScore"></dd>
    </body>
  `, { url: 'chrome-extension://test/popup.html' });
}

function bootPopup(sendMessage, query = () => Promise.resolve([{ url: 'https://www.twitch.tv/alpha' }])) {
  const dom = popupDocument();
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Element = dom.window.Element;
  global.location = dom.window.location;
  global.window.close = () => {};
  require('./helpers/build-globals').defineBuildGlobals();

  const chrome = require('./helpers/extension-env').stubExtensionApis();
  chrome.runtime.sendMessage = sendMessage;
  chrome.tabs.query = query;
  chrome.tabs.onActivated = { addListener() {}, removeListener() {}, hasListener() { return false; } };
  chrome.tabs.onUpdated = { addListener() {}, removeListener() {}, hasListener() { return false; } };

  delete require.cache[require.resolve('../dist-types/popup/popup.js')];
  delete require.cache[require.resolve('../dist-types/shared/browser.js')];
  delete require.cache[require.resolve('webextension-polyfill')];
  require('../dist-types/popup/popup.js');
  return dom;
}

test('disabled rating response stays unavailable instead of rendering server zeroes', async (t) => {
  const account = { twitchLogin: 'viewer', avatarUrl: null, telegramLinked: false, lastCheckedAt: 0 };
  const sent = [];
  const dom = bootPopup((message) => {
    sent.push(message);
    if (message.type === 'viewer:getAccount') return Promise.resolve({ ok: true, account });
    if (message.type === 'settings:get') return Promise.resolve({ ok: true, settings: { socialRatingEnabled: true, customNicknamesEnabled: true } });
    if (message.type === 'viewer:getAuthFeedback') return Promise.resolve({ ok: true, feedback: null });
    if (message.type === 'GET_USER_RATING') return Promise.resolve({ enabled: false, swag_score: 0, social_score: 0 });
    return Promise.resolve({ ok: true });
  });
  t.after(() => dom.window.close());

  await settle();
  await settle();
  assert.ok(sent.some((message) => message.type === 'GET_USER_RATING'));
  assert.match(document.getElementById('metricsState').textContent, /недоступны/);
  assert.equal(document.getElementById('metricsValues').hidden, true);
  assert.equal(document.getElementById('swagScore').textContent, '—');
  assert.equal(document.getElementById('socialScore').textContent, '—');
});

test('logout cannot repaint the prior account when the initial popup load resolves late', async (t) => {
  const oldAccount = deferred();
  const oldSettings = deferred();
  const oldFeedback = deferred();
  const freshAccount = deferred();
  const freshSettings = deferred();
  const freshFeedback = deferred();
  let accountCalls = 0;
  let settingsCalls = 0;
  let feedbackCalls = 0;
  let tabQueries = 0;
  const dom = bootPopup((message) => {
    if (message.type === 'viewer:getAccount') return (++accountCalls === 1 ? oldAccount : freshAccount).promise;
    if (message.type === 'settings:get') return (++settingsCalls === 1 ? oldSettings : freshSettings).promise;
    if (message.type === 'viewer:getAuthFeedback') return (++feedbackCalls === 1 ? oldFeedback : freshFeedback).promise;
    if (message.type === 'viewer:disconnect') return Promise.resolve({ ok: true });
    return Promise.resolve(null);
  }, () => { tabQueries += 1; return Promise.resolve([]); });
  t.after(() => dom.window.close());

  await settle();
  document.getElementById('secondaryAction').click();
  await settle();

  oldAccount.resolve({ ok: true, account: { twitchLogin: 'prior-viewer', avatarUrl: null, telegramLinked: true, lastCheckedAt: 0 } });
  oldSettings.resolve({ ok: true, settings: { socialRatingEnabled: true, customNicknamesEnabled: true } });
  oldFeedback.resolve({ ok: true, feedback: null });
  await settle();

  assert.notEqual(document.getElementById('accountLogin').textContent, 'prior-viewer');
  assert.equal(tabQueries, 0, 'stale account data must not start a metrics request');

  freshAccount.resolve({ ok: true, account: null });
  freshSettings.resolve({ ok: true, settings: { socialRatingEnabled: true, customNicknamesEnabled: true } });
  freshFeedback.resolve({ ok: true, feedback: null });
  await settle();
  assert.match(document.getElementById('metricsState').textContent, /Войдите/);
});
