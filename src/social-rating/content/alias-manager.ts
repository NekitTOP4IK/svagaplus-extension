import browser from 'webextension-polyfill';

let aliases: Record<string, string> = {};
let initialized = false;

export async function initAliasManager(): Promise<void> {
  if (initialized) return;
  const res = (await browser.runtime
    .sendMessage({ type: 'GET_ALIASES' })
    .catch(() => ({ aliases: {} }))) as { aliases?: Record<string, string> };
  aliases = res.aliases ?? {};
  initialized = true;
}

export function getAlias(login: string): string | null {
  return aliases[login.toLowerCase()] ?? null;
}

export function isAliased(login: string): boolean {
  return login.toLowerCase() in aliases;
}

export async function setAlias(login: string, alias: string): Promise<{ ok: boolean; error?: string }> {
  const normalizedLogin = login.toLowerCase().trim();
  const trimmedAlias = alias.trim();

  if (!trimmedAlias || trimmedAlias.toLowerCase() === normalizedLogin) {
    return removeAlias(normalizedLogin);
  }

  aliases = { ...aliases, [normalizedLogin]: trimmedAlias };

  const res = (await browser.runtime
    .sendMessage({ type: 'SET_ALIAS', login: normalizedLogin, alias: trimmedAlias })
    .catch(() => ({ ok: false, error: 'network_error' }))) as { ok: boolean; error?: string };

  if (!res.ok) {
    // Revert in-memory on failure
    const next = { ...aliases };
    delete next[normalizedLogin];
    aliases = next;
  }
  return res;
}

export async function removeAlias(login: string): Promise<{ ok: boolean; error?: string }> {
  const normalizedLogin = login.toLowerCase().trim();

  const next = { ...aliases };
  delete next[normalizedLogin];
  aliases = next;

  const res = (await browser.runtime
    .sendMessage({ type: 'DELETE_ALIAS', login: normalizedLogin })
    .catch(() => ({ ok: false, error: 'network_error' }))) as { ok: boolean; error?: string };

  return res;
}

export function getAllAliases(): Record<string, string> {
  return { ...aliases };
}

// Listen for alias changes from other tabs / background sync
export function onAliasChange(callback: () => void): () => void {
  const listener = (changes: browser.Storage.StorageAreaOnChangedChangesType) => {
    if ('aliases' in changes) {
      aliases = (changes.aliases.newValue as Record<string, string>) ?? {};
      callback();
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
