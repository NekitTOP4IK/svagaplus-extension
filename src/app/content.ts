import browser from '../shared/browser';
import { getExtensionSettings } from '../shared/storage';
import { startTributeBadgesContent } from '../features/tribute-badges';
import { startSocialRatingContent } from '../features/social-rating';

let socialRatingStarted = false;

function maybeStartSocialRating(enabled: boolean): void {
  if (!enabled || socialRatingStarted) return;
  socialRatingStarted = true;
  try {
    startSocialRatingContent();
  } catch {
    socialRatingStarted = false;
  }
}

startTributeBadgesContent();

getExtensionSettings()
  .then((settings) => {
    maybeStartSocialRating(settings.socialRatingEnabled);
  })
  .catch(() => undefined);

browser.runtime.onMessage.addListener((message: unknown) => {
  if (!message || typeof message !== 'object') return undefined;
  if ((message as { type?: string }).type !== 'settings:changed') return undefined;
  const settings = (message as { settings?: { socialRatingEnabled?: boolean } }).settings;
  if (settings?.socialRatingEnabled) maybeStartSocialRating(true);
  return undefined;
});
