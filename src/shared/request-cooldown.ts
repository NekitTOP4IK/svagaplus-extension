export type FailureKind = 'not_found' | 'transient';

export const NOT_FOUND_TTL_MS = 10 * 60 * 1000;
export const TRANSIENT_TTL_MS = 30_000;

export type CooldownEntry = { kind: FailureKind; until: number };

export type RequestCooldownOptions = {
  now?: () => number;
};

function normalizeLogin(value: string): string {
  return value.trim().toLowerCase();
}

export function channelBadgesKey(channelLogin: string): string {
  return `channel-badges:${normalizeLogin(channelLogin)}`;
}

export function ratingKey(channelLogin: string, viewerLogin: string): string {
  return `rating:${normalizeLogin(channelLogin)}:${normalizeLogin(viewerLogin)}`;
}

export function failureKindFromStatus(status: number | 'network'): FailureKind {
  if (status === 404) return 'not_found';
  return 'transient';
}

export function ttlForKind(kind: FailureKind): number {
  return kind === 'not_found' ? NOT_FOUND_TTL_MS : TRANSIENT_TTL_MS;
}

function isFailureKind(value: unknown): value is FailureKind {
  return value === 'not_found' || value === 'transient';
}

export class RequestCooldown {
  private readonly entries = new Map<string, CooldownEntry>();
  private readonly now: () => number;
  private changeListener: ((entries: Record<string, CooldownEntry>) => void) | null = null;

  constructor(options: RequestCooldownOptions = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  get(key: string): CooldownEntry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.until <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  isBlocked(key: string): boolean {
    return this.get(key) != null;
  }

  mark(key: string, kind: FailureKind): void {
    this.entries.set(key, { kind, until: this.now() + ttlForKind(kind) });
    this.notifyChange();
  }

  markFromStatus(key: string, status: number | 'network'): void {
    this.mark(key, failureKindFromStatus(status));
  }

  clear(key: string): void {
    if (this.entries.delete(key)) this.notifyChange();
  }

  clearPrefix(prefix: string): void {
    let changed = false;
    for (const key of Array.from(this.entries.keys())) {
      if (key.startsWith(prefix)) changed = this.entries.delete(key) || changed;
    }
    if (changed) this.notifyChange();
  }

  snapshot(): Record<string, CooldownEntry> {
    const now = this.now();
    const result: Record<string, CooldownEntry> = {};
    for (const [key, entry] of this.entries) {
      if (entry.until > now) result[key] = { ...entry };
    }
    return result;
  }

  /** Merges persisted entries; an in-memory entry that outlives the stored one wins. */
  restore(stored: unknown): void {
    if (typeof stored !== 'object' || stored === null) return;
    const now = this.now();
    for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue;
      const { kind, until } = value as { kind?: unknown; until?: unknown };
      if (!isFailureKind(kind) || typeof until !== 'number' || until <= now) continue;
      // A tampered or clock-skewed entry must not block requests longer than its kind allows.
      const cappedUntil = Math.min(until, now + ttlForKind(kind));
      const existing = this.entries.get(key);
      if (existing && existing.until >= cappedUntil) continue;
      this.entries.set(key, { kind, until: cappedUntil });
    }
  }

  setChangeListener(listener: ((entries: Record<string, CooldownEntry>) => void) | null): void {
    this.changeListener = listener;
  }

  private notifyChange(): void {
    this.changeListener?.(this.snapshot());
  }
}

/** Singleton for background bundles */
export const apiCooldown = new RequestCooldown();
