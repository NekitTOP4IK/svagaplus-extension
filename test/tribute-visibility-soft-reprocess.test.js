const assert = require('assert');
const { JSDOM } = require('jsdom');
const dom = new JSDOM(`<div class="chat-line__message" data-tcb-render-state="rendered"><img class="tcb-badge-img"></div>
<div class="chat-line__message" data-tcb-render-state="rendered"></div>
<div class="chat-line__message" data-tcb-render-state="empty"></div>
<div class="chat-line__message" data-tcb-render-state="failed"></div>`);
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;

const { isTributeMessageHealthy } = require('../dist-types/features/tribute-badges/render-state.js');

const [ok, stripped, empty, failed] = document.querySelectorAll('.chat-line__message');
assert.equal(isTributeMessageHealthy(ok), true);
assert.equal(isTributeMessageHealthy(stripped), false);
assert.equal(isTributeMessageHealthy(empty), true);
assert.equal(isTributeMessageHealthy(failed), false);
console.log('tribute-visibility-soft-reprocess: PASS');
