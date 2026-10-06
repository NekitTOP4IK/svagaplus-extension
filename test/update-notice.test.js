const assert = require('node:assert/strict');
const test = require('node:test');

const {
  compareVersions,
  pickRelease,
  deriveNotice,
  dismissNotice,
  parseUpdateState,
  EMPTY_UPDATE_STATE,
} = require('../dist-types/features/update-notice/model.js');

const SITE = 'https://svaga.test';
const BACKEND = 'https://api.svaga.test';
const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const info = {
  zip_version: '1.4.0',
  store_version: '1.3.5',
  download_url: '/cdn/shared/extension/svaga-1.4.0.zip',
  store_url_new: 'https://chromewebstore.google.com/detail/svaga',
  firefox_version: '1.4.1',
  firefox_download_url: 'https://cdn.svaga.test/svaga-1.4.1.xpi',
  firefox_store_version: null,
  firefox_store_url: null,
  min_version: '1.2.0',
};

const state = (patch) => ({ ...EMPTY_UPDATE_STATE, ...patch });

test('versions compare numerically part by part', () => {
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.equal(compareVersions('1.2.0', '1.2.1'), -1);
  assert.equal(compareVersions('2', '10'), -1);
});

test('a zip install follows the zip build and gets an absolute link', () => {
  assert.deepEqual(pickRelease(info, { firefox: false, storeInstall: false }, BACKEND), {
    version: '1.4.0',
    minVersion: '1.2.0',
    url: 'https://api.svaga.test/cdn/shared/extension/svaga-1.4.0.zip',
  });
});

test('a Web Store install follows the store version and link', () => {
  assert.deepEqual(pickRelease(info, { firefox: false, storeInstall: true }, BACKEND), {
    version: '1.3.5',
    minVersion: '1.2.0',
    url: 'https://chromewebstore.google.com/detail/svaga',
  });
});

test('Firefox takes the newest of its builds', () => {
  const release = pickRelease({ ...info, firefox_store_version: '1.5.0', firefox_store_url: 'https://addons.mozilla.org/svaga' }, { firefox: true, storeInstall: false }, BACKEND);
  assert.equal(release.version, '1.5.0');
  assert.equal(release.url, 'https://addons.mozilla.org/svaga');
});

test('a newer release shows the red update notice', () => {
  const notice = deriveNotice(state({ release: { version: '1.4.0', minVersion: null, url: 'https://x.test/z.zip' } }), '1.3.0', NOW, SITE);
  assert.deepEqual(notice, {
    tone: 'update',
    version: '1.4.0',
    fromVersion: '1.3.0',
    text: 'Доступно обновление Свага+',
    action: { label: 'Обновить', url: 'https://x.test/z.zip' },
    link: { label: 'Что нового ↗', url: 'https://svaga.test/changelog' },
  });
});

test('without a build link the update points to the download page', () => {
  const notice = deriveNotice(state({ release: { version: '1.4.0', minVersion: null, url: null } }), '1.3.0', NOW, SITE);
  assert.equal(notice.action.url, 'https://svaga.test/extension/download');
});

test('the same or an older release shows nothing', () => {
  assert.equal(deriveNotice(state({ release: { version: '1.3.0', minVersion: null, url: null } }), '1.3.0', NOW, SITE), null);
  assert.equal(deriveNotice(state({ release: { version: '1.2.0', minVersion: null, url: null } }), '1.3.0', NOW, SITE), null);
});

test('a version below the minimum gets the yellow warning first', () => {
  const notice = deriveNotice(state({ release: { version: '1.4.0', minVersion: '1.2.0', url: null } }), '1.1.0', NOW, SITE);
  assert.equal(notice.tone, 'warning');
  assert.equal(notice.version, '1.1.0');
  assert.equal(notice.text, 'Версия больше не поддерживается');
  assert.equal(notice.action.label, 'Обновить');
});

test('a dismissed update stays hidden until the next release', () => {
  let current = state({ release: { version: '1.4.0', minVersion: null, url: null } });
  current = dismissNotice(current, deriveNotice(current, '1.3.0', NOW, SITE), NOW);
  assert.equal(deriveNotice(current, '1.3.0', NOW + 30 * DAY, SITE), null);

  current = { ...current, release: { version: '1.5.0', minVersion: null, url: null } };
  assert.equal(deriveNotice(current, '1.3.0', NOW, SITE).version, '1.5.0');
});

test('a dismissed warning comes back after a day', () => {
  let current = state({ release: { version: '1.4.0', minVersion: '1.2.0', url: null } });
  current = dismissNotice(current, deriveNotice(current, '1.1.0', NOW, SITE), NOW);
  const hidden = deriveNotice(current, '1.1.0', NOW + DAY - 1, SITE);
  assert.notEqual(hidden && hidden.tone, 'warning');
  assert.equal(deriveNotice(current, '1.1.0', NOW + DAY, SITE).tone, 'warning');
});

test('after an update the green notice shows once', () => {
  let current = state({ updatedTo: { version: '1.4.0', at: NOW } });
  const notice = deriveNotice(current, '1.4.0', NOW, SITE);
  assert.equal(notice.tone, 'success');
  assert.equal(notice.text, 'Свага+ обновлена');
  assert.equal(notice.action, null);
  assert.deepEqual(notice.link, { label: 'Что нового ↗', url: 'https://svaga.test/changelog' });

  current = dismissNotice(current, notice, NOW);
  assert.equal(deriveNotice(current, '1.4.0', NOW, SITE), null);
  assert.equal(deriveNotice(state({ updatedTo: { version: '1.4.0', at: NOW } }), '1.4.0', NOW + 4 * DAY, SITE), null);
});

test('stored state is validated field by field', () => {
  assert.deepEqual(parseUpdateState(null), EMPTY_UPDATE_STATE);
  assert.deepEqual(parseUpdateState({ release: { version: 5 }, checkedAt: 'x', dismissed: { update: { version: '1.4.0', at: 1 }, warning: 'bad' } }), {
    ...EMPTY_UPDATE_STATE,
    release: { version: null, minVersion: null, url: null },
    dismissed: { update: { version: '1.4.0', at: 1 } },
  });
});
