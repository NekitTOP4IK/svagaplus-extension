const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<body></body>', { url: 'https://www.twitch.tv/moderator/testchannel' });
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.NodeFilter = dom.window.NodeFilter;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);

require('./helpers/build-globals').defineBuildGlobals();
const chrome = require('./helpers/extension-env').stubExtensionApis();

chrome.runtime.sendMessage = (message) => {
  if (message?.type === 'GET_ALIASES') return Promise.resolve({ aliases: { viewerone: 'Псевдоним' } });
  if (message?.type === 'settings:get') {
    return Promise.resolve({ ok: true, settings: { socialRatingEnabled: true, customNicknamesEnabled: true } });
  }
  return Promise.resolve({ ok: true });
};

const aliasManager = require('../dist-types/features/social-rating/alias-manager.js');
const injector = require('../dist-types/features/social-rating/alias-injector.js');
const { detectCardLogin } = require('../dist-types/features/social-rating/card-detector.js');

function mount(html) {
  document.body.innerHTML = html;
  return document.body.firstElementChild;
}

const MOD_VIEW_PANEL = `
  <div class="user-details" data-a-target="mod-view-user-details">
    <div class="viewer-card-header__background">
      <div class="viewer-card-header__display-name"><h4><a class="tw-link" href="/viewerone">ViewerOne</a></h4></div>
    </div>
    <div class="user-details__content"></div>
  </div>`;

test.before(async () => {
  await aliasManager.initAliasManager();
});

test('mod-view user details panel is detected as an alias-only card', () => {
  const panel = mount(MOD_VIEW_PANEL);
  const detected = detectCardLogin(panel.querySelector('.user-details__content'));
  assert.ok(detected);
  assert.equal(detected.type, 'modview');
  assert.equal(detected.login, 'viewerone');
  assert.equal(detected.element, panel);
});

test('mod-view panel: alias replaces the header name and the rename button sits next to it', () => {
  const panel = mount(MOD_VIEW_PANEL);
  injector.applyAliasesToViewerCard(panel, 'viewerone');
  injector.injectCardAliasControls(panel, 'viewerone', () => {}, () => {});

  const link = panel.querySelector('.tw-link');
  assert.equal(link.textContent, 'Псевдоним');
  assert.equal(link.getAttribute('title'), 'viewerone', 'real login stays reachable');
  assert.equal(link.nextElementSibling?.hasAttribute('data-tsr-alias-controls'), true);

  // Login still resolves after the rename: it comes from href, not from the text.
  assert.equal(detectCardLogin(panel).login, 'viewerone');
});

test('new 7TV card: display name is aliased and gets the rename/reset controls', () => {
  const card = mount(`
    <div class="seventv-usercard">
      <a class="seventv-usercard-icon-button" href="https://twitch.tv/viewerone"></a>
      <div class="seventv-usercard-title">
        <span class="seventv-usercard-display-name">ViewerOne</span>
        <span class="seventv-usercard-paint-label"></span>
      </div>
    </div>`);
  const detected = detectCardLogin(card);
  assert.equal(detected.type, 'seventv');
  assert.equal(detected.login, 'viewerone');

  injector.applyAliasesToViewerCard(card, 'viewerone');
  injector.injectCardAliasControls(card, 'viewerone', () => {}, () => {});

  const name = card.querySelector('.seventv-usercard-display-name');
  assert.equal(name.textContent, 'Псевдоним');
  assert.equal(name.getAttribute('data-tsr-login'), 'viewerone');
  const controls = name.nextElementSibling;
  assert.equal(controls?.hasAttribute('data-tsr-alias-controls'), true);
  assert.equal(controls.querySelectorAll('button').length, 2, 'rename + reset for an aliased user');
});

test('controls are injected once per card', () => {
  const card = mount(MOD_VIEW_PANEL);
  injector.injectCardAliasControls(card, 'viewerone', () => {}, () => {});
  injector.injectCardAliasControls(card, 'viewerone', () => {}, () => {});
  assert.equal(card.querySelectorAll('[data-tsr-alias-controls]').length, 1);
});
