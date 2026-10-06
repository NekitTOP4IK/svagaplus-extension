const assert = require('node:assert/strict');
const test = require('node:test');

const { getChannelLoginFromUrl } = require('../dist-types/shared/twitch.js');

test('reads the channel from regular, pop-out, moderator and stream manager URLs', () => {
  const cases = {
    'https://www.twitch.tv/Alpha': 'alpha',
    'https://www.twitch.tv/alpha/videos': 'alpha',
    'https://www.twitch.tv/popout/alpha/chat?popout=': 'alpha',
    'https://www.twitch.tv/moderator/alpha': 'alpha',
    'https://www.twitch.tv/popout/moderator/alpha/chat': 'alpha',
    'https://dashboard.twitch.tv/u/alpha/stream-manager': 'alpha',
    'https://dashboard.twitch.tv/popout/u/alpha/stream-manager/chat': 'alpha',
  };
  for (const [url, channel] of Object.entries(cases)) {
    assert.equal(getChannelLoginFromUrl(url), channel, url);
  }
});

test('finds no channel on service pages or other sites', () => {
  for (const url of [
    'https://www.twitch.tv/',
    'https://www.twitch.tv/directory',
    'https://www.twitch.tv/moderator',
    'https://dashboard.twitch.tv/',
    'https://dashboard.twitch.tv/u',
    'https://nottwitch.tv/alpha',
    'https://example.com/alpha',
    'not a url',
  ]) {
    assert.equal(getChannelLoginFromUrl(url), null, url);
  }
});
