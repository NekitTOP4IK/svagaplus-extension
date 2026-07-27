const assert = require('assert');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<div id="host"></div>', { url: 'https://www.twitch.tv/testchannel' });

global.window = dom.window;
global.document = dom.window.document;
global.location = dom.window.location;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;

// Считаем слушатели, повешенные на сами <img>. Делегированные уходят
// на document и сюда не попадают — это и есть проверяемая разница.
let perImageListeners = 0;
const originalAdd = dom.window.HTMLImageElement.prototype.addEventListener;
dom.window.HTMLImageElement.prototype.addEventListener = function (...args) {
  perImageListeners++;
  return originalAdd.apply(this, args);
};

const { createBadgeImg, showTooltip, tooltip } = require('../dist-types/features/tribute-badges/dom.js');

for (let i = 0; i < 50; i++) {
  createBadgeImg({ image_url: 'https://example.test/b.png', title: 'Badge ' + i });
}

assert.strictEqual(
  perImageListeners,
  0,
  `на 50 бейджей повешено ${perImageListeners} слушателей вместо делегирования на document`
);

// Заголовок обязан остаться доступен делегированному обработчику.
const img = createBadgeImg({ image_url: 'https://example.test/b.png', title: 'Подписчик' });
assert.strictEqual(img.dataset.tcbTitle, 'Подписчик', 'заголовок бейджа потерян при переходе на делегирование');

// Делегирование должно реально показывать тултип.
document.getElementById('host').appendChild(img);
img.getBoundingClientRect = () => ({ left: 100, top: 200, width: 18, height: 18, right: 118, bottom: 218 });
img.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }));
assert.strictEqual(tooltip.textContent, 'Подписчик', 'делегированный обработчик не показал тултип');

console.log('perf-badge-listeners: PASS');
