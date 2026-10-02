const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MAX_IMPORT_ALIASES,
  aliasExportFilename,
  formatAliasCount,
  parseAliasImport,
  toSortedAliasItems,
} = require('../dist-types/popup/alias-list.js');

test('export format round-trips through import', () => {
  const exported = JSON.stringify([{ login: 'beta', alias: 'Бета' }, { login: 'alpha', alias: 'Альфа' }]);
  const parsed = parseAliasImport(exported);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.items, [{ login: 'beta', alias: 'Бета' }, { login: 'alpha', alias: 'Альфа' }]);
  assert.equal(parsed.skipped, 0);
});

test('plain { login: alias } map is accepted and normalized', () => {
  const parsed = parseAliasImport(JSON.stringify({ '@Alpha': '  Альфа  ', beta: 'Бета' }));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.items, [{ login: 'alpha', alias: 'Альфа' }, { login: 'beta', alias: 'Бета' }]);
});

test('broken entries are skipped instead of rejecting the whole file', () => {
  const parsed = parseAliasImport(JSON.stringify([
    { login: 'alpha', alias: 'Альфа' },
    { login: 'x', alias: 'too short login' },
    { login: 'gamma', alias: '' },
    { login: 'delta', alias: 'д'.repeat(65) },
    null,
    { login: 'alpha', alias: 'Альфа 2' },
  ]));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.items, [{ login: 'alpha', alias: 'Альфа 2' }], 'last duplicate wins');
  assert.equal(parsed.skipped, 4);
});

test('unusable files get a readable error', () => {
  assert.equal(parseAliasImport('not json').ok, false);
  assert.equal(parseAliasImport('[]').ok, false);
  assert.equal(parseAliasImport(JSON.stringify([{ login: 'x', alias: '' }])).ok, false);

  const tooMany = Array.from({ length: MAX_IMPORT_ALIASES + 1 }, (_, i) => ({ login: `user_${i}`, alias: `A${i}` }));
  const parsed = parseAliasImport(JSON.stringify(tooMany));
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /1000/);
});

test('list is sorted by login and drops empty values', () => {
  assert.deepEqual(toSortedAliasItems({ zed: 'Z', alpha: 'A', empty: '' }), [
    { login: 'alpha', alias: 'A' },
    { login: 'zed', alias: 'Z' },
  ]);
  assert.deepEqual(toSortedAliasItems(undefined), []);
});

test('russian plural forms for the counter', () => {
  assert.equal(formatAliasCount(1), '1 алиас');
  assert.equal(formatAliasCount(3), '3 алиаса');
  assert.equal(formatAliasCount(5), '5 алиасов');
  assert.equal(formatAliasCount(11), '11 алиасов');
  assert.equal(formatAliasCount(21), '21 алиас');
  assert.equal(formatAliasCount(112), '112 алиасов');
});

test('export filename carries the date', () => {
  assert.equal(aliasExportFilename(new Date('2026-10-02T12:00:00Z')), 'svagaplus-aliases-2026-10-02.json');
});
