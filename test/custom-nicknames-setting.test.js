const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const dom = new JSDOM(`
  <div class="viewer-card-header__display-name">
    <a class="tw-link" href="/alpha">alpha</a>
  </div>
`, { url: 'https://www.twitch.tv/testchannel' });

global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.NodeFilter = dom.window.NodeFilter;

require('./helpers/build-globals').defineBuildGlobals();
const chrome = require('./helpers/extension-env').stubExtensionApis();

chrome.runtime.sendMessage = (message) => {
  if (message?.type === 'GET_ALIASES') {
    return Promise.resolve({ aliases: { alpha: 'Альфа' } });
  }
  if (message?.type === 'settings:get') {
    return Promise.resolve({
      ok: true,
      settings: { socialRatingEnabled: true, customNicknamesEnabled: false },
    });
  }
  return Promise.resolve({ ok: true });
};

const aliasManager = require('../dist-types/features/social-rating/alias-manager.js');
const injector = require('../dist-types/features/social-rating/alias-injector.js');

test('disabled custom nicknames stay hidden without disabling badge-related content', async (t) => {
  t.after(() => dom.window.close());
  await aliasManager.initAliasManager();

  assert.equal(aliasManager.areCustomNicknamesEnabled(), false);
  assert.equal(aliasManager.getAlias('alpha'), null);
  assert.deepEqual(aliasManager.getAllAliases(), {});

  const card = document.body;
  injector.applyAliasesToViewerCard(card, 'alpha');
  injector.injectCardAliasControls(card, 'alpha', () => {}, () => {});

  assert.equal(card.querySelector('.tw-link').textContent, 'alpha');
  assert.equal(card.querySelector('[data-tsr-alias-controls]'), null);
});
