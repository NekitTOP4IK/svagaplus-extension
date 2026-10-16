import {
  NOT_FOUND_TTL_MS,
  TRANSIENT_TTL_MS,
  channelBadgesKey,
  type RequestCooldown,
} from '../../shared/request-cooldown';

export type SnapshotMode = 'snapshot' | 'unknown' | 'legacy';

export type SnapshotEvent = {
  type: 'user_update' | 'channel_refresh' | 'badge_grants_updated' | 'viewer_refresh';
  rev?: number;
  global_rev?: number;
  data?: Record<string, unknown>;
};

export type SnapshotAnswer = {
  ok: true;
  badges: Record<string, unknown>;
  font_presets: Record<string, unknown>;
  viewers: Record<string, unknown>;
};

type SyncEvent = { type: 'sync'; rev: number; global_rev: number; reconnect: boolean };
type QueuedEvent = SnapshotEvent | SyncEvent;

type SnapshotData = {
  badges: Record<string, unknown>;
  font_presets: Record<string, unknown>;
  viewers: Record<string, Record<string, unknown>>;
};

type FetchResult =
  | { kind: 'ok'; rev: number; globalRev: number; etag: string; data: SnapshotData }
  | { kind: 'not_modified' }
  | { kind: 'unknown' }
  | { kind: 'missing' }
  | { kind: 'failed' };

type Entry = {
  mode: SnapshotMode | null;
  rev: number;
  globalRev: number;
  etag: string | null;
  data: SnapshotData | null;
  loading: Promise<void> | null;
  refetchTimer: ReturnType<typeof setTimeout> | null;
  buffered: QueuedEvent[];
  held: Map<number, SnapshotEvent>;
  holdTimer: ReturnType<typeof setTimeout> | null;
  waiters: Array<() => void>;
  retryAt: number;
  usedAt: number;
};

export type ChannelSnapshotStoreOptions = {
  backendUrl: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  cooldown: RequestCooldown;
  cooldownReady?: Promise<void>;
  holdMs?: number;
  jitterMs?: number;
  timeoutMs?: number;
  random?: () => number;
  now?: () => number;
};

const IDLE_DROP_MS = 30 * 60 * 1000;
const MAX_CHANNELS = 16;
const VIEWER_EVENT_FIELDS_TO_DROP = ['twitch_username', 'badges', 'font_presets'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRev(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function normalizeViewer(viewer: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...viewer };
  normalized.badge_ids = Array.isArray(viewer.badge_ids)
    ? viewer.badge_ids
      .map((badgeId) => (typeof badgeId === 'string' || typeof badgeId === 'number' ? String(badgeId) : ''))
      .filter(Boolean)
    : [];
  return normalized;
}

function parseSnapshot(body: unknown, etag: string | null): FetchResult {
  const data = isRecord(body) ? body.data : null;
  if (!isRecord(data) || !isRev(data.rev) || !isRev(data.global_rev) || !isRecord(data.viewers)) {
    return { kind: 'failed' };
  }
  const viewers: Record<string, Record<string, unknown>> = {};
  for (const [login, viewer] of Object.entries(data.viewers)) {
    if (isRecord(viewer)) viewers[login.toLowerCase()] = normalizeViewer(viewer);
  }
  return {
    kind: 'ok',
    rev: data.rev,
    globalRev: data.global_rev,
    etag: etag || `"${data.rev}.${data.global_rev}"`,
    data: {
      badges: isRecord(data.badges) ? { ...data.badges } : {},
      font_presets: isRecord(data.font_presets) ? { ...data.font_presets } : {},
      viewers,
    },
  };
}

export function emptySnapshotAnswer(logins: string[]): SnapshotAnswer {
  const viewers: Record<string, unknown> = {};
  for (const login of logins) viewers[login] = { badge_ids: [] };
  return { ok: true, badges: {}, font_presets: {}, viewers };
}

export class ChannelSnapshotStore {
  private readonly entries = new Map<string, Entry>();
  private readonly holdMs: number;
  private readonly jitterMs: number;
  private readonly timeoutMs: number;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(private readonly options: ChannelSnapshotStoreOptions) {
    this.holdMs = options.holdMs ?? 2_000;
    this.jitterMs = options.jitterMs ?? 5_000;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  async open(channel: string): Promise<SnapshotMode> {
    const entry = this.entry(channel);
    await this.options.cooldownReady;
    if (entry.mode === 'snapshot' && !entry.loading) return 'snapshot';
    if (!entry.loading) {
      if (this.isUnknown(channel)) {
        this.reset(entry, 'unknown');
        return 'unknown';
      }
      if (entry.mode === 'legacy' && entry.retryAt > this.now()) return 'legacy';
      void this.load(channel, entry);
    }
    await entry.loading;
    return entry.mode ?? 'legacy';
  }

  async answer(channel: string, logins: string[]): Promise<SnapshotAnswer | null> {
    const mode = await this.open(channel);
    if (mode === 'unknown') return emptySnapshotAnswer(logins);
    if (mode === 'legacy') return null;
    const entry = this.entry(channel);
    await this.settled(entry);
    if (entry.mode === 'unknown') return emptySnapshotAnswer(logins);
    if (entry.mode !== 'snapshot' || !entry.data) return null;

    const { data } = entry;
    const answer: SnapshotAnswer = { ok: true, badges: {}, font_presets: {}, viewers: {} };
    for (const login of logins) {
      const viewer = data.viewers[login];
      if (!viewer) {
        answer.viewers[login] = { badge_ids: [] };
        continue;
      }
      answer.viewers[login] = viewer;
      for (const badgeId of viewer.badge_ids as string[]) {
        if (badgeId in data.badges) answer.badges[badgeId] = data.badges[badgeId];
      }
      const fontPresetId = viewer.font_preset_id;
      if ((typeof fontPresetId === 'string' || typeof fontPresetId === 'number') && String(fontPresetId) in data.font_presets) {
        answer.font_presets[String(fontPresetId)] = data.font_presets[String(fontPresetId)];
      }
    }
    return answer;
  }

  sync(channel: string, rev: number, globalRev: number, reconnect: boolean): void {
    if (!isRev(rev) || !isRev(globalRev)) return;
    this.dispatch(channel, { type: 'sync', rev, global_rev: globalRev, reconnect });
  }

  event(channel: string, event: SnapshotEvent): void {
    this.dispatch(channel, event);
  }

  revisionOf(channel: string): number | null {
    const entry = this.entries.get(channel);
    return entry?.mode === 'snapshot' ? entry.rev : null;
  }

  private dispatch(channel: string, event: QueuedEvent): void {
    const entry = this.entries.get(channel);
    if (!entry) return;
    entry.usedAt = this.now();
    this.handle(channel, entry, event, false);
    this.notify(entry);
  }

  private entry(channel: string): Entry {
    let entry = this.entries.get(channel);
    if (!entry) {
      this.prune();
      entry = {
        mode: null,
        rev: 0,
        globalRev: 0,
        etag: null,
        data: null,
        loading: null,
        refetchTimer: null,
        buffered: [],
        held: new Map(),
        holdTimer: null,
        waiters: [],
        retryAt: 0,
        usedAt: 0,
      };
      this.entries.set(channel, entry);
    }
    entry.usedAt = this.now();
    return entry;
  }

  private prune(): void {
    const now = this.now();
    const idle = Array.from(this.entries)
      .filter(([, entry]) => entry.mode !== null && this.isSettled(entry) && entry.waiters.length === 0)
      .sort(([, a], [, b]) => a.usedAt - b.usedAt);
    let excess = this.entries.size - MAX_CHANNELS + 1;
    for (const [channel, entry] of idle) {
      if (excess <= 0 && now - entry.usedAt < IDLE_DROP_MS) break;
      this.entries.delete(channel);
      excess -= 1;
    }
  }

  private isUnknown(channel: string): boolean {
    return this.options.cooldown.get(channelBadgesKey(channel))?.kind === 'not_found';
  }

  private isSettled(entry: Entry): boolean {
    return !entry.loading && !entry.refetchTimer && entry.held.size === 0;
  }

  private async settled(entry: Entry): Promise<void> {
    while (!this.isSettled(entry)) {
      await new Promise<void>((resolve) => entry.waiters.push(resolve));
    }
  }

  private notify(entry: Entry): void {
    if (!this.isSettled(entry)) return;
    for (const resolve of entry.waiters.splice(0)) resolve();
  }

  private reset(entry: Entry, mode: SnapshotMode): void {
    entry.mode = mode;
    entry.data = null;
    entry.etag = null;
    entry.buffered = [];
    entry.held.clear();
    if (entry.holdTimer) clearTimeout(entry.holdTimer);
    entry.holdTimer = null;
  }

  private load(channel: string, entry: Entry): Promise<void> {
    if (entry.loading) return entry.loading;
    if (entry.refetchTimer) clearTimeout(entry.refetchTimer);
    entry.refetchTimer = null;
    const loading = (async () => {
      const result = await this.request(channel, entry.data ? entry.etag : null);
      entry.loading = null;
      this.apply(channel, entry, result);
      this.notify(entry);
    })();
    entry.loading = loading;
    return loading;
  }

  private apply(channel: string, entry: Entry, result: FetchResult): void {
    if (result.kind === 'not_modified' && !entry.data) result = { kind: 'failed' };
    if (result.kind === 'ok') {
      entry.rev = result.rev;
      entry.globalRev = result.globalRev;
      entry.etag = result.etag;
      entry.data = result.data;
    }
    switch (result.kind) {
      case 'ok':
      case 'not_modified': {
        entry.mode = 'snapshot';
        const queued = entry.buffered.splice(0);
        for (const event of queued) this.handle(channel, entry, event, true);
        return;
      }
      case 'unknown':
        this.options.cooldown.mark(channelBadgesKey(channel), 'not_found');
        this.reset(entry, 'unknown');
        return;
      case 'missing':
        this.reset(entry, 'legacy');
        entry.retryAt = this.now() + NOT_FOUND_TTL_MS;
        return;
      case 'failed':
        this.reset(entry, 'legacy');
        entry.retryAt = this.now() + TRANSIENT_TTL_MS;
        return;
    }
  }

  private async request(channel: string, etag: string | null): Promise<FetchResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {};
      if (etag) headers['If-None-Match'] = etag;
      const res = await this.options.fetch(
        `${this.options.backendUrl}/api/v3/channels/${encodeURIComponent(channel)}/snapshot`,
        { headers, signal: controller.signal },
      );
      if (res.status === 304) return { kind: 'not_modified' };
      if (res.status === 404) {
        // An old backend has no route and answers a bare 404; only the new one names the channel as unknown.
        const body = await res.json().catch(() => null);
        return isRecord(body) && body.error === 'channel_not_found' ? { kind: 'unknown' } : { kind: 'missing' };
      }
      if (!res.ok) return { kind: 'failed' };
      return parseSnapshot(await res.json(), res.headers.get('ETag'));
    } catch {
      return { kind: 'failed' };
    } finally {
      clearTimeout(timeout);
    }
  }

  private handle(channel: string, entry: Entry, event: QueuedEvent, replay: boolean): void {
    if (entry.loading || entry.refetchTimer || entry.mode === null) {
      entry.buffered.push(event);
      return;
    }
    if (entry.mode !== 'snapshot') return;

    switch (event.type) {
      case 'sync': {
        const behind = event.rev > entry.rev || event.global_rev > entry.globalRev;
        const differs = event.rev !== entry.rev || event.global_rev !== entry.globalRev;
        if (replay ? behind : differs) this.scheduleRefetch(channel, entry, event.reconnect);
        return;
      }
      case 'viewer_refresh':
        if (event.global_rev !== entry.globalRev) this.scheduleRefetch(channel, entry, true);
        return;
      case 'channel_refresh':
      case 'badge_grants_updated':
        if (isRev(event.rev) && event.rev <= entry.rev) return;
        this.scheduleRefetch(channel, entry, true);
        return;
      case 'user_update':
        this.handleUserUpdate(channel, entry, event);
        return;
    }
  }

  private handleUserUpdate(channel: string, entry: Entry, event: SnapshotEvent): void {
    if (!isRev(event.rev)) {
      if (!this.patchViewer(entry, event)) this.scheduleRefetch(channel, entry, false);
      return;
    }
    if (event.rev <= entry.rev) return;
    if (event.rev > entry.rev + 1) {
      entry.held.set(event.rev, event);
      entry.holdTimer ??= setTimeout(() => {
        entry.holdTimer = null;
        this.scheduleRefetch(channel, entry, false);
      }, this.holdMs);
      return;
    }

    let next: SnapshotEvent | undefined = event;
    while (next && isRev(next.rev)) {
      if (!this.patchViewer(entry, next)) {
        this.scheduleRefetch(channel, entry, false);
        return;
      }
      entry.rev = next.rev;
      entry.held.delete(next.rev);
      next = entry.held.get(entry.rev + 1);
    }
    for (const rev of entry.held.keys()) if (rev <= entry.rev) entry.held.delete(rev);
    if (entry.held.size === 0 && entry.holdTimer) {
      clearTimeout(entry.holdTimer);
      entry.holdTimer = null;
    }
  }

  private patchViewer(entry: Entry, event: SnapshotEvent): boolean {
    const payload = event.data;
    if (!entry.data || !isRecord(payload) || !Array.isArray(payload.badge_ids)) return false;
    const login = typeof payload.twitch_username === 'string' ? payload.twitch_username.trim().toLowerCase() : '';
    if (!login) return false;
    const viewer: Record<string, unknown> = { ...payload };
    for (const field of VIEWER_EVENT_FIELDS_TO_DROP) delete viewer[field];
    entry.data.viewers[login] = normalizeViewer(viewer);
    if (isRecord(payload.badges)) Object.assign(entry.data.badges, payload.badges);
    if (isRecord(payload.font_presets)) Object.assign(entry.data.font_presets, payload.font_presets);
    return true;
  }

  private scheduleRefetch(channel: string, entry: Entry, jitter: boolean): void {
    if (entry.loading || entry.refetchTimer) return;
    entry.buffered.push(...entry.held.values());
    entry.held.clear();
    if (entry.holdTimer) clearTimeout(entry.holdTimer);
    entry.holdTimer = null;
    entry.refetchTimer = setTimeout(() => {
      entry.refetchTimer = null;
      void this.load(channel, entry);
    }, jitter ? this.random() * this.jitterMs : 0);
  }
}
