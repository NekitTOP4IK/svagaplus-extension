const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const test = require('node:test');

const dom = new JSDOM('<body></body>', { url: 'https://www.twitch.tv/channel' });
global.window = dom.window;
global.document = dom.window.document;

const { renderNotice } = require('../dist-types/features/update-notice/render.js');

const update = {
  tone: 'update',
  version: '1.4.0',
  fromVersion: '1.3.0',
  text: 'Доступно обновление Свага+',
  action: { label: 'Обновить', url: 'https://x.test/z.zip' },
  link: { label: 'Что нового ↗', url: 'https://svaga.test/changelog' },
};
const success = {
  tone: 'success',
  version: '1.4.0',
  fromVersion: null,
  text: 'Свага+ обновлена',
  action: null,
  link: { label: 'Что нового ↗', url: 'https://svaga.test/changelog' },
};
const click = (node) => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

test('the compact plate carries version, text, the update button and a close button', () => {
  let dismissed = 0;
  const plate = renderNotice(update, 'compact', () => { dismissed += 1; });

  assert.ok(plate.classList.contains('svp-notice--update'));
  assert.ok(plate.classList.contains('svp-notice--compact'));
  assert.equal(plate.querySelector('.svp-notice__ver').textContent, 'v1.4.0');
  assert.equal(plate.querySelector('.svp-notice__text').textContent, 'Доступно обновление Свага+');
  const button = plate.querySelector('a.svp-notice__btn');
  assert.equal(button.textContent, 'Обновить');
  assert.equal(button.href, 'https://x.test/z.zip');
  assert.equal(button.target, '_blank');
  assert.equal(button.rel, 'noopener noreferrer');
  assert.equal(plate.querySelector('.svp-notice__link'), null, 'the chat plate keeps one action');

  click(button);
  assert.equal(dismissed, 0, 'opening the update link does not hide the notice');
  click(plate.querySelector('button.svp-notice__close'));
  assert.equal(dismissed, 1);
});

test('the expanded plate shows the version jump and both links', () => {
  const plate = renderNotice(update, 'expanded', () => undefined);

  assert.equal(plate.querySelector('.svp-notice__ver').textContent, 'v1.3.0 → v1.4.0');
  assert.equal(plate.querySelector('.svp-notice__title').textContent, 'Доступно обновление Свага+');
  assert.deepEqual([...plate.querySelectorAll('.svp-notice__actions a')].map((a) => a.textContent), ['Обновить', 'Что нового ↗']);
});

test('opening what is new after an update counts as seen', () => {
  let dismissed = 0;
  const plate = renderNotice(success, 'compact', () => { dismissed += 1; });

  const link = plate.querySelector('a.svp-notice__link');
  assert.equal(link.textContent, 'Что нового ↗');
  click(link);
  assert.equal(dismissed, 1);
});
