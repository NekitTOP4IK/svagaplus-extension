const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseSnapshot,
  parseBannerState,
  maintenancePhase,
  visibleBanners,
  dismissBanner,
  pickChatPlate,
  formatMaintenanceMeta,
  formatMaintenanceRange,
  EMPTY_BANNER_STATE,
} = require('../dist-types/features/banners/model.js');

const MIN = 60 * 1000;
const START = Date.parse('2026-10-18T00:00:00Z');
const END = Date.parse('2026-10-18T02:00:00Z');
const ZONE = 'Europe/Moscow';

const banner = (patch) => ({
  id: 1,
  type: 'info',
  title: null,
  message: 'Текст',
  dismissible: true,
  targets: ['chat', 'popup'],
  maintenance: null,
  ...patch,
});

const maintenance = (patch) => ({ startsAt: START, endsAt: END, affected: ['chat_badges'], affectedExtra: null, ...patch });
const works = (patch) => banner({ id: 50, type: 'maintenance', message: 'Работы', maintenance: maintenance(), ...patch });

const raw = (patch) => ({ id: 1, type: 'info', title: null, message: 'Текст', dismissible: true, targets: ['chat'], payload: null, ...patch });
const state = (patch) => ({ ...EMPTY_BANNER_STATE, ...patch });
const update = (tone) => ({ tone, version: '1.4.0', fromVersion: '1.3.0', text: 'x', action: null, link: null });
const idle = { update: null, connectionLost: false, retryAt: null, banners: [], now: START - 60 * MIN };

test('parseSnapshot drops malformed items one by one and keeps the valid neighbours', () => {
  const snapshot = parseSnapshot({
    revision: 'r1',
    banners: [
      raw({ id: 1 }),
      raw({ id: 2, type: 'poll' }),
      raw({ id: 3, message: undefined }),
      raw({ id: 'x' }),
      null,
      raw({ id: 4, message: 'Другой' }),
    ],
  });
  assert.deepEqual(snapshot.banners.map((item) => item.id), [1, 4]);
  assert.equal(snapshot.revision, 'r1');
});

test('parseSnapshot rejects values without a revision string or banners array', () => {
  assert.equal(parseSnapshot(null), null);
  assert.equal(parseSnapshot({ banners: [] }), null);
  assert.equal(parseSnapshot({ revision: 'r1' }), null);
  assert.equal(parseSnapshot({ revision: 5, banners: [] }), null);
  assert.deepEqual(parseSnapshot({ revision: 'r1', banners: [] }), { revision: 'r1', banners: [] });
});

test('parseSnapshot converts maintenance payload dates to epoch milliseconds', () => {
  const snapshot = parseSnapshot({
    revision: 'r1',
    banners: [raw({
      type: 'maintenance',
      payload: { starts_at: '2026-10-18T00:00:00Z', ends_at: '2026-10-18T02:00:00Z', affected: ['chat_badges'], affected_extra: 'и ещё' },
    })],
  });
  assert.deepEqual(snapshot.banners[0].maintenance, { startsAt: START, endsAt: END, affected: ['chat_badges'], affectedExtra: 'и ещё' });
});

test('parseSnapshot drops maintenance without valid dates and ignores a stray payload on other types', () => {
  const snapshot = parseSnapshot({
    revision: 'r1',
    banners: [
      raw({ id: 1, type: 'maintenance', payload: { starts_at: 'soon', ends_at: '2026-10-18T02:00:00Z', affected: [], affected_extra: null } }),
      raw({ id: 2, type: 'maintenance', payload: null }),
      raw({ id: 3, type: 'maintenance', payload: { starts_at: '2026-10-18T02:00:00Z', ends_at: '2026-10-18T00:00:00Z', affected: [], affected_extra: null } }),
      raw({ id: 4, type: 'info', payload: { starts_at: '2026-10-18T00:00:00Z', ends_at: '2026-10-18T02:00:00Z', affected: [], affected_extra: null } }),
    ],
  });
  assert.deepEqual(snapshot.banners.map((item) => item.id), [4]);
  assert.equal(snapshot.banners[0].maintenance, null);
});

test('parseSnapshot keeps only known targets and falls back to dismissible when the flag is not a boolean', () => {
  const [item] = parseSnapshot({ revision: 'r1', banners: [raw({ targets: ['chat', 'tv', 'popup'], dismissible: 'yes' })] }).banners;
  assert.deepEqual(item.targets, ['chat', 'popup']);
  assert.equal(item.dismissible, true);
});

test('parseBannerState tolerates garbage and sanitizes the stored shape', () => {
  assert.deepEqual(parseBannerState(undefined), EMPTY_BANNER_STATE);
  assert.deepEqual(parseBannerState({ snapshot: 'x', dismissed: 'y' }), EMPTY_BANNER_STATE);
  const parsed = parseBannerState({ snapshot: { revision: 'r1', banners: [raw()] }, dismissed: [3, 'a', 3, 4] });
  assert.equal(parsed.snapshot.revision, 'r1');
  assert.deepEqual(parsed.dismissed, [3, 4]);
});

test('maintenancePhase flips at the start and ends exactly at endsAt', () => {
  const m = maintenance();
  assert.equal(maintenancePhase(m, START - 1), 'upcoming');
  assert.equal(maintenancePhase(m, START), 'live');
  assert.equal(maintenancePhase(m, END - 1), 'live');
  assert.equal(maintenancePhase(m, END), 'over');
});

test('visibleBanners filters by target, dismissed ids and finished maintenance in snapshot order', () => {
  const snapshot = {
    revision: 'r1',
    banners: [
      banner({ id: 1, targets: ['chat'] }),
      banner({ id: 2, targets: ['popup'] }),
      banner({ id: 3, targets: ['chat', 'popup'] }),
      works({ id: 4, targets: ['chat'] }),
      banner({ id: 5, targets: ['chat'] }),
    ],
  };
  const ids = (now, dismissed) => visibleBanners(state({ snapshot, dismissed }), 'chat', now).map((item) => item.id);
  assert.deepEqual(ids(START, [5]), [1, 3, 4]);
  assert.deepEqual(ids(END, [5]), [1, 3]);
  assert.deepEqual(visibleBanners(state({ snapshot, dismissed: [] }), 'popup', START).map((item) => item.id), [2, 3]);
  assert.deepEqual(visibleBanners(EMPTY_BANNER_STATE, 'chat', START), []);
});

test('dismissBanner drops dismissed ids that left the snapshot so the list cannot grow forever', () => {
  const next = dismissBanner(
    state({ snapshot: { revision: 'r2', banners: [banner({ id: 2 }), banner({ id: 3 })] }, dismissed: [1, 2] }),
    3,
  );
  assert.deepEqual([...next.dismissed].sort(), [2, 3]);
  assert.equal(next.snapshot.revision, 'r2');
});

test('dismissBanner does not duplicate an id and tolerates a missing snapshot', () => {
  const current = state({ snapshot: { revision: 'r', banners: [banner({ id: 2 })] }, dismissed: [2] });
  assert.deepEqual(dismissBanner(current, 2).dismissed, [2]);
  assert.deepEqual(dismissBanner(EMPTY_BANNER_STATE, 9).dismissed, []);
});

test('pickChatPlate returns null when nothing wants attention', () => {
  assert.equal(pickChatPlate(idle), null);
});

test('pickChatPlate puts a warning update above a lost connection', () => {
  const plate = pickChatPlate({ ...idle, update: update('warning'), connectionLost: true });
  assert.equal(plate.kind, 'update');
  assert.equal(plate.notice.tone, 'warning');
});

test('pickChatPlate puts a lost connection above live maintenance and carries retryAt', () => {
  const plate = pickChatPlate({ ...idle, connectionLost: true, retryAt: 123, banners: [works()], now: START + MIN });
  assert.deepEqual(plate, { kind: 'connection', retryAt: 123 });
});

test('pickChatPlate shows live maintenance above ordinary banners', () => {
  const plate = pickChatPlate({ ...idle, banners: [banner({ id: 1, type: 'danger' }), works()], now: START + MIN });
  assert.equal(plate.banner.id, 50);
});

test('pickChatPlate ranks danger and warning before other banners even when they come later in the snapshot', () => {
  const banners = [banner({ id: 1, type: 'info' }), banner({ id: 2, type: 'tip' }), banner({ id: 3, type: 'warning' }), banner({ id: 4, type: 'danger' })];
  assert.equal(pickChatPlate({ ...idle, banners }).banner.id, 4);
  assert.equal(pickChatPlate({ ...idle, banners: banners.slice(0, 3) }).banner.id, 3);
  assert.equal(pickChatPlate({ ...idle, banners: banners.slice(0, 2) }).banner.id, 1);
});

test('pickChatPlate keeps snapshot order between banners of the same rank', () => {
  const banners = [banner({ id: 7, type: 'danger' }), banner({ id: 8, type: 'danger' })];
  assert.equal(pickChatPlate({ ...idle, banners }).banner.id, 7);
});

test('pickChatPlate places upcoming maintenance below a plain banner and above update and success', () => {
  const upcoming = works();
  assert.equal(pickChatPlate({ ...idle, banners: [upcoming, banner({ id: 1 })] }).banner.id, 1);
  assert.equal(pickChatPlate({ ...idle, banners: [upcoming], update: update('update') }).banner.id, 50);
  assert.equal(pickChatPlate({ ...idle, banners: [upcoming], update: update('success') }).banner.id, 50);
});

test('pickChatPlate shows update before success when no banner is left', () => {
  assert.equal(pickChatPlate({ ...idle, update: update('update') }).notice.tone, 'update');
  assert.equal(pickChatPlate({ ...idle, update: update('success') }).notice.tone, 'success');
});

test('pickChatPlate drops finished maintenance on its own once now reaches endsAt', () => {
  const input = { ...idle, banners: [works()] };
  assert.equal(pickChatPlate({ ...input, now: END - 1 }).banner.id, 50);
  assert.equal(pickChatPlate({ ...input, now: END }), null);
  assert.equal(pickChatPlate({ ...input, now: END, update: update('update') }).kind, 'update');
});

test('formatMaintenanceMeta shows the start before the window and the end during it', () => {
  const m = maintenance();
  assert.equal(formatMaintenanceMeta(m, START - MIN, ZONE), '18.10 03:00');
  assert.equal(formatMaintenanceMeta(m, START + MIN, ZONE), 'до 05:00');
});

test('formatMaintenanceRange renders a short Russian date with an en dash between times', () => {
  assert.equal(formatMaintenanceRange(maintenance(), ZONE), '18 окт, 03:00–05:00');
});
