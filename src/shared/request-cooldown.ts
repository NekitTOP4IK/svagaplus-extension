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

export class RequestCooldown {
  private readonly entries = new Map<string, CooldownEntry>();
  private readonly now: () => number;

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
  }

  markFromStatus(key: string, status: number | 'network'): void {
    this.mark(key, failureKindFromStatus(status));
  }

  clear(key: string): void {
    this.entries.delete(key);
  }

  clearPrefix(prefix: string): void {
    for (const key of Array.from(this.entries.keys())) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }
}

/** Singleton for background bundles */
export const apiCooldown = new RequestCooldown();
