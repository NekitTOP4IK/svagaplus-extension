const assert = require('assert');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<div id="chat"></div>', { url: 'https://www.twitch.tv/testchannel' });

global.window = dom.window;
global.document = dom.window.document;
global.location = dom.window.location;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
require('./helpers/build-globals').defineBuildGlobals();
require('./helpers/extension-env').stubExtensionApis();

const chatBadges = require('../dist-types/features/social-rating/chat-badges.js');

// Один чанк — 32 сообщения.
const chat = document.getElementById('chat');
for (let i = 0; i < 32; i++) {
  const msg = document.createElement('div');
  msg.className = 'chat-line__message';
  msg.innerHTML =
    '<span class="chat-line__message--badges"></span>' +
    `<span class="chat-author__display-name" data-a-user="viewer${i}">viewer${i}</span>`;
  chat.appendChild(msg);
}

// Считаем, сколько разрешений грантов выполняется одновременно.
// Именно это определяет, успеет ли 80-мс окно батчинга в background
// собрать больше одного логина.
let inFlight = 0;
let maxConcurrent = 0;
let calls = 0;
chatBadges.__testOnlySetGrantsFor(async () => {
  calls++;
  inFlight++;
  maxConcurrent = Math.max(maxConcurrent, inFlight);
  await new Promise((resolve) => setTimeout(resolve, 5));
  inFlight--;
  return [];
});

(async () => {
  await chatBadges.refreshVisibleChatBadges('testchannel');

  assert.ok(calls > 0, 'разрешение грантов не вызывалось — разметка сообщения не подошла, тест недействителен');

  assert.ok(
    maxConcurrent > 1,
    `внутри чанка одновременно выполнялось максимум ${maxConcurrent} разрешений из ${calls}. ` +
    `Последовательный await сводит на нет 80-мс окно батчинга: каждый запрос уходит в одиночку.`
  );

  console.log('perf-chat-badges-parallel: PASS');
})();
