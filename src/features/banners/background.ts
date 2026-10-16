import browser from '../../shared/browser';
import { BACKEND_URL } from '../../shared/config';
import { getBannerState } from '../../shared/storage';
import { applySnapshot } from './stream';

const CHECK_ALARM = 'svagaplus-banners-check';
const CHECK_PERIOD_MINUTES = 30;

async function checkBanners(): Promise<void> {
  const { snapshot } = await getBannerState();
  const headers: Record<string, string> = snapshot ? { 'If-None-Match': `"${snapshot.revision}"` } : {};
  const response = await fetch(`${BACKEND_URL}/api/extension/banners`, { cache: 'no-store', headers });
  if (!response.ok) return;
  await applySnapshot(await response.json());
}

async function ensureAlarm(): Promise<void> {
  if (!await browser.alarms.get(CHECK_ALARM)) {
    await browser.alarms.create(CHECK_ALARM, { periodInMinutes: CHECK_PERIOD_MINUTES });
  }
}

/** Registers listeners synchronously, as MV3 requires for a waking worker. */
export function startBannerChecks(): void {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CHECK_ALARM) checkBanners().catch(() => undefined);
  });
  browser.runtime.onStartup.addListener(() => {
    ensureAlarm().then(checkBanners).catch(() => undefined);
  });
  browser.runtime.onInstalled.addListener(() => {
    browser.alarms
      .create(CHECK_ALARM, { periodInMinutes: CHECK_PERIOD_MINUTES })
      .then(checkBanners)
      .catch(() => undefined);
  });
}
