import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

async function load(file) {
  const result = buildSync({ entryPoints: [file], bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { parseTelemetry, buildDogs, buildRoutes, activityHistory, coordinate, DAY } = await load('src/tracking/telemetry.js');
const { dateRange, fetchTelemetry, mergeRows, readFixedLocations } = await load('src/tracking/cloud.js');
const now = Date.parse('2026-10-09T04:30:00Z');
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
  assert.equal(dogs[0].retained, true); assert.equal(dogs[0].stale, false);
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
