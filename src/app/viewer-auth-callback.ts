import browser from '../shared/browser';

type CompletionResponse =
  | { ok: true; account?: { twitchLogin: string } }
  | { ok: false; error?: string };

function setText(title: string, status: string): void {
  const titleEl = document.getElementById('title');
  const statusEl = document.getElementById('status');
  if (titleEl) titleEl.textContent = title;
  if (statusEl) statusEl.textContent = status;
}

async function complete(): Promise<void> {
  const params = new URLSearchParams(globalThis.location.hash.replace(/^#/, ''));
  const token = params.get('token');
  if (globalThis.location.hash) {
    history.replaceState(null, '', globalThis.location.pathname);
  }

  if (!token) {
    setText('Свага+', 'Не найден токен подключения.');
    return;
  }

  try {
    const result = await browser.runtime.sendMessage({ type: 'viewer:completeConnect', token }) as CompletionResponse;
    if (!result || result.ok !== true) {
      setText('Свага+', 'Не удалось подтвердить аккаунт.');
      return;
    }
    setText('Свага+', `Аккаунт подключен: ${result.account?.twitchLogin ?? 'готово'}`);
  } catch {
    setText('Свага+', 'Не удалось подтвердить аккаунт.');
  }
}

void complete();
