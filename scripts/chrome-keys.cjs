'use strict';

// Chrome берёт ID расширения из manifest.key, а без него — из хеша пути к
// распакованной папке. От ID зависит redirect URI авторизации
// (https://<id>.chromiumapp.org/viewer-auth), а Twitch и бэкенд пускают только
// зарегистрированные URI. Поэтому распакованным сборкам нужен постоянный ID.
//
// Ключи публичные: секрета в них нет, приватная часть для распакованной
// установки не нужна.

const crypto = require('crypto');

const CHROME_KEYS = {
  // Публичный ключ из дашборда Chrome Web Store (Package → Public key).
  // С ним распакованный релиз с GitHub получает тот же ID, что и версия из стора.
  store: {
    id: 'olbjpkkkcabbnacfekfohmpadfffdfgm',
    key:
      'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyDzYg2vhOBK6rrOlZ7r/' +
      'wc7OdQW1QMIltBf4KY8OZLsbUm8PGgirO+2hLetPiK1yQkclSD4VxMQg7Gk2t+YK' +
      '3VA8J0XCvAtXxzjcSUQ59NRZMGJUALPSoU1kp4HA1uTtwLEqw8WoTruR9a0tE+hD' +
      'dqlHJ/e0rlBqV05j6Nok1XFQS3uiiUV/mI4L5qIDJLIo4VN9BpqZyleFm8CfddMi' +
      'L1wiH521feOFyOMoOjgyuxIrNdv6mMEwg1JR5aV45lQjVD/NzTolvOkHI3wCx7+8' +
      'q0d8uM19c1trX8bKaWJopVWLOrcPYEPX30vYUX5/Cbxqt3r6XdBWQ2Flyv++Uq0X' +
      'pQIDAQAB',
  },
  // Отдельная пара для staging и локальной разработки, чтобы тестовую сборку
  // можно было держать рядом с версией из стора.
  staging: {
    id: 'cfhgnfinjgfehpgpdmmcbppigdijjcmb',
    key:
      'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAlAU+5OcwSW07IKlsiOEP1hmNF9DraeuwJmUgAUvfLZakr1rlHoq3' +
      'FcyMTx5ObmUBcK/aTJsWxyPL61PIwHYHj3IEKAamZfUmk+EGxZSJBUCUlMxlqQazsqDS55FyCw5bh+TKCEG8uJ2S4qrRwzxc' +
      '+GprQ9PTv3w1wICFgxFQC7zl3Z+1a3SiZLpLbQoPSlWCjmp6+33gjalhkcbLvr37EYlxV85VAWYW/zsMZC29v1PLn2NyvdCN' +
      'V9k9OZ+kMj8JUlYPtJacuEFe5OPIrugNW3dEsKVrHrAjjgzUMwMySj9TuMLAgmuAfmA6Ha6v7odKy/sv7yc6F209J0acMOPA' +
      'zwIDAQAB',
  },
};

/** Тот же расчёт, что делает Chrome: sha256 ключа, 32 hex-символа, 0–f → a–p. */
function extensionIdFromKey(key) {
  const hex = crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex');
  return [...hex.slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

/** Бросает, если ключ не задан или опечатан и даст не тот ID. */
function assertKeyMatchesId(name) {
  const entry = CHROME_KEYS[name];
  if (!entry || !entry.key || !entry.id) {
    throw new Error(`Ключ Chrome "${name}" не задан в scripts/chrome-keys.cjs.`);
  }
  const actual = extensionIdFromKey(entry.key);
  if (actual !== entry.id) {
    throw new Error(`Ключ Chrome "${name}" даёт ID ${actual}, ожидался ${entry.id}.`);
  }
  return entry;
}

/** @param {string} manifestJson @param {string} key */
function withManifestKey(manifestJson, key) {
  return JSON.stringify({ ...JSON.parse(manifestJson), key }, null, 2) + '\n';
}

module.exports = { CHROME_KEYS, extensionIdFromKey, assertKeyMatchesId, withManifestKey };
