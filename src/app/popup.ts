import { getFeatureFlags, setFeatureFlags } from '../platform/storage';

function mountSocialRatingToggle(): void {
  const host = document.querySelector('.container') || document.body;
  if (!host || document.getElementById('svagaplus-social-rating-toggle')) return;

  const row = document.createElement('label');
  row.id = 'svagaplus-social-rating-toggle';
  row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin:12px 0;padding:10px 12px;border:1px solid rgba(255,255,255,.12);border-radius:8px;font:13px system-ui;color:#efeff1;';
  row.innerHTML = '<span>Social Rating</span><input type="checkbox" aria-label="Social Rating">';
  host.prepend(row);

  const input = row.querySelector('input');
  if (!input) return;

  getFeatureFlags().then((flags) => {
    input.checked = flags.socialRating;
  }).catch(() => undefined);

  input.addEventListener('change', () => {
    setFeatureFlags({ socialRating: input.checked }).catch(() => undefined);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountSocialRatingToggle, { once: true });
} else {
  mountSocialRatingToggle();
}
