import { getFeatureFlags } from '../platform/storage';
import { startSocialRatingContent } from '../social-rating/content/index';

getFeatureFlags()
  .then((flags) => {
    if (!flags.socialRating) return undefined;
    return startSocialRatingContent();
  })
  .catch(() => undefined);
