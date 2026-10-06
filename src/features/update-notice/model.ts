export type NoticeTone = 'update' | 'warning' | 'success';

export interface ReleaseInfo {
  version: string | null;
  minVersion: string | null;
  url: string | null;
}

interface Stamp {
  version: string;
  at: number;
}

export interface UpdateState {
  release: ReleaseInfo | null;
  checkedAt: number;
  dismissed: Partial<Record<NoticeTone, Stamp>>;
  updatedTo: Stamp | null;
}

export interface NoticeLink {
  label: string;
  url: string;
}

export interface UpdateNotice {
  tone: NoticeTone;
  version: string;
  fromVersion: string | null;
  text: string;
  action: NoticeLink | null;
  link: NoticeLink | null;
}

export interface InstallTarget {
  firefox: boolean;
  storeInstall: boolean;
}

export const EMPTY_UPDATE_STATE: UpdateState = { release: null, checkedAt: 0, dismissed: {}, updatedTo: null };

const DAY = 24 * 60 * 60 * 1000;
const WARNING_SNOOZE = DAY;
const SUCCESS_TTL = 3 * DAY;
const TONES: NoticeTone[] = ['update', 'warning', 'success'];

export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function absolute(url: string | null, base: string): string | null {
  if (!url) return null;
  return url.startsWith('/') ? base + url : url;
}

export function pickRelease(info: Record<string, unknown>, target: InstallTarget, backendUrl: string): ReleaseInfo {
  const minVersion = text(info.min_version);
  let builds: Array<{ version: string | null; url: string | null }>;
  if (target.firefox) {
    builds = [
      { version: text(info.firefox_version), url: text(info.firefox_download_url) },
      { version: text(info.firefox_store_version), url: text(info.firefox_store_url) },
    ];
  } else if (target.storeInstall) {
    builds = [{ version: text(info.store_version), url: text(info.store_url_new) }];
  } else {
    builds = [{ version: text(info.zip_version), url: text(info.download_url) }];
  }
  const newest = builds
    .filter((build) => build.version)
    .sort((a, b) => compareVersions(b.version as string, a.version as string))[0];
  const url = newest?.url ?? builds.find((build) => build.url)?.url ?? null;
  return { version: newest?.version ?? null, minVersion, url: absolute(url, backendUrl) };
}

export function deriveNotice(state: UpdateState, current: string, now: number, siteUrl: string): UpdateNotice | null {
  const { release, dismissed, updatedTo } = state;
  const changelog = { label: 'Что нового ↗', url: `${siteUrl}/changelog` };
  const update = { label: 'Обновить', url: release?.url ?? `${siteUrl}/extension/download` };

  const warningSnoozed = dismissed.warning?.version === current && now - dismissed.warning.at < WARNING_SNOOZE;
  if (release?.minVersion && compareVersions(current, release.minVersion) < 0 && !warningSnoozed) {
    return { tone: 'warning', version: current, fromVersion: null, text: 'Версия больше не поддерживается', action: update, link: null };
  }
  if (release?.version && compareVersions(release.version, current) > 0 && dismissed.update?.version !== release.version) {
    return { tone: 'update', version: release.version, fromVersion: current, text: 'Доступно обновление Свага+', action: update, link: changelog };
  }
  if (updatedTo?.version === current && now - updatedTo.at < SUCCESS_TTL && dismissed.success?.version !== current) {
    return { tone: 'success', version: current, fromVersion: null, text: 'Свага+ обновлена', action: null, link: changelog };
  }
  return null;
}

export function dismissNotice(state: UpdateState, notice: UpdateNotice, now: number): UpdateState {
  return { ...state, dismissed: { ...state.dismissed, [notice.tone]: { version: notice.version, at: now } } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stamp(value: unknown): Stamp | null {
  if (!isRecord(value) || typeof value.version !== 'string' || typeof value.at !== 'number') return null;
  return { version: value.version, at: value.at };
}

export function parseUpdateState(value: unknown): UpdateState {
  if (!isRecord(value)) return { ...EMPTY_UPDATE_STATE };
  const release = isRecord(value.release)
    ? { version: text(value.release.version), minVersion: text(value.release.minVersion), url: text(value.release.url) }
    : null;
  const dismissed: UpdateState['dismissed'] = {};
  if (isRecord(value.dismissed)) {
    for (const tone of TONES) {
      const entry = stamp(value.dismissed[tone]);
      if (entry) dismissed[tone] = entry;
    }
  }
  return {
    release,
    checkedAt: typeof value.checkedAt === 'number' ? value.checkedAt : 0,
    dismissed,
    updatedTo: stamp(value.updatedTo),
  };
}
