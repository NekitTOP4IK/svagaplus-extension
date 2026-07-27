const assert = require('assert');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<div id="host"><span id="badge">b</span></div>', { url: 'https://www.twitch.tv/t' });

global.window = dom.window;
global.document = dom.window.document;
global.location = dom.window.location;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;

// Ловим чтения, форсирующие синхронный layout после записи в стили.
const reads = [];
for (const prop of ['offsetWidth', 'offsetHeight']) {
  Object.defineProperty(dom.window.HTMLElement.prototype, prop, {
    configurable: true,
    get() { reads.push(prop); return 0; },
  });
}

const { showTooltip, tooltip } = require('../dist-types/features/tribute-badges/dom.js');

const badge = document.getElementById('badge');
badge.getBoundingClientRect = () => ({ left: 100, top: 200, width: 18, height: 18, right: 118, bottom: 218 });

showTooltip({ target: badge }, 'Подписчик');

assert.deepStrictEqual(
  reads,
  [],
  `showTooltip форсирует layout на каждый hover, читая: ${reads.join(', ')}`
);

// Позиционирование обязано остаться осмысленным: центр бейджа по горизонтали,
// подъём над ним по вертикали отдан transform'у.
assert.strictEqual(tooltip.style.left, '109px', `левый край: ${tooltip.style.left}`);
assert.strictEqual(tooltip.style.top, '193px', `верхний край: ${tooltip.style.top}`);
assert.ok(
  /translate\(-50%,\s*-100%\)/.test(tooltip.style.transform),
  `центрирование не отдано transform: ${tooltip.style.transform}`
);

console.log('perf-tooltip-no-reflow: PASS');
