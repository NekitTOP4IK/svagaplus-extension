const assert = require('node:assert/strict');
const test = require('node:test');

require('./helpers/build-globals').defineBuildGlobals();
const chrome = require('./helpers/extension-env').stubExtensionApis();

let storedSettings;
chrome.storage.local.get = async (key) => (
  storedSettings === undefined ? {} : { [key]: storedSettings }
);
chrome.storage.local.set = async (values) => {
  storedSettings = values.svagaplus_settings;
};

const {
  getExtensionSettings,
  setExtensionSettings,
} = require('../dist-types/shared/storage.js');

test('custom nickname setting defaults on and persists independently', async () => {
  assert.deepEqual(await getExtensionSettings(), {
    socialRatingEnabled: true,
    customNicknamesEnabled: true,
  });

  storedSettings = { socialRatingEnabled: false };
  assert.deepEqual(await getExtensionSettings(), {
    socialRatingEnabled: false,
    customNicknamesEnabled: true,
  });

  const saved = await setExtensionSettings({ customNicknamesEnabled: false });
  assert.deepEqual(saved, {
    socialRatingEnabled: false,
    customNicknamesEnabled: false,
  });
  assert.deepEqual(storedSettings, saved);
});
