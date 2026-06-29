declare const __WS_BACKEND_URL__: string;
const WS_BASE = __WS_BACKEND_URL__;
const OPEN_TIMEOUT_MS = 10_000;
const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const LOGIN_RE = /^[a-z0-9_]{3,25}$/;

export type RatingUpdateCallback = (login: string, score: number) => void;
export type BadgeGrantsUpdateCallback = (channelLogin: string) => void;

let socket: WebSocket | null = null;
let activeChannel: string | null = null;
let onUpdateCb: RatingUpdateCallback | null = null;
let onBadgeGrantsUpdateCb: BadgeGrantsUpdateCallback | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let openTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;

function clearTimer(timer: ReturnType<typeof setTimeout> | null): null {
  if (timer) clearTimeout(timer);
  return null;
}

function normalizeChannel(channelLogin: string): string {
  return channelLogin.trim().toLowerCase();
}

function isValidLogin(value: unknown): value is string {
  return typeof value === 'string' && LOGIN_RE.test(value);
}

function isValidScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(value);
}

function reconnectDelay(): number {
  const exp = Math.min(MAX_RECONNECT_DELAY_MS, BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttempt);
  const jitter = Math.floor(Math.random() * Math.min(1_000, exp * 0.25));
  reconnectAttempt += 1;
  return exp + jitter;
}

function scheduleReconnect(channelLogin: string): void {
  reconnectTimer = clearTimer(reconnectTimer);
  if (activeChannel !== channelLogin) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (activeChannel === channelLogin) connect(channelLogin);
  }, reconnectDelay());
}

function handleOnline(): void {
  if (!activeChannel || socket) return;
  reconnectAttempt = 0;
  connect(activeChannel);
}

function connect(channelLogin: string): void {
  const ws = new WebSocket(`${WS_BASE}/ws/${encodeURIComponent(channelLogin)}`);
  socket = ws;

  openTimer = clearTimer(openTimer);
  openTimer = setTimeout(() => {
    if (socket === ws && ws.readyState === WebSocket.CONNECTING) ws.close();
  }, OPEN_TIMEOUT_MS);

  ws.addEventListener('open', () => {
    if (socket !== ws) return;
    openTimer = clearTimer(openTimer);
    reconnectAttempt = 0;
  });

  ws.addEventListener('message', (ev) => {
    try {
      const data = JSON.parse(ev.data as string);
      if (data?.type === 'ping') return;
      if (data.type === 'rating_update' && onUpdateCb) {
        if (typeof data.channel === 'string' && data.channel.toLowerCase() !== channelLogin) return;
        const score = data.swag_score ?? data.score;
        if (!isValidLogin(data.login) || !isValidScore(score)) return;
        onUpdateCb(data.login, score);
      }
      if (data.type === 'badge_grants_updated' && onBadgeGrantsUpdateCb) {
        if (typeof data.channel !== 'string') return;
        const updatedChannel = normalizeChannel(data.channel);
        if (updatedChannel !== channelLogin || !LOGIN_RE.test(updatedChannel)) return;
        onBadgeGrantsUpdateCb(updatedChannel);
      }
    } catch {}
  });

  ws.addEventListener('error', () => { /* close fires after error — reconnect handled there */ });

  ws.addEventListener('close', () => {
    if (socket === ws) socket = null;
    openTimer = clearTimer(openTimer);
    scheduleReconnect(channelLogin);
  });
}

export function connectWebSocket(
  channelLogin: string,
  onUpdate: RatingUpdateCallback,
  onBadgeGrantsUpdate?: BadgeGrantsUpdateCallback,
): void {
  const normalizedChannel = normalizeChannel(channelLogin);
  if (!LOGIN_RE.test(normalizedChannel)) return;
  if (socket && activeChannel === normalizedChannel) return;
  disconnectWebSocket();
  activeChannel = normalizedChannel;
  onUpdateCb = onUpdate;
  onBadgeGrantsUpdateCb = onBadgeGrantsUpdate ?? null;
  reconnectAttempt = 0;
  window.addEventListener('online', handleOnline);
  connect(normalizedChannel);
}

export function disconnectWebSocket(): void {
  activeChannel = null;
  onUpdateCb = null;
  onBadgeGrantsUpdateCb = null;
  reconnectTimer = clearTimer(reconnectTimer);
  openTimer = clearTimer(openTimer);
  reconnectAttempt = 0;
  window.removeEventListener('online', handleOnline);
  if (socket) {
    socket.close();
    socket = null;
  }
}
