const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://www.twitch.tv/testchannel' });
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);

const { loginFromNameElement } = require('../dist-types/features/tribute-badges/dom.js');
const { processSevenTVMessage } = require('../dist-types/features/tribute-badges/seventv-chat.js');
const { processNativeMessage } = require('../dist-types/features/tribute-badges/native-chat.js');

function el(html) {
  const host = document.createElement('div');
  host.innerHTML = html.trim();
  document.body.appendChild(host);
  return host.firstElementChild;
}

function recordingContext() {
  const requested = [];
  const styled = [];
  return {
    requested,
    styled,
    context: {
      getCurrentChannel: () => 'testchannel',
      getCachedUser: (login) => {
        styled.push(login);
        return undefined;
      },
      resolveBadgesForLogin: async (_channel, login) => {
        requested.push(login);
        return [];
      },
    },
  };
}

const ALIASED_7TV = `
  <div class="seventv-user-message">
    <div class="seventv-chat-user">
      <span class="seventv-chat-user-username" data-tsr-login="realviewer" data-tsr-original="RealViewer" data-tsr-aliased="true">лелелее</span>
    </div>
  </div>`;

test('an aliased name resolves to the login the alias injector stored', () => {
  assert.equal(loginFromNameElement(el(ALIASED_7TV).querySelector('.seventv-chat-user-username')), 'realviewer');
});

test('native names use data-a-user and localized names use the login in parentheses', () => {
  assert.equal(loginFromNameElement(el('<span data-a-user="nativeone">Кто-то</span>')), 'nativeone');
  assert.equal(loginFromNameElement(el('<span>Дисплей (intlviewer)</span>')), 'intlviewer');
  assert.equal(loginFromNameElement(el('<span>@PlainViewer</span>')), 'plainviewer');
});

test('text that is not a Twitch login yields no login', () => {
  assert.equal(loginFromNameElement(el('<span>лелелее</span>')), '');
  assert.equal(loginFromNameElement(el('<span>a b</span>')), '');
  assert.equal(loginFromNameElement(el('<span data-tsr-login="x y" data-tsr-aliased="true">лелелее</span>')), '');
});

test('a stale alias login is ignored once the injector restored the name', () => {
  assert.equal(loginFromNameElement(el('<span data-tsr-login="oldviewer">newviewer</span>')), 'newviewer');
});

test('7TV message with an alias requests badges and name style for the real login', async () => {
  const { requested, styled, context } = recordingContext();
  processSevenTVMessage(el(ALIASED_7TV), context);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(requested, ['realviewer']);
  assert.ok(styled.length > 0 && styled.every((login) => login === 'realviewer'));
});

test('a 7TV name that is not a login is never sent for badges', async () => {
  const { requested, context } = recordingContext();
  processSevenTVMessage(el(`
    <div class="seventv-user-message">
      <div class="seventv-chat-user"><span class="seventv-chat-user-username">лелелее</span></div>
    </div>`), context);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(requested, []);
});

test('a native name that is not a login is never sent for badges', async () => {
  const { requested, context } = recordingContext();
  processNativeMessage(el(`
    <div class="chat-line__message">
      <span class="chat-line__message--badges"></span>
      <span class="chat-line__username"><span class="chat-author__display-name">лелелее</span></span>
    </div>`), context);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(requested, []);
});
