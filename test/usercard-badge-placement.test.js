const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<body></body>', { url: 'https://www.twitch.tv/testchannel' });
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);

const { processUserCard, USERCARD_SELECTOR } = require('../dist-types/features/tribute-badges/usercard.js');
const { getBadgeRenderState } = require('../dist-types/features/tribute-badges/render-state.js');

const BADGES = [
  { image_url: 'https://example.test/a.png', title: 'A', source: 'tra', rank: 1 },
  { image_url: 'https://example.test/b.png', title: 'B', source: 'tra', rank: 2 },
];

function contextFor(expectedLogin) {
  const calls = [];
  return {
    calls,
    getCurrentChannel: () => 'testchannel',
    getCachedUser: () => undefined,
    resolveBadgesForLogin: async (_channel, login) => {
      calls.push(login);
      return login === expectedLogin ? BADGES : [];
    },
  };
}

async function settle() {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

function mount(html) {
  document.body.innerHTML = html;
  return document.body.firstElementChild;
}

test('old 7TV card: ours go last in the badge grid and the wrapper does not form its own flex item', async () => {
  const card = mount(`
    <div class="seventv-user-card">
      <a class="seventv-user-card-usertag" href="https://twitch.tv/viewerone">
        <div class="seventv-chat-user"><span class="seventv-chat-user-username">viewerone</span></div>
      </a>
      <div class="seventv-user-card-badges">
        <div class="seventv-chat-badge"><img></div>
        <div class="seventv-chat-badge"><img></div>
      </div>
    </div>`);
  const ctx = contextFor('viewerone');
  processUserCard(card, ctx);
  await settle();

  const grid = card.querySelector('.seventv-user-card-badges');
  const last = grid.lastElementChild;
  assert.ok(last.classList.contains('tcb-badge-list--usercard'), 'wrapper is appended after native badges');
  assert.equal(last.querySelectorAll('.tcb-badge-img').length, 2);
  assert.equal(getBadgeRenderState(card), 'rendered');
});

test('new 7TV card: detected, login comes from the alias attribute, badges appended to the end of the row', async () => {
  const card = mount(`
    <div class="seventv-usercard">
      <div class="seventv-usercard-identity">
        <div class="seventv-usercard-title">
          <span class="seventv-usercard-display-name" data-tsr-login="viewerone" data-tsr-aliased="true">Псевдоним</span>
        </div>
      </div>
      <div class="seventv-usercard-badge-section">
        <div class="seventv-usercard-badges"><img class="seventv-usercard-badge"><img class="seventv-usercard-badge"></div>
      </div>
    </div>`);
  assert.ok(card.matches(USERCARD_SELECTOR), 'new 7TV card is a tribute card');

  const ctx = contextFor('viewerone');
  processUserCard(card, ctx);
  await settle();

  assert.deepEqual(ctx.calls, ['viewerone'], 'alias text is not mistaken for the login');
  const row = card.querySelector('.seventv-usercard-badges');
  assert.equal(row.children.length, 3);
  assert.ok(row.lastElementChild.classList.contains('tcb-badge-list--usercard'));
  assert.equal(row.querySelectorAll('.tcb-badge-img').length, 2);
});

function nativeCardHtml({ withBadgeRow }) {
  return `
    <div class="viewer-card" data-a-target="viewer-card">
      <div class="viewer-card-header__display-name"><h4><a class="tw-link" href="/viewerone">ViewerOne</a></h4></div>
      <div class="viewer-card-drag-cancel">
        <div>
          ${withBadgeRow ? `<h5>Значки</h5>
          <div class="row">
            <div class="cell"><div><button><div><img></div></button></div></div>
          </div>` : ''}
        </div>
      </div>
      <div class="message-list">
        <div class="chat-line__message"><span class="tcb-badge-list"><img class="tcb-badge-img"></span></div>
      </div>
    </div>`;
}

test('native viewer card: ours become plain 24px cells at the end of the badge row, never buttons', async () => {
  const card = mount(nativeCardHtml({ withBadgeRow: true }));
  const ctx = contextFor('viewerone');
  processUserCard(card, ctx);
  await settle();

  const row = card.querySelector('.row');
  const cells = row.querySelectorAll('.tcb-card-badge');
  assert.equal(cells.length, 2);
  assert.ok(row.lastElementChild.classList.contains('tcb-card-badge'), 'ours are last');
  for (const cell of cells) {
    assert.equal(cell.querySelector('button'), null, 'no click target');
    const img = cell.querySelector('img.tcb-badge-img');
    assert.match(img.style.cssText, /width: 24px/);
  }
  assert.equal(card.querySelectorAll('.message-list .tcb-badge-list').length, 1, 'chat history copies are left alone');
});

test('native viewer card: the header name is never styled', async () => {
  const card = mount(`
    <div class="viewer-card" data-a-target="viewer-card">
      <div class="viewer-card-header__display-name">
        <div><div>
          <h4><a class="tw-link" href="/viewerone">ViewerOne</a><span><button></button></span></h4>
        </div></div>
        <div><p>Учетная запись создана 27 июля 2026 г.</p><p>Отслеживает с 27 июля 2026 г.</p></div>
      </div>
    </div>`);
  const ctx = { ...contextFor('viewerone'), getCachedUser: () => ({ name_css: 'color: rgb(255, 0, 0)' }) };
  processUserCard(card, ctx);
  await settle();

  assert.equal(card.querySelectorAll('[style]').length, 0);
  assert.equal(card.querySelectorAll('[data-tcb-name-style]').length, 0);
});

test('7TV card: the name is still styled', async () => {
  const card = mount(`
    <div class="seventv-user-card">
      <a class="seventv-user-card-usertag" href="https://twitch.tv/viewerone">
        <div class="seventv-chat-user"><span class="seventv-chat-user-username">viewerone</span></div>
      </a>
    </div>`);
  const ctx = { ...contextFor('viewerone'), getCachedUser: () => ({ name_css: 'color: rgb(255, 0, 0)' }) };
  processUserCard(card, ctx);
  await settle();

  assert.equal(card.querySelector('.seventv-chat-user-username').style.getPropertyValue('color'), 'rgb(255, 0, 0)');
});

test('native viewer card: no badge row yet → failed, re-processed once the row mounts', async () => {
  const card = mount(nativeCardHtml({ withBadgeRow: false }));
  const ctx = contextFor('viewerone');
  processUserCard(card, ctx);
  await settle();
  assert.equal(getBadgeRenderState(card), 'failed');

  card.querySelector('.viewer-card-drag-cancel > div').innerHTML = `
    <h5>Значки</h5>
    <div class="row"><div class="cell"><div><button><div><img></div></button></div></div></div>`;
  processUserCard(card, ctx);
  await settle();

  assert.equal(getBadgeRenderState(card), 'rendered');
  assert.equal(card.querySelectorAll('.row .tcb-card-badge').length, 2);
});

test('rendered card whose badges were wiped by a re-render gets them back', async () => {
  const card = mount(nativeCardHtml({ withBadgeRow: true }));
  const ctx = contextFor('viewerone');
  processUserCard(card, ctx);
  await settle();
  card.querySelectorAll('.tcb-card-badge').forEach((el) => el.remove());

  processUserCard(card, ctx);
  await settle();

  assert.equal(card.querySelectorAll('.tcb-card-badge').length, 2);
  assert.equal(ctx.calls.length, 2);
});

test('a rendered card is not re-rendered while its badges are still there', async () => {
  const card = mount(nativeCardHtml({ withBadgeRow: true }));
  const ctx = contextFor('viewerone');
  processUserCard(card, ctx);
  await settle();
  processUserCard(card, ctx);
  await settle();

  assert.equal(ctx.calls.length, 1);
  assert.equal(card.querySelectorAll('.tcb-card-badge').length, 2);
});

test('mod-view user details panel is not a badge card', () => {
  const panel = mount('<div class="user-details" data-a-target="mod-view-user-details"></div>');
  assert.equal(panel.matches(USERCARD_SELECTOR), false);
});
