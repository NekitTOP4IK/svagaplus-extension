const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const test = require('node:test');

const dom = new JSDOM('<body></body>', { url: 'https://www.twitch.tv/channel' });
global.window = dom.window;
global.document = dom.window.document;

const { iconSvg } = require('../dist-types/features/banners/icons.js');
const { renderBanner, renderConnectionLost } = require('../dist-types/features/banners/render.js');

const FRONTEND = 'https://svaga.test';
const NOW = Date.parse('2026-10-20T10:00:00Z');
const click = (node) => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

const maintenance = (startsAt, endsAt, extra = {}) => ({
  startsAt,
  endsAt,
  affected: ['obs_alerts', 'extension'],
  affectedExtra: null,
  ...extra,
});

const banner = (extra = {}) => ({
  id: 1,
  type: 'info',
  title: null,
  message: 'Что-то новое',
  dismissible: true,
  targets: ['chat', 'popup'],
  maintenance: null,
  ...extra,
});

const upcoming = (extra = {}) =>
  banner({
    type: 'maintenance',
    title: 'Обновляем сервер',
    message: 'Будет недолго',
    maintenance: maintenance(NOW + 3600_000, NOW + 7200_000),
    ...extra,
  });

test('a compact upcoming maintenance plate has the prefix, a mono time and a close button', () => {
  const plate = renderBanner(upcoming(), 'compact', NOW, FRONTEND, () => {});

  assert.ok(plate.classList.contains('svp-notice'));
  assert.ok(plate.classList.contains('svp-notice--maintenance'));
  assert.ok(plate.classList.contains('svp-notice--compact'));
  assert.ok(plate.classList.contains('svp-notice--wrap'));
  assert.equal(plate.querySelector('.svp-notice__text').textContent, 'Техработы — Обновляем сервер Будет недолго');
  assert.equal(plate.querySelector('.svp-notice__lead').textContent, 'Обновляем сервер');
  assert.ok(plate.querySelector('.svp-notice__ver').textContent.length > 0);
  assert.ok(plate.querySelector('button[aria-label="Скрыть"]'));
});

test('a compact maintenance plate falls back to the message when there is no title', () => {
  const plate = renderBanner(upcoming({ title: null }), 'compact', NOW, FRONTEND, () => {});
  assert.equal(plate.querySelector('.svp-notice__text').textContent, 'Техработы — Будет недолго');
});

test('a live maintenance plate has no close button', () => {
  const live = upcoming({ maintenance: maintenance(NOW - 1000, NOW + 3600_000) });
  const plate = renderBanner(live, 'compact', NOW, FRONTEND, () => {});
  assert.equal(plate.querySelector('button[aria-label="Скрыть"]'), null);
  assert.ok(plate.querySelector('.svp-notice__ver').textContent.startsWith('до '));
});

test('a non-dismissible banner has no close button', () => {
  const plate = renderBanner(banner({ dismissible: false }), 'compact', NOW, FRONTEND, () => {});
  assert.equal(plate.querySelector('button[aria-label="Скрыть"]'), null);
});

test('clicking the close button calls onDismiss', () => {
  let dismissed = 0;
  const plate = renderBanner(banner(), 'compact', NOW, FRONTEND, () => { dismissed += 1; });
  click(plate.querySelector('button[aria-label="Скрыть"]'));
  assert.equal(dismissed, 1);
});

test('a compact ordinary banner shows the message, with the title ahead of it, and no mono time', () => {
  const titled = renderBanner(banner({ title: 'Заголовок' }), 'compact', NOW, FRONTEND, () => {});
  assert.equal(titled.querySelector('.svp-notice__text').textContent, 'Заголовок Что-то новое');
  assert.equal(titled.querySelector('.svp-notice__lead').textContent, 'Заголовок');
  assert.equal(titled.querySelector('.svp-notice__ver'), null);

  const plain = renderBanner(banner(), 'compact', NOW, FRONTEND, () => {});
  assert.equal(plain.querySelector('.svp-notice__text').textContent, 'Что-то новое');
  assert.equal(plain.querySelector('.svp-notice__lead'), null);
});

test('a compact plate renders bold markdown in the message', () => {
  const plate = renderBanner(banner({ message: 'Включите **свагометр**' }), 'compact', NOW, FRONTEND, () => {});
  assert.equal(plate.querySelector('.svp-notice__text b').textContent, 'свагометр');
  assert.equal(plate.querySelector('.svp-notice__text').textContent, 'Включите свагометр');
});

test('a compact plate links a relative target to the frontend', () => {
  const plate = renderBanner(banner({ message: 'Откройте [настройки](/settings)' }), 'compact', NOW, FRONTEND, () => {});
  const link = plate.querySelector('.svp-notice__text a');
  assert.equal(link.textContent, 'настройки');
  assert.equal(link.getAttribute('href'), 'https://svaga.test/settings');
});

test('a compact plate keeps a javascript: link as text', () => {
  const plate = renderBanner(banner({ message: 'Тут [x](javascript:alert(1))' }), 'compact', NOW, FRONTEND, () => {});
  assert.equal(plate.querySelector('a'), null);
  assert.equal(plate.querySelector('.svp-notice__text').textContent, 'Тут [x](javascript:alert(1))');
});

test('the compact icon is labelled with the banner type name', () => {
  const plate = renderBanner(banner({ type: 'warning' }), 'compact', NOW, FRONTEND, () => {});
  const icon = plate.querySelector('svg[role="img"]');
  assert.ok(icon);
  assert.ok(icon.getAttribute('aria-label').length > 0);
  assert.ok(plate.classList.contains('svp-notice--warning'));
});

test('an expanded announcement renders markdown from the message', () => {
  const plate = renderBanner(
    banner({ type: 'announcement', title: 'Новости', message: 'Это **важно**' }),
    'expanded',
    NOW,
    FRONTEND,
    () => {},
  );

  assert.ok(plate.classList.contains('svp-notice--expanded'));
  assert.equal(plate.querySelector('.svp-notice__title').textContent, 'Новости');
  assert.equal(plate.querySelector('b').textContent, 'важно');
  assert.equal(plate.querySelector('.svp-notice__chips'), null);
});

test('an expanded maintenance plate has the header, the range, chips and a status link', () => {
  const m = maintenance(NOW + 3600_000, NOW + 7200_000, { affectedExtra: 'Почта' });
  const plate = renderBanner(upcoming({ maintenance: m }), 'expanded', NOW, FRONTEND, () => {});

  const head = plate.querySelector('.svp-notice__top').textContent;
  assert.ok(head.includes('Техработы'));
  assert.ok(plate.querySelector('.svp-notice__ver').textContent.includes('–'));
  assert.deepEqual(
    [...plate.querySelectorAll('.svp-notice__chip')].map((chip) => chip.textContent),
    ['Алерты в OBS', 'Расширение', 'Почта'],
  );
  const link = plate.querySelector('a.svp-notice__link');
  assert.equal(link.textContent, 'Статус сервиса ↗');
  assert.equal(link.href, 'https://status.svagaplus.com/');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.ok(plate.querySelector('button[aria-label="Скрыть"]'));
});

test('known affected keys map to their chip labels', () => {
  const m = maintenance(NOW + 1000, NOW + 2000, {
    affected: ['obs_alerts', 'chat_badges', 'dashboard', 'tribute_webhooks', 'extension'],
  });
  const plate = renderBanner(upcoming({ maintenance: m }), 'expanded', NOW, FRONTEND, () => {});
  assert.deepEqual(
    [...plate.querySelectorAll('.svp-notice__chip')].map((chip) => chip.textContent),
    ['Алерты в OBS', 'Бейджи в чате', 'Дашборд', 'Вебхуки Tribute', 'Расширение'],
  );
});

test('server markdown cannot inject elements into the plate', () => {
  const plate = renderBanner(
    banner({ message: '<img src=x onerror=alert(1)> [x](javascript:alert(1))' }),
    'expanded',
    NOW,
    FRONTEND,
    () => {},
  );
  assert.equal(plate.querySelector('img'), null);
  assert.equal(plate.querySelector('a[href^="javascript"]'), null);
});

test('iconSvg labels or hides the icon and draws a single path', () => {
  const labelled = iconSvg('danger', 'Важное');
  assert.equal(labelled.getAttribute('role'), 'img');
  assert.equal(labelled.getAttribute('aria-label'), 'Важное');
  assert.equal(labelled.getAttribute('aria-hidden'), null);
  assert.equal(labelled.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(labelled.querySelectorAll('path').length, 1);

  const hidden = iconSvg('offline', null);
  assert.equal(hidden.getAttribute('aria-hidden'), 'true');
  assert.equal(hidden.getAttribute('role'), null);
  assert.equal(hidden.getAttribute('aria-label'), null);
});

test('the connection plate has two lines and a status link', () => {
  let dismissed = 0;
  const plate = renderConnectionLost(12, () => { dismissed += 1; });

  assert.ok(plate.classList.contains('svp-notice--offline'));
  assert.ok(plate.classList.contains('svp-notice--multiline'));
  assert.ok(plate.textContent.includes('Потеряно соединение с сервером.'));
  assert.ok(plate.textContent.includes('Повтор через 12 с…'));
  const link = plate.querySelector('a');
  assert.equal(link.href, 'https://status.svagaplus.com/');
  assert.equal(link.textContent, 'Статус ↗');
  assert.equal(link.target, '_blank');
  click(plate.querySelector('button[aria-label="Скрыть"]'));
  assert.equal(dismissed, 1);
});

test('the connection plate says it is reconnecting while there is no countdown', () => {
  const plate = renderConnectionLost(null, () => {});
  assert.ok(plate.textContent.includes('Потеряно соединение с сервером.'));
  assert.ok(plate.querySelector('.svp-notice__muted').textContent === 'Подключение…');
  assert.ok(!plate.textContent.includes('Повтор'));
  assert.equal(plate.querySelector('a').href, 'https://status.svagaplus.com/');
});
