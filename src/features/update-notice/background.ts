import browser from '../../shared/browser';
import { BACKEND_URL } from '../../shared/config';
import { getUpdateState, setUpdateState } from '../../shared/storage';
import { pickRelease, type InstallTarget } from './model';

const CHECK_ALARM = 'svagaplus-update-check';
const CHECK_PERIOD_MINUTES = 6 * 60;

function installTarget(): InstallTarget {
  const manifest = browser.runtime.getManifest() as { browser_specific_settings?: unknown; update_url?: string };
  const firefox = manifest.browser_specific_settings !== undefined;
  // The Web Store writes its own update_url into the manifest; zip installs have none.
  const storeInstall = !firefox && typeof manifest.update_url === 'string' && manifest.update_url.includes('google');
  return { firefox, storeInstall };
}

async function checkForUpdate(): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/extension/info`, { cache: 'no-store' });
  if (!response.ok) return;
  const info: unknown = await response.json();
  if (typeof info !== 'object' || info === null) return;
  const release = pickRelease(info as Record<string, unknown>, installTarget(), BACKEND_URL);
  const state = await getUpdateState();
  await setUpdateState({ ...state, release, checkedAt: Date.now() });
}

async function ensureSchedule(): Promise<void> {
  if (!await browser.alarms.get(CHECK_ALARM)) {
    await browser.alarms.create(CHECK_ALARM, { periodInMinutes: CHECK_PERIOD_MINUTES });
  }
  const { checkedAt } = await getUpdateState();
  if (Date.now() - checkedAt >= CHECK_PERIOD_MINUTES * 60_000) await checkForUpdate();
}

async function rememberUpdate(previousVersion: string | undefined): Promise<void> {
  const version = browser.runtime.getManifest().version;
  if (!previousVersion || previousVersion === version) return;
  const state = await getUpdateState();
  await setUpdateState({ ...state, updatedTo: { version, at: Date.now() } });
}

/**
 * Registers listeners synchronously, as MV3 requires for a waking worker.
 * Chrome may drop alarms on a browser restart, so startup re-arms the schedule.
 */
export function startUpdateChecks(): void {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CHECK_ALARM) checkForUpdate().catch(() => undefined);
  });
  browser.runtime.onStartup.addListener(() => {
    ensureSchedule().catch(() => undefined);
  });
  browser.runtime.onInstalled.addListener((details) => {
    const updated = details.reason === 'update' ? rememberUpdate(details.previousVersion) : Promise.resolve();
    updated
      .then(() => browser.alarms.create(CHECK_ALARM, { periodInMinutes: CHECK_PERIOD_MINUTES }))
      .then(checkForUpdate)
      .catch(() => undefined);
  });
}
