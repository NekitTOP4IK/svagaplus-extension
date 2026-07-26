const assert = require('assert');
require('./helpers/build-globals').defineBuildGlobals();
require('./helpers/extension-env').stubExtensionApis();

const bg = require('../dist-types/app/background.js');

// Бэкенд возвращает только тех, у кого есть бейджи. Чаттеров без подписки
// в ответе нет вообще — и это нормальный, самый частый случай.
global.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    data: {
      badges: { b1: { id: 'b1', image_url: 'https://example.test/1.png' } },
      font_presets: {},
      viewers: { alice: { badge_ids: ['b1'] } },
    },
  }),
});

(async () => {
  const res = await bg.__fetchChannelBadges('testchannel', ['alice', 'bob', 'carol']);

  assert.strictEqual(
    res.ok,
    true,
    'ответ ok:false, хотя бэкенд ответил успешно и вернул данные по alice. ' +
    'Content-скрипт трактует это как сбой запроса, пишет негативный кэш всему ' +
    'чанку и защёлкивает сообщения в состояние empty — навсегда, потому что ' +
    'shouldSkipBadgeRender больше их не переобрабатывает.'
  );

  assert.ok(
    res.viewers.alice,
    'данные по alice потеряны, хотя бэкенд их вернул'
  );

  console.log('bg-partial-response: PASS');
})();
