const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const test = require('node:test');

const dom = new JSDOM('<body></body>', { url: 'https://www.twitch.tv/channel' });
global.window = dom.window;
global.document = dom.window.document;

const { renderMarkdown } = require('../dist-types/features/banners/markdown.js');

const FRONTEND = 'https://svaga.test';
const render = (text, frontend = FRONTEND) => {
  const host = document.createElement('div');
  host.appendChild(renderMarkdown(text, frontend));
  return host;
};

test('bold becomes a single b element', () => {
  const host = render('**a**');
  const bolds = host.querySelectorAll('b');
  assert.equal(bolds.length, 1);
  assert.equal(bolds[0].textContent, 'a');
  assert.equal(host.textContent, 'a');
});

test('italic becomes a single i element', () => {
  const host = render('x *a* y');
  const italics = host.querySelectorAll('i');
  assert.equal(italics.length, 1);
  assert.equal(italics[0].textContent, 'a');
  assert.equal(host.textContent, 'x a y');
});

test('bold and italic can sit side by side', () => {
  const host = render('**a** and *b*');
  assert.equal(host.querySelector('b').textContent, 'a');
  assert.equal(host.querySelector('i').textContent, 'b');
  assert.equal(host.textContent, 'a and b');
});

test('an https link opens in a new tab without opener', () => {
  const host = render('[x](https://s.test/a)');
  const link = host.querySelector('a');
  assert.equal(link.getAttribute('href'), 'https://s.test/a');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(link.textContent, 'x');
});

test('a relative link resolves against the frontend url', () => {
  assert.equal(render('[x](/rules)').querySelector('a').getAttribute('href'), 'https://svaga.test/rules');
  assert.equal(render('[x](/rules)', 'https://svaga.test/').querySelector('a').getAttribute('href'), 'https://svaga.test/rules');
});

test('unsafe or insecure link targets stay as literal text', () => {
  for (const source of [
    '[x](javascript:alert(1))',
    '[x](http://s.test)',
    '[x](//evil.test/a)',
    '[x](data:text/html,hi)',
    '[x](rules)',
    '[x]()',
  ]) {
    const host = render(source);
    assert.equal(host.querySelector('a'), null, source);
    assert.equal(host.textContent, source, source);
  }
});

test('html in the source is text, never an element', () => {
  const source = '<script>alert(1)</script><img src=x onerror=alert(1)>';
  const host = render(source);
  assert.equal(host.querySelector('script'), null);
  assert.equal(host.querySelector('img'), null);
  assert.equal(host.childElementCount, 0);
  assert.equal(host.textContent, source);
});

test('html inside emphasis and link text stays text', () => {
  const host = render('**<img src=x>** [<b>x</b>](https://s.test)');
  assert.equal(host.querySelector('img'), null);
  assert.equal(host.querySelectorAll('b').length, 1);
  assert.equal(host.querySelector('a').textContent, '<b>x</b>');
});

test('a newline becomes one br', () => {
  const host = render('a\nb');
  assert.equal(host.querySelectorAll('br').length, 1);
  assert.equal(host.textContent, 'ab');
});

test('unclosed or unmatched markers render literally', () => {
  for (const source of ['**a', '*a', '[x](', '[x](https://s.test', '[x', 'a ** b', '**', '****', '**a*', '[x]', 'a * b']) {
    const host = render(source);
    assert.equal(host.textContent, source, source);
    assert.equal(host.querySelector('b, i, a'), null, source);
  }
});

test('plain text and the empty string pass through', () => {
  assert.equal(render('hello').textContent, 'hello');
  assert.equal(render('').childNodes.length, 0);
});
