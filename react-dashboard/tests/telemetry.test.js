import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

async function load(file) {
  const result = buildSync({ entryPoints: [file], bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { parseTelemetry, buildDogs, buildRoutes, activityHistory, coordinate, DAY, retainDogPositions, positionLabel, fixedPositionReason } = await load('src/tracking/telemetry.js');
const { dateRange, fetchTelemetry, mergeRows, readFixedLocations, fetchLastGpsFix } = await load('src/tracking/cloud.js');
const { readPositionCache, savePositionCache } = await load('src/tracking/positionCache.js');
const now = Date.parse('2026-10-09T04:30:00Z');
test('Supabase last GPS lookup searches beyond 24h and preserves historical position time', async () => {
  const historic = raw(now - 3 * DAY, {}, 108, 7);
  const filters = [];
  const client = { from() {
    const query = {};
    for (const method of ['select', 'in', 'eq', 'lt', 'not', 'or', 'order', 'range']) {
      query[method] = (...args) => { filters.push([method, ...args]); return query; };
    }
    query.abortSignal = async () => ({ data: [historic], error: null });
    return query;
  } };
  const fix = await fetchLastGpsFix(client, [7], 108, new AbortController().signal, now);
  assert.ok(filters.some(filter => filter[0] === 'eq' && filter[1] === 'slave_id' && filter[2] === 108));
  const dog = buildDogs([parseTelemetry(raw(now, { lat: 0, lon: 0 }, 108, 7))], [], now, true, [fix])[0];
  assert.deepEqual(dog.position, [25.033, 121.565]); assert.equal(dog.lastPositionAt, now - 3 * DAY);
  assert.equal(dog.stale, true); assert.match(positionLabel(dog), /^× 未更新／最後顯示位置，10\/06/);
});
test('last displayed position survives reload per account and never restores a charging state', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  savePositionCache(storage, 'owner1', [{ id: 108, masterId: 7, position: [24, 121], lastPositionAt: now,
    lastPacketAt: now, positionSource: 'fixed', charging: true, packet: { raw: 'not stored' } }]);
  const rows = readPositionCache(storage, 'owner1');
  assert.deepEqual(rows[0].position, [24, 121]); assert.equal(rows[0].lastPositionAt, now);
  assert.equal(rows[0].stale, true); assert.equal(rows[0].charging, false);
  assert.deepEqual(rows[0].packet, {}); assert.deepEqual(readPositionCache(storage, 'owner2'), []);
  const restored = retainDogPositions([{ id: 108, masterId: 7, position: null, stale: true }], rows, now + 60000)[0];
  assert.deepEqual(restored.position, [24, 121]); assert.match(positionLabel(restored), /^× 未更新／最後顯示位置，/);
});
test('USB always applies fixed coordinates and charging label regardless of the switch', () => {
  const settings = [{ slave_id: 108, enabled: true, latitude: 24, longitude: 121, name: '家' }];
  for (const enabled of [true, false]) {
    const dog = buildDogs([parseTelemetry(raw(now, { lat: 0, lon: 0, usbPresent: 1 }, 108))], settings, now, enabled)[0];
    assert.deepEqual(dog.position, [24, 121]);
    assert.equal(positionLabel(dog), '充電中');
    assert.equal(dog.fixedReason, '充電中');
  }
  const rows = [parseTelemetry(raw(now, { lat: 0, lon: 0, usbPresent: 0 }, 108))];
  assert.equal(positionLabel(buildDogs(rows, settings, now, true)[0]), '× 未更新／最後顯示位置，時間未知');
  assert.equal(buildDogs(rows, settings, now, false)[0].position, null);
});
test('only recent indoor inference and USB apply fixed locations; window never does', () => {
  assert.equal(fixedPositionReason(false, { environment: 'indoor', observedAt: now - 30000 }, now), '推論室內');
  assert.equal(fixedPositionReason(false, { environment: 'window', observedAt: now }, now), null);
  assert.equal(fixedPositionReason(false, { environment: 'indoor', observedAt: now - 120001 }, now), null);
  assert.equal(fixedPositionReason(true, null, now), '充電中');
  assert.equal(fixedPositionReason(true, null, now, false), '充電中');
});
test('expired fixed location keeps the last displayed position and timestamp without inventing fresh data', () => {
  const previous = [{ id: 108, masterId: 5, position: [24, 121], lastPositionAt: now - 240000, fixedName: '家' }];
  const current = [{ id: 108, masterId: 5, position: null, lastPositionAt: null, stale: true }];
  const dog = retainDogPositions(current, previous, now)[0];
  assert.deepEqual(dog.position, [24, 121]);
  assert.equal(dog.lastPositionAt, now - 240000); assert.equal(dog.stale, true);
  assert.equal(dog.retained, true);
  assert.equal(retainDogPositions([], previous, now)[0].stale, true);
  assert.equal(retainDogPositions(current, [], now)[0].position, null);
  const disabled = retainDogPositions(current, [{ ...previous[0], positionSource: 'fixed' }], now, true)[0];
  assert.deepEqual(disabled.position, [24, 121]); assert.equal(disabled.lastDisplayed, true);
  assert.equal(disabled.stale, true);
  const fresh = { ...current[0], position: [25, 122], lastPositionAt: now, stale: false };
  assert.deepEqual(retainDogPositions([fresh], previous, now)[0].position, [25, 122]);
});
test('fixed locations load before telemetry Master discovery and report failures', async () => {
  const settings = [4, 6, 8, 108].map(slave_id => ({ slave_id, master_id: 5, enabled: true, latitude: 24, longitude: 121 }));
  let failure = null;
  const client = { from(table) {
    assert.equal(table, 'slave_fixed_locations');
    return { select() { return { abortSignal: async () => ({ data: settings, error: failure }) }; } };
  } };
  const signal = new AbortController().signal;
  assert.deepEqual((await readFixedLocations(client, [], signal)).locations, settings);
  failure = { message: 'network unavailable' };
  assert.ok((await readFixedLocations(client, null, signal)).warning);
});
function raw(time, values = {}, slaveId = 2, masterId = 5, id = '00000000-0000-4000-8000-000000000001') {
  return { event_id: id, master_id: masterId, slave_id: slaveId, received_at: new Date(time).toISOString(),
    payload: { lat: 25033000, lon: 121565000, speed: 1250, hdop: 150, activityScore: 650, activityValid: 1,
      batteryPercentage: 82, batteryValid: 1, satellites: 9, ...values }, rssi: -91, snr: 5 };
}

test('firmware units and phone relay time match DogTracker', () => {
  const row = parseTelemetry({ ...raw(now), upload_source: 'phone', phone_received_at: new Date(now - 300000).toISOString() });
  assert.equal(row.slave_lat, 25.033); assert.equal(row.slave_lon, 121.565);
  assert.equal(row.speed_kmh, 12.5); assert.equal(row.hdop, 1.5); assert.equal(row.activity, 0.65);
  assert.equal(row.track_at, now - 300000); assert.equal(row.usb_present, null);
});

test('latest packet has no fix: keep previous coordinate but current battery and unknown speed', () => {
  const older = parseTelemetry(raw(now - 30000));
  const latest = parseTelemetry(raw(now, { lat: 0, lon: 0, batteryPercentage: 63 }, 2, 7, '00000000-0000-4000-8000-000000000002'));
  const dogs = buildDogs([older, latest], [], now);
  assert.equal(dogs.length, 1); assert.deepEqual(dogs[0].position, [25.033, 121.565]);
  assert.equal(dogs[0].masterId, 7); assert.equal(dogs[0].battery, 63); assert.equal(dogs[0].speed, null);
  assert.equal(dogs[0].retained, true); assert.equal(dogs[0].stale, true);
  assert.equal(dogs[0].lastPositionAt, now - 30000);
});

test('never invent a location or show invalid battery; staleness and 24h retention', () => {
  assert.equal(coordinate(0, 0), null); assert.equal(coordinate(100, 120), null);
  const noFix = buildDogs([parseTelemetry(raw(now, { lat: 0, lon: 0, batteryValid: 0 }))], [], now)[0];
  assert.equal(noFix.position, null); assert.equal(noFix.battery, null); assert.equal(noFix.stale, true);
  assert.equal(buildDogs([parseTelemetry(raw(now - 181000))], [], now)[0].stale, true);
  assert.equal(buildDogs([parseTelemetry(raw(now - DAY - 1))], [], now).length, 0);
});

test('fixed charging position requires explicit USB reading and enabled setting', () => {
  const settings = [{ slave_id: 2, enabled: true, latitude: 24, longitude: 121, name: '基地' }];
  const charging = buildDogs([parseTelemetry(raw(now, { usbPresent: true }))], settings, now)[0];
  assert.deepEqual(charging.position, [24, 121]); assert.equal(charging.speed, null);
  const unknown = buildDogs([parseTelemetry(raw(now))], settings, now)[0];
  assert.deepEqual(unknown.position, [25.033, 121.565]);
});

test('enabled saved position without GPS is explicitly unconfirmed and stale', () => {
  const rows = [parseTelemetry(raw(now - 240000, { lat: 0, lon: 0 }))];
  const settings = [{ slave_id: 2, enabled: true, latitude: 24, longitude: 121, name: '家' }];
  const dog = buildDogs(rows, settings, now)[0];
  assert.equal(dog.position, null); assert.equal(dog.stale, true);
  assert.equal(dog.savedFallback, false); assert.equal(dog.lastPositionAt, null);
  assert.equal(dog.fixedReason, null);
  assert.equal(buildDogs(rows, [], now)[0].position, null);
  assert.equal(buildDogs(rows, [{ ...settings[0], enabled: false }], now)[0].position, null);
});

test('route breaks at missing fixes, long gaps and changes of Master', () => {
  const rows = [parseTelemetry(raw(now - 300000)), parseTelemetry(raw(now - 290000)),
    parseTelemetry(raw(now - 280000, { lat: 0, lon: 0 })), parseTelemetry(raw(now - 270000)),
    parseTelemetry(raw(now - 260000, {}, 2, 7)), parseTelemetry(raw(now))];
  const route = buildRoutes(rows)[0];
  assert.deepEqual(route.segments.map(segment => segment.length), [2, 1, 1, 1]);
});

test('activity gaps stay null and invalid measurements are excluded', () => {
  const values = activityHistory([parseTelemetry(raw(now - 1000)), parseTelemetry(raw(now - 5000, { activityValid: 0 })),
    parseTelemetry(raw(now - 10000, { activityScore: 1100 }))], 2, now);
  assert.equal(values.length, 1440); assert.equal(values[0].value, null);
  assert.equal(values.at(-2).value, 0.65); assert.equal(values.at(-2).count, 1);
});

test('Taiwan date ranges and bounded histories', () => {
  const range = dateRange('2026-10-08', '2026-10-09', now);
  assert.equal(new Date(range.start).toISOString(), '2026-10-07T16:00:00.000Z'); assert.equal(range.end, now);
  assert.throws(() => dateRange('2026-02-30', '2026-03-01', now));
  assert.throws(() => dateRange('2026-10-01', '2026-10-09', now));
});

test('cloud pagination preserves cursor microseconds and does not stop on a short server page', async () => {
  const first = { ...raw(now - 1000), received_at: '2026-10-09T04:29:59.123456Z' };
  const second = raw(now - 500, {}, 2, 5, '00000000-0000-4000-8000-000000000002');
  const responses = [[first], [second], []], filters = [];
  let calls = 0;
  const client = { from(name) {
    assert.equal(name, 'dog_telemetry');
    const query = {};
    for (const method of ['select', 'in', 'gte', 'lt', 'order', 'limit']) query[method] = () => query;
    query.or = value => { filters.push(value); return query; };
    query.abortSignal = async () => ({ data: responses[calls++], error: null });
    return query;
  } };
  const rows = await fetchTelemetry({ client, masterIds: [5], start: now - 60000, end: now, signal: new AbortController().signal });
  assert.equal(rows.length, 2); assert.equal(calls, 3); assert.match(filters[0], /04:29:59\.123456Z/);
  assert.equal(mergeRows(rows, [rows[0]], now).length, 2);
});

test('newest-first sync publishes a page before fetching older data and preserves it on failure', async () => {
  const latest = { ...raw(now - 1000), received_at: '2026-10-09T04:29:59.123456Z' };
  const pages = [], filters = [], orders = [];
  let calls = 0;
  const client = { from() {
    const query = {};
    for (const method of ['select', 'in', 'gte', 'lt', 'limit']) query[method] = () => query;
    query.order = (field, options) => { orders.push(options.ascending); return query; };
    query.or = value => { filters.push(value); return query; };
    query.abortSignal = async () => {
      if (calls++ === 0) return { data: [latest], error: null };
      assert.equal(pages.length, 1);
      return { data: null, error: { message: 'interrupted' } };
    };
    return query;
  } };
  await assert.rejects(fetchTelemetry({ client, masterIds: [5], start: now - DAY, end: now,
    signal: new AbortController().signal, newestFirst: true, onPage: page => pages.push(page) }));
  assert.equal(pages[0][0].id, latest.event_id);
  assert.ok(orders.every(ascending => ascending === false));
  assert.match(filters[0], /received_at\.lt\.2026-10-09T04:29:59\.123456Z/);
  assert.match(filters[0], /event_id\.lt\./);
});
