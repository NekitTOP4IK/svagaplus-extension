import { BACKEND_URL } from './config';

declare const io: undefined | IoFactory;

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 15000;
const JITTER = 0.7;
const MANUAL_DISCONNECT = 'io client disconnect';

export interface IoSocket {
  on(event: string, handler: (...args: any[]) => void): unknown;
  off(event: string, handler: (...args: any[]) => void): unknown;
  emit(event: string, data?: unknown): unknown;
  connect(): unknown;
}

export type IoFactory = (url: string, options: Record<string, unknown>) => IoSocket;

export interface ConnectionState {
  connected: boolean;
  failedAttempts: number;
  nextRetryAt: number | null;
}

export interface SharedSocket {
  emit(event: string, data?: unknown): void;
  on(event: string, handler: (msg: any) => void): () => void;
  onConnect(handler: () => void): () => void;
  onState(listener: (s: ConnectionState) => void): () => void;
  state(): ConnectionState;
}

export interface SharedSocketDeps {
  io: IoFactory;
  url: string;
  now: () => number;
  random: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
}

export function reconnectDelay(attempt: number, random: number): number {
  const base = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  return Math.round(base * (1 + JITTER * (2 * random - 1)));
}

export function createSharedSocket(deps: SharedSocketDeps): SharedSocket {
  const socket = deps.io(deps.url, { transports: ['websocket'], reconnection: false });

  let state: ConnectionState = { connected: false, failedAttempts: 0, nextRetryAt: null };
  let retryTimer: unknown = null;
  const connectHandlers = new Set<() => void>();
  const stateListeners = new Set<(s: ConnectionState) => void>();

  const snapshot = (): ConnectionState => ({ ...state });

  const setState = (next: ConnectionState): void => {
    state = next;
    for (const listener of [...stateListeners]) listener(snapshot());
  };

  const clearRetry = (): void => {
    if (retryTimer === null) return;
    deps.clearTimer(retryTimer);
    retryTimer = null;
  };

  const registerFailure = (): void => {
    clearRetry();
    const failedAttempts = state.failedAttempts + 1;
    const delay = reconnectDelay(failedAttempts, deps.random());
    retryTimer = deps.setTimer(() => {
      retryTimer = null;
      setState({ ...state, nextRetryAt: null });
      socket.connect();
    }, delay);
    setState({ connected: false, failedAttempts, nextRetryAt: deps.now() + delay });
  };

  socket.on('connect', () => {
    clearRetry();
    setState({ connected: true, failedAttempts: 0, nextRetryAt: null });
    for (const handler of [...connectHandlers]) handler();
  });

  socket.on('connect_error', registerFailure);

  socket.on('disconnect', (reason: string) => {
    if (reason === MANUAL_DISCONNECT) {
      clearRetry();
      setState({ connected: false, failedAttempts: state.failedAttempts, nextRetryAt: null });
      return;
    }
    registerFailure();
  });

  return {
    emit(event, data) {
      socket.emit(event, data);
    },
    on(event, handler) {
      socket.on(event, handler);
      return () => {
        socket.off(event, handler);
      };
    },
    onConnect(handler) {
      connectHandlers.add(handler);
      if (state.connected) handler();
      return () => {
        connectHandlers.delete(handler);
      };
    },
    onState(listener) {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },
    state: snapshot,
  };
}

let shared: SharedSocket | null = null;

export function getSharedSocket(): SharedSocket | null {
  if (shared) return shared;
  if (typeof io === 'undefined') return null;
  shared = createSharedSocket({
    io,
    url: BACKEND_URL,
    now: () => Date.now(),
    random: () => Math.random(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  });
  return shared;
}
