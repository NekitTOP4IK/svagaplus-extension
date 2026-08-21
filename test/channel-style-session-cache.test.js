const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ChannelStyleCache } = require('../dist-types/features/tribute-badges/channel-style-cache.js');

test('keeps normalized viewer styles isolated by channel and treats null styles as absent', () => {
  const cache = new ChannelStyleCache();

  cache.replaceViewer(' Alpha ', ' Alice ', { name_color: '#111111' });
  cache.replaceViewer('BETA', 'ALICE', { name_color: '#222222' });

  assert.equal(cache.usersFor('alpha').alice.name_color, '#111111');
  assert.equal(cache.usersFor(' beta ').alice.name_color, '#222222');

  cache.replaceViewer('ALPHA', 'alice', {
    name_color: null,
    name_gradient: null,
    name_css: null,
    name_preset_name: null,
    font_preset_id: null,
  });

  assert.deepEqual(cache.usersFor('alpha').alice, {});
  assert.equal(cache.usersFor('beta').alice.name_color, '#222222');
});

test('keeps font presets isolated by channel and returns fresh snapshots', () => {
  const cache = new ChannelStyleCache();

  cache.assignFontPresets(' Alpha ', {
    headline: { font_family: 'Alpha Sans' },
  });
  cache.assignFontPresets('BETA', {
    headline: { font_family: 'Beta Sans' },
  });

  const usersSnapshot = cache.usersFor('alpha');
  usersSnapshot.intruder = { name_color: '#ffffff' };
  const fontsSnapshot = cache.fontPresetsFor('alpha');
  fontsSnapshot.intruder = { font_family: 'Injected Sans' };

  assert.deepEqual(cache.usersFor('alpha'), {});
  assert.deepEqual(cache.fontPresetsFor('alpha'), {
    headline: { font_family: 'Alpha Sans' },
  });
  assert.deepEqual(cache.fontPresetsFor('beta'), {
    headline: { font_family: 'Beta Sans' },
  });
  assert.deepEqual(cache.usersFor(null), {});
  assert.deepEqual(cache.fontPresetsFor(null), {});
});

test('does not expose cached viewer config objects through usersFor', () => {
  const cache = new ChannelStyleCache();
  cache.replaceViewer('alpha', 'alice', { name_color: '#111111' });

  cache.usersFor('alpha').alice.name_color = '#ffffff';

  assert.equal(cache.usersFor('alpha').alice.name_color, '#111111');
});

test('does not expose cached font preset objects through fontPresetsFor', () => {
  const cache = new ChannelStyleCache();
  cache.assignFontPresets('alpha', {
    headline: { font_family: 'Alpha Sans' },
  });

  cache.fontPresetsFor('alpha').headline.font_family = 'Injected Sans';

  assert.equal(cache.fontPresetsFor('alpha').headline.font_family, 'Alpha Sans');
});

test('does not retain caller-owned font preset objects on assignment', () => {
  const cache = new ChannelStyleCache();
  const headline = { font_family: 'Alpha Sans' };
  cache.assignFontPresets('alpha', { headline });

  headline.font_family = 'Mutated Sans';

  assert.equal(cache.fontPresetsFor('alpha').headline.font_family, 'Alpha Sans');
});

test('clears one channel without clearing others, then clears a viewer everywhere', () => {
  const cache = new ChannelStyleCache();

  cache.replaceViewer('alpha', 'alice', { name_color: '#111111' });
  cache.replaceViewer('beta', 'alice', { name_color: '#222222' });
  cache.replaceViewer('beta', 'bob', { name_color: '#333333' });
  cache.assignFontPresets('alpha', { alpha: { font_family: 'Alpha Sans' } });
  cache.assignFontPresets('beta', { beta: { font_family: 'Beta Sans' } });

  cache.clearChannel(' ALPHA ');

  assert.deepEqual(cache.usersFor('alpha'), {});
  assert.deepEqual(cache.fontPresetsFor('alpha'), {});
  assert.equal(cache.usersFor('beta').alice.name_color, '#222222');
  assert.equal(cache.fontPresetsFor('beta').beta.font_family, 'Beta Sans');

  cache.clearViewerEverywhere(' ALICE ');

  assert.deepEqual(cache.usersFor('beta'), {
    bob: { name_color: '#333333' },
  });
  assert.equal(cache.fontPresetsFor('beta').beta.font_family, 'Beta Sans');
});
