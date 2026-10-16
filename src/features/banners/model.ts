import type { UpdateNotice } from '../update-notice/model';

export type BannerType = 'info' | 'warning' | 'danger' | 'success' | 'tip' | 'announcement' | 'maintenance';
export type BannerTarget = 'chat' | 'popup';

export interface MaintenancePayload {
  startsAt: number;
  endsAt: number;
  affected: string[];
  affectedExtra: string | null;
}

export interface Banner {
  id: number;
  type: BannerType;
  title: string | null;
  message: string;
  dismissible: boolean;
  targets: BannerTarget[];
  maintenance: MaintenancePayload | null;
}

export interface BannerSnapshot {
  revision: string;
  banners: Banner[];
}

export interface BannerState {
  snapshot: BannerSnapshot | null;
  dismissed: number[];
}

export type MaintenancePhase = 'upcoming' | 'live' | 'over';

export type ChatPlate =
  | { kind: 'update'; notice: UpdateNotice }
  | { kind: 'connection'; retryAt: number | null }
  | { kind: 'banner'; banner: Banner };

export interface ChatPlateInput {
  update: UpdateNotice | null;
  connectionLost: boolean;
  retryAt: number | null;
  banners: Banner[];
  now: number;
}

export const EMPTY_BANNER_STATE: BannerState = { snapshot: null, dismissed: [] };

const BANNER_TYPES: BannerType[] = ['info', 'warning', 'danger', 'success', 'tip', 'announcement', 'maintenance'];
const BANNER_TARGETS: BannerTarget[] = ['chat', 'popup'];
const URGENT_ORDER: BannerType[] = ['danger', 'warning'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMaintenance(value: unknown): MaintenancePayload | null {
  if (!isRecord(value)) return null;
  const startsAt = timestamp(value.starts_at);
  const endsAt = timestamp(value.ends_at);
  if (startsAt === null || endsAt === null || endsAt <= startsAt) return null;
  const affected = Array.isArray(value.affected) ? value.affected.filter((item): item is string => typeof item === 'string') : [];
  return { startsAt, endsAt, affected, affectedExtra: text(value.affected_extra) };
}

function parseBanner(value: unknown): Banner | null {
  if (!isRecord(value)) return null;
  const { id, type } = value;
  if (typeof id !== 'number' || !Number.isInteger(id)) return null;
  if (!BANNER_TYPES.includes(type as BannerType)) return null;
  const message = text(value.message);
  if (!message) return null;
  const targets = Array.isArray(value.targets)
    ? BANNER_TARGETS.filter((target) => (value.targets as unknown[]).includes(target))
    : [];
  const maintenance = type === 'maintenance' ? parseMaintenance(value.payload) : null;
  if (type === 'maintenance' && !maintenance) return null;
  return {
    id,
    type: type as BannerType,
    title: text(value.title),
    message,
    dismissible: typeof value.dismissible === 'boolean' ? value.dismissible : true,
    targets,
    maintenance,
  };
}

export function parseSnapshot(value: unknown): BannerSnapshot | null {
  if (!isRecord(value) || typeof value.revision !== 'string' || !Array.isArray(value.banners)) return null;
  const banners: Banner[] = [];
  for (const entry of value.banners) {
    const banner = parseBanner(entry);
    if (banner) banners.push(banner);
  }
  return { revision: value.revision, banners };
}

export function parseBannerState(value: unknown): BannerState {
  if (!isRecord(value)) return { snapshot: null, dismissed: [] };
  const dismissed = Array.isArray(value.dismissed)
    ? [...new Set(value.dismissed.filter((id): id is number => typeof id === 'number' && Number.isInteger(id)))]
    : [];
  return { snapshot: parseSnapshot(value.snapshot), dismissed };
}

export function maintenancePhase(m: MaintenancePayload, now: number): MaintenancePhase {
  if (now >= m.endsAt) return 'over';
  return now >= m.startsAt ? 'live' : 'upcoming';
}

function isOver(banner: Banner, now: number): boolean {
  return banner.maintenance !== null && maintenancePhase(banner.maintenance, now) === 'over';
}

export function visibleBanners(state: BannerState, target: BannerTarget, now: number): Banner[] {
  if (!state.snapshot) return [];
  return state.snapshot.banners.filter(
    (banner) => banner.targets.includes(target) && !state.dismissed.includes(banner.id) && !isOver(banner, now),
  );
}

export function dismissBanner(state: BannerState, id: number): BannerState {
  const present = new Set(state.snapshot?.banners.map((banner) => banner.id) ?? []);
  const dismissed = [...new Set([...state.dismissed, id])].filter((entry) => present.has(entry));
  return { ...state, dismissed };
}

export function pickChatPlate(input: ChatPlateInput): ChatPlate | null {
  const { update, connectionLost, retryAt, now } = input;
  const alive = input.banners.filter((banner) => !isOver(banner, now));
  const phaseOf = (banner: Banner) => (banner.maintenance ? maintenancePhase(banner.maintenance, now) : null);
  const notice = (tone: UpdateNotice['tone']): ChatPlate | null => (update?.tone === tone ? { kind: 'update', notice: update } : null);
  const bannerPlate = (banner: Banner | undefined): ChatPlate | null => (banner ? { kind: 'banner', banner } : null);

  const ordinary = alive.filter((banner) => banner.maintenance === null);
  const rank = (banner: Banner) => {
    const index = URGENT_ORDER.indexOf(banner.type);
    return index === -1 ? URGENT_ORDER.length : index;
  };
  const ranked = ordinary.reduce<Banner | undefined>((best, banner) => (best && rank(best) <= rank(banner) ? best : banner), undefined);

  return (
    notice('warning') ??
    (connectionLost ? { kind: 'connection', retryAt } : null) ??
    bannerPlate(alive.find((banner) => phaseOf(banner) === 'live')) ??
    bannerPlate(ranked) ??
    bannerPlate(alive.find((banner) => phaseOf(banner) === 'upcoming')) ??
    notice('update') ??
    notice('success')
  );
}

type DateParts = Record<string, string>;

function partsOf(ms: number, options: Intl.DateTimeFormatOptions, timeZone?: string): DateParts {
  const formatter = new Intl.DateTimeFormat('ru-RU', { ...options, timeZone, hourCycle: 'h23' });
  const parts: DateParts = {};
  for (const part of formatter.formatToParts(ms)) parts[part.type] = part.value;
  return parts;
}

function clock(ms: number, timeZone?: string): string {
  const { hour, minute } = partsOf(ms, { hour: '2-digit', minute: '2-digit' }, timeZone);
  return `${hour}:${minute}`;
}

function shortDate(ms: number, timeZone?: string): string {
  const { day, month } = partsOf(ms, { day: 'numeric', month: 'short' }, timeZone);
  return `${day} ${month.replace(/\.$/, '')}`;
}

export function formatMaintenanceMeta(m: MaintenancePayload, now: number, timeZone?: string): string {
  if (maintenancePhase(m, now) === 'live') return `до ${clock(m.endsAt, timeZone)}`;
  const { day, month } = partsOf(m.startsAt, { day: '2-digit', month: '2-digit' }, timeZone);
  return `${day}.${month} ${clock(m.startsAt, timeZone)}`;
}

export function formatMaintenanceRange(m: MaintenancePayload, timeZone?: string): string {
  const startDate = shortDate(m.startsAt, timeZone);
  const endDate = shortDate(m.endsAt, timeZone);
  if (startDate === endDate) return `${startDate}, ${clock(m.startsAt, timeZone)}–${clock(m.endsAt, timeZone)}`;
  return `${startDate}, ${clock(m.startsAt, timeZone)} – ${endDate}, ${clock(m.endsAt, timeZone)}`;
}
