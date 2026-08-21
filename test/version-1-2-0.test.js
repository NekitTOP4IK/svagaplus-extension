const assert = require('node:assert/strict');
const test = require('node:test');

const packageJson = require('../package.json');
const packageLock = require('../package-lock.json');

test('extension package and lock are released as 1.2.0', () => {
  assert.equal(packageJson.version, '1.2.0');
  assert.equal(packageLock.version, '1.2.0');
  assert.equal(packageLock.packages[''].version, '1.2.0');
});
