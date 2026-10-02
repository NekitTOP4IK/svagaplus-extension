// Чистая логика панели «Алиасы»: без DOM и без browser API, чтобы покрывалась node-тестами.
// Лимиты повторяют проверки IMPORT_ALIASES в app/background.ts — иначе фон отвергнет весь файл.

export type AliasItem = { login: string; alias: string };

export const MAX_IMPORT_ALIASES = 1000;
const LOGIN_RE = /^[a-z0-9_]{3,25}$/;
const MAX_ALIAS_LENGTH = 64;

export type AliasImportResult =
  | { ok: true; items: AliasItem[]; skipped: number }
  | { ok: false; error: string };

/** Сортировка по логину: список не прыгает, когда фон дописывает алиасы после синхронизации. */
export function toSortedAliasItems(aliases: Record<string, string> | null | undefined): AliasItem[] {
  return Object.entries(aliases ?? {})
    .filter(([login, alias]) => !!login && typeof alias === 'string' && alias.length > 0)
    .map(([login, alias]) => ({ login, alias }))
    .sort((a, b) => a.login.localeCompare(b.login));
}

function normalizeItem(login: unknown, alias: unknown): AliasItem | null {
  if (typeof login !== 'string' || typeof alias !== 'string') return null;
  const normalizedLogin = login.trim().replace(/^@/, '').toLowerCase();
  const normalizedAlias = alias.trim();
  if (!LOGIN_RE.test(normalizedLogin)) return null;
  if (!normalizedAlias || normalizedAlias.length > MAX_ALIAS_LENGTH) return null;
  return { login: normalizedLogin, alias: normalizedAlias };
}

/**
 * Принимает формат экспорта (`[{ login, alias }]`, он же у старого расширения)
 * и простой объект `{ login: alias }`. Битые записи пропускаются, а не валят весь файл.
 */
export function parseAliasImport(text: string): AliasImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Файл не является JSON.' };
  }

  const raw: Array<[unknown, unknown]> = Array.isArray(data)
    ? data.map((entry) => (entry && typeof entry === 'object'
      ? [(entry as Record<string, unknown>).login, (entry as Record<string, unknown>).alias]
      : [null, null]))
    : data && typeof data === 'object'
      ? Object.entries(data as Record<string, unknown>)
      : [];

  if (raw.length === 0) return { ok: false, error: 'В файле нет алиасов.' };

  const byLogin = new Map<string, AliasItem>();
  let skipped = 0;
  for (const [login, alias] of raw) {
    const item = normalizeItem(login, alias);
    if (item) byLogin.set(item.login, item);
    else skipped += 1;
  }

  const items = Array.from(byLogin.values());
  if (items.length === 0) return { ok: false, error: 'В файле нет корректных алиасов.' };
  if (items.length > MAX_IMPORT_ALIASES) {
    return { ok: false, error: `Слишком много алиасов: ${items.length}, максимум ${MAX_IMPORT_ALIASES}.` };
  }
  return { ok: true, items, skipped };
}

export function aliasExportFilename(date: Date): string {
  return `svagaplus-aliases-${date.toISOString().slice(0, 10)}.json`;
}

export function formatAliasCount(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} алиас`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} алиаса`;
  return `${count} алиасов`;
}
