import { DEFAULT_FEATURE_FLAGS, FeatureFlags } from '../shared/featureFlags';

const FEATURE_FLAGS_KEY = 'svagaplus_feature_flags';

type ChromeStorage = typeof chrome.storage.local;

function localStorageArea(): ChromeStorage | null {
  return globalThis.chrome?.storage?.local ?? null;
}

export async function getFeatureFlags(): Promise<FeatureFlags> {
  const area = localStorageArea();
  if (!area) return DEFAULT_FEATURE_FLAGS;

  const stored = await area.get(FEATURE_FLAGS_KEY);
  return { ...DEFAULT_FEATURE_FLAGS, ...(stored[FEATURE_FLAGS_KEY] || {}) };
}

export async function setFeatureFlags(flags: Partial<FeatureFlags>): Promise<FeatureFlags> {
  const next = { ...(await getFeatureFlags()), ...flags };
  const area = localStorageArea();
  if (area) await area.set({ [FEATURE_FLAGS_KEY]: next });
  return next;
}
