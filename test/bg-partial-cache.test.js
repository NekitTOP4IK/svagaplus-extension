const assert = require('assert');
require('./helpers/build-globals').defineBuildGlobals();
require('./helpers/extension-env').stubExtensionApis();

const bg = require('../dist-types/app/background.js');

// Закэширован ровно один зритель из трёх запрашиваемых.
bg.__seedChannelViewer('testchannel', 'alice', { badge_ids: [] });

const partial = bg.__getCachedChannelBadges('testchannel', ['alice', 'bob', 'carol']);
assert.strictEqual(
  partial,
  null,
  'частичный кэш выдан как полный: закэширован 1 логин из 3. Вызывающий ' +
  'коротко замкнётся на этом ответе, и остальные два останутся без бейджей ' +
  'на весь 10-минутный TTL'
);

// Полный набор по-прежнему обязан отдаваться из кэша — иначе правка
// превратит кэш в бесполезный.
bg.__seedChannelViewer('testchannel', 'bob', { badge_ids: [] });
bg.__seedChannelViewer('testchannel', 'carol', { badge_ids: [] });

const full = bg.__getCachedChannelBadges('testchannel', ['alice', 'bob', 'carol']);
assert.ok(full, 'полный кэш перестал отдаваться');
assert.strictEqual(
  Object.keys(full.viewers).length,
  3,
  `в полном ответе ${Object.keys(full.viewers).length} зрителей вместо 3`
);

// Пустой кэш — по-прежнему промах.
assert.strictEqual(
  bg.__getCachedChannelBadges('otherchannel', ['dave']),
  null,
  'пустой кэш перестал считаться промахом'
);

console.log('bg-partial-cache: PASS');
