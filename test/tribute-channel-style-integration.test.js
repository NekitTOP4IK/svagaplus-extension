const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');

function wait(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bounded(promise, label, timeoutMs = 1500) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}

const dom = new JSDOM('<body></body>', { url: 'https://www.twitch.tv/alpha' });
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.Text = dom.window.Text;
global.MutationObserver = dom.window.MutationObserver;
global.location = dom.window.location;
global.history = dom.window.history;
global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });

require('./helpers/build-globals').defineBuildGlobals();
const chrome = require('./helpers/extension-env').stubExtensionApis();

const sockets = [];
global.io = () => {
  const handlers = {};
  const socket = {
    on(event, handler) { handlers[event] = handler; },
    emit() {},
    disconnect() {},
    handlers,
  };
  sockets.push(socket);
  return socket;
};

const colors = { alpha: '#111111', beta: '#222222' };
let fetches = 0;
let responseForFetch = (message) => ({
  ok: true,
  badges: {},
  font_presets: {},
  viewers: Object.fromEntries(message.logins.map((login) => [login, {
    badge_ids: [],
    name_color: colors[message.channelLogin],
  }])),
});
chrome.runtime.sendMessage = async (message) => {
  if (message?.type !== 'FETCH_CHANNEL_BADGES') return { ok: true };
  fetches += 1;
  return responseForFetch(message);
};

const content = require('../dist-types/features/tribute-badges/index.js');

async function loadStyle(channel, login = 'alice') {
  const request = content.__resolveBadgesForLogin(channel, login);
  await bounded(content.__flushViewerBadgeBatchForTest(channel), `${channel}/${login} flush`);
  await bounded(request, `${channel}/${login} viewer request`);
  await wait();
  return document.getElementById('tcb-dynamic-styles')?.textContent || '';
}

test('retains channel styles and rejects stale HTTP writes after realtime invalidation', { timeout: 10_000 }, async (t) => {
  const originalRandom = Math.random;
  Math.random = () => 0;
  t.after(() => {
    Math.random = originalRandom;
    dom.window.close();
  });

  content.startTributeBadgesContent();

  let css = await loadStyle('alpha');
  assert.match(css, /#111111/, 'alpha style must be rendered');

  history.pushState({}, '', '/beta');
  css = await loadStyle('beta');
  assert.match(css, /#222222/, 'beta style must be rendered');
  assert.doesNotMatch(css, /#111111/, 'inactive alpha style must not leak into beta');

  const fetchesBeforeReturn = fetches;
  history.pushState({}, '', '/alpha');
  await wait();
  css = document.getElementById('tcb-dynamic-styles')?.textContent || '';
  assert.match(css, /#111111/, 'returning to alpha must restore its page-session style');
  assert.doesNotMatch(css, /#222222/, 'inactive beta style must not leak into alpha');
  assert.equal(fetches, fetchesBeforeReturn, 'restoring retained styles must not need another response');

  const alphaSocket = sockets.at(-1);
  alphaSocket.handlers.badge_update({
    type: 'user_update',
    data: {
      twitch_username: 'alice',
      name_color: null,
      name_gradient: null,
      name_css: null,
      name_preset_name: null,
      font_preset_id: null,
    },
  });
  await wait();
  css = document.getElementById('tcb-dynamic-styles')?.textContent || '';
  assert.doesNotMatch(css, /#111111/, 'explicit null realtime style must replace and clear alpha style');

  let resolveMixed;
  responseForFetch = () => new Promise((resolve) => { resolveMixed = resolve; });
  const mixedAlice = content.__resolveBadgesForLogin('alpha', 'alice');
  const mixedBob = content.__resolveBadgesForLogin('alpha', 'bob');
  const mixedFlush = content.__flushViewerBadgeBatchForTest('alpha');
  await wait(0);
  alphaSocket.handlers.badge_update({
    type: 'user_update',
    data: {
      twitch_username: 'alice',
      badge_ids: [],
      badges: {},
      font_preset_id: 'shared',
      font_presets: {
        shared: { source: 'cdn', cdn_path: '/realtime.woff2', font_family: 'Realtime Font' },
      },
    },
  });
  resolveMixed({
    ok: true,
    badges: {},
    font_presets: {
      shared: { source: 'cdn', cdn_path: '/stale.woff2', font_family: 'Stale HTTP Font' },
    },
    viewers: {
      alice: { badge_ids: [], font_preset_id: 'shared' },
      bob: { badge_ids: [] },
    },
  });
  await bounded(Promise.all([mixedAlice, mixedBob, mixedFlush]), 'mixed-generation batch');
  await wait();
  css = document.getElementById('tcb-dynamic-styles')?.textContent || '';
  assert.match(css, /Realtime Font/, 'realtime font preset must survive a mixed stale/current batch');
  assert.doesNotMatch(css, /Stale HTTP Font/, 'shared presets from a partially stale batch must be discarded');

  alphaSocket.handlers.badge_update({ type: 'channel_refresh' });
  await wait(0);

  let resolveOld;
  let resolveFresh;
  const oldResponse = new Promise((resolve) => { resolveOld = resolve; });
  const freshResponse = new Promise((resolve) => { resolveFresh = resolve; });
  const responseQueue = [oldResponse, freshResponse];
  responseForFetch = () => responseQueue.shift();

  const oldRequest = content.__resolveBadgesForLogin('alpha', 'alice').catch(() => []);
  const oldFlush = content.__flushViewerBadgeBatchForTest('alpha');
  await wait(0);
  alphaSocket.handlers.badge_update({ type: 'channel_refresh' });
  const freshRequest = content.__resolveBadgesForLogin('alpha', 'alice');
  const freshFlush = content.__flushViewerBadgeBatchForTest('alpha');
  await wait(0);

  resolveOld({
    ok: true, badges: {}, font_presets: {},
    viewers: { alice: { badge_ids: [], name_color: '#333333' } },
  });
  await bounded(oldFlush, 'stale pre-refresh flush');
  await bounded(oldRequest, 'invalidated pre-refresh waiter');
  resolveFresh({
    ok: true, badges: {}, font_presets: {},
    viewers: { alice: { badge_ids: [], name_color: '#444444' } },
  });
  await bounded(freshFlush, 'fresh post-refresh flush');
  await bounded(freshRequest, 'fresh post-refresh waiter');
  await wait();
  css = document.getElementById('tcb-dynamic-styles')?.textContent || '';
  assert.match(css, /#444444/, 'refreshed alpha response must win');
  assert.doesNotMatch(css, /#333333/, 'late pre-refresh response must not restore stale style');

  colors.alpha = '#555555';
  colors.beta = '#666666';
  responseForFetch = (message) => ({
    ok: true, badges: {}, font_presets: {},
    viewers: Object.fromEntries(message.logins.map((login) => [login, {
      badge_ids: [], name_color: colors[message.channelLogin],
    }])),
  });
  alphaSocket.handlers.badge_update({ type: 'channel_refresh' });
  await loadStyle('alpha');
  history.pushState({}, '', '/beta');
  await loadStyle('beta');
  const betaSocket = sockets.at(-1);
  betaSocket.handlers.badge_update({ type: 'viewer_refresh', data: { viewer: 'alice' } });
  await wait();

  history.pushState({}, '', '/alpha');
  await wait();
  css = document.getElementById('tcb-dynamic-styles')?.textContent || '';
  assert.doesNotMatch(css, /#555555/, 'global viewer refresh must clear retained alpha style');
  const fetchesBeforeRefetch = fetches;
  colors.alpha = '#777777';
  css = await loadStyle('alpha');
  assert.ok(fetches > fetchesBeforeRefetch, 'returning after global viewer refresh must refetch viewer');
  assert.match(css, /#777777/, 'refetched alpha style must be rendered');

  history.pushState({}, '', '/beta');
  await wait();
  css = document.getElementById('tcb-dynamic-styles')?.textContent || '';
  assert.doesNotMatch(css, /#666666/, 'global viewer refresh must also clear retained beta style');
  const fetchesBeforeBetaRefetch = fetches;
  colors.beta = '#888888';
  css = await loadStyle('beta');
  assert.ok(fetches > fetchesBeforeBetaRefetch, 'beta must refetch after the same global viewer refresh');
  assert.match(css, /#888888/, 'refetched beta style must be rendered');

  const currentBetaSocket = sockets.at(-1);
  currentBetaSocket.handlers.badge_update({
    type: 'user_update',
    data: { twitch_username: 'carol', name_color: '#999999' },
  });
  await wait();
  css = document.getElementById('tcb-dynamic-styles')?.textContent || '';
  assert.match(css, /#999999/, 'realtime style establishes the omitted-viewer replacement precondition');
  responseForFetch = () => ({ ok: true, badges: {}, font_presets: {}, viewers: {} });
  css = await loadStyle('beta', 'carol');
  assert.doesNotMatch(css, /#999999/, 'authoritative omitted viewer must replace an older retained style');

  assert.equal(content.__getViewerGenerationSize(), 0, 'settled viewer generations must be released');

  console.log('tribute-channel-style-integration: PASS');
});
