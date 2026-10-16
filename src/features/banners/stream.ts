import { getSharedSocket } from '../../shared/socket';
import { getBannerState, setBannerState } from '../../shared/storage';
import { parseSnapshot } from './model';

/** Stores a snapshot only when its revision is new, so tabs receiving one broadcast do not rewrite storage. */
export async function applySnapshot(raw: unknown): Promise<boolean> {
  const snapshot = parseSnapshot(raw);
  if (!snapshot) return false;
  const state = await getBannerState();
  if (state.snapshot?.revision === snapshot.revision) return false;
  const present = new Set(snapshot.banners.map((banner) => banner.id));
  await setBannerState({ snapshot, dismissed: state.dismissed.filter((id) => present.has(id)) });
  return true;
}

export function startBannerStream(): void {
  const socket = getSharedSocket();
  if (!socket) return;
  socket.onConnect(() => socket.emit('subscribe_banners'));
  socket.on('extension_banners', (raw) => {
    applySnapshot(raw).catch(() => undefined);
  });
}
