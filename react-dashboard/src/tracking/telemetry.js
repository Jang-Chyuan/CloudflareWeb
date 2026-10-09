import { predictEnvironment } from '../ml/Environment';

export const DAY = 86400000;
export const LIVE_WINDOW = 180000;
const numeric = (value, divisor = 1) => typeof value === 'number' && Number.isFinite(value) ? value / divisor : null;

export function coordinate(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)
    ? [lat, lon] : null;
}

// Same units and corrected observation time as DogTracker/CloudTelemetry.js.
// upload_source=phone means a relayed collar packet, not the phone's own GPS.
export function parseTelemetry(row) {
  const p = row.payload;
  if (!p || typeof p !== 'object' || Array.isArray(p) || !Number.isInteger(row.slave_id) || !Number.isInteger(row.master_id)
    || !/^[0-9a-f-]{36}$/i.test(row.event_id ?? '') || !Number.isFinite(Date.parse(row.received_at))) {
    throw new Error('雲端封包格式不正確，請確認 dog_telemetry 資料。');
  }
  const phoneTime = Date.parse(row.phone_received_at);
  return {
    id: row.event_id, master_id: row.master_id, slave_id: row.slave_id,
    received_at: Date.parse(row.received_at),
    track_at: row.upload_source === 'phone' && Number.isFinite(phoneTime) ? phoneTime : Date.parse(row.received_at),
    slave_lat: numeric(p.lat, 1e6), slave_lon: numeric(p.lon, 1e6),
    speed_kmh: numeric(p.speed, 100), satellites: numeric(p.satellites), hdop: numeric(p.hdop, 100),
    activity: numeric(p.activityScore, 1000), activity_valid: p.activityValid === 1 || p.activityValid === true,
    battery_percentage: numeric(p.batteryPercentage), battery_valid: p.batteryValid === 1 || p.batteryValid === true,
    usb_present: p.usbPresent === 1 || p.usbPresent === true ? 1 : p.usbPresent === 0 || p.usbPresent === false ? 0 : null,
    rssi: numeric(row.rssi), snr: numeric(row.snr), seq: row.seq,
    gps_time: p.gpsTimestamp ?? null, raw: row,
  };
}

export function environments(rows, now) {
  const buckets = new Map();
  for (const row of rows) {
    const bucket = Math.floor(row.track_at / 120000) * 120000;
    if (bucket + 120000 > now || now - bucket > 600000) continue;
    const key = `${row.master_id}:${row.slave_id}:${bucket}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }
  const latest = new Map();
  for (const group of buckets.values()) {
    const result = predictEnvironment(group);
    const id = group[0].slave_id;
    if (!latest.has(id) || latest.get(id).observedAt < result.observedAt) latest.set(id, result);
  }
  return latest;
}

export function buildDogs(rows, fixedLocations = [], now = Date.now()) {
  const groups = new Map();
  for (const row of rows) {
    if (row.track_at > now || now - row.track_at > DAY) continue;
    if (!groups.has(row.slave_id)) groups.set(row.slave_id, []);
    groups.get(row.slave_id).push(row);
  }
  const results = environments(rows, now);
  return [...groups].map(([id, samples]) => {
    samples.sort((a, b) => b.track_at - a.track_at || b.received_at - a.received_at || b.id.localeCompare(a.id));
    const packet = samples[0];
    const lastFix = samples.find(row => coordinate(row.slave_lat, row.slave_lon));
    const environment = results.get(id) ?? null;
    const setting = fixedLocations.find(value => value.slave_id === id && value.enabled);
    const charging = packet.usb_present === 1;
    const recentEnvironment = environment && now - environment.observedAt >= 0 && now - environment.observedAt <= 120000;
    const reason = charging ? '充電（USB 已連接）' : recentEnvironment ? { indoor: '室內', window: '窗邊' }[environment.environment] : null;
    const communicating = now - packet.track_at <= LIVE_WINDOW;
    const fixed = setting && coordinate(setting.latitude, setting.longitude) && reason && (communicating || charging) ? setting : null;
    const noFix = !coordinate(packet.slave_lat, packet.slave_lon);
    const position = fixed ? coordinate(fixed.latitude, fixed.longitude) : lastFix ? coordinate(lastFix.slave_lat, lastFix.slave_lon) : null;
    return {
      id, masterId: packet.master_id, packet, position, environment,
      lastPacketAt: packet.track_at, lastPositionAt: fixed ? packet.track_at : lastFix?.track_at ?? null,
      retained: !fixed && noFix && !!lastFix,
      stale: !position || (!communicating && !(fixed && charging)),
      status: !communicating ? '未收到新資料' : noFix && !fixed ? '有通訊／GPS 未定位' : '有通訊／定位正常',
      speed: fixed || noFix ? null : packet.speed_kmh,
      battery: packet.battery_valid ? packet.battery_percentage : null,
      fixedName: fixed?.name, fixedReason: fixed ? reason : null,
    };
  }).sort((a, b) => a.id - b.id);
}

// Never bridge missing fixes, a >2 minute gap, or a change of Master.
export function buildRoutes(rows, startAt = -Infinity, endAt = Infinity) {
  const groups = new Map();
  for (const row of rows) {
    if (row.track_at < startAt || row.track_at > endAt) continue;
    if (!groups.has(row.slave_id)) groups.set(row.slave_id, []);
    groups.get(row.slave_id).push(row);
  }
  return [...groups].map(([id, samples]) => {
    samples.sort((a, b) => a.track_at - b.track_at || a.id.localeCompare(b.id));
    const segments = [];
    let segment = [], previous = null, window = [];
    const finish = () => { if (segment.length) segments.push(segment); segment = []; window = []; };
    for (const row of samples) {
      const point = coordinate(row.slave_lat, row.slave_lon);
      if (!point) { finish(); previous = null; continue; }
      if (previous && (row.track_at - previous.track_at > 120000 || row.master_id !== previous.master_id
        || Math.abs(row.slave_lon - previous.slave_lon) > 180)) finish();
      window.push(point);
      if (window.length > 3) window.shift();
      const fast = row.speed_kmh > 10 && window.length > 1;
      const smoothed = window.reduce((sum, value, index) => {
        const weight = fast ? index === window.length - 1 ? 0.9 : 0.1 / (window.length - 1) : 1 / window.length;
        return [sum[0] + value[0] * weight, sum[1] + value[1] * weight];
      }, [0, 0]);
      segment.push(smoothed);
      previous = row;
    }
    finish();
    return { id, segments };
  });
}

export function activityHistory(rows, id, now) {
  const start = Math.floor(now / 60000) * 60000 - 1439 * 60000;
  const minutes = new Map();
  for (const row of rows) {
    if (row.slave_id !== id || !row.activity_valid || row.activity == null || row.activity < 0 || row.activity > 1
      || row.track_at < start || row.track_at > now) continue;
    const time = Math.floor(row.track_at / 60000) * 60000;
    const value = minutes.get(time) ?? { sum: 0, count: 0 };
    value.sum += row.activity; value.count++;
    minutes.set(time, value);
  }
  return Array.from({ length: 1440 }, (_, i) => {
    const time = start + i * 60000, value = minutes.get(time);
    return { time, value: value ? value.sum / value.count : null, count: value?.count ?? 0 };
  });
}

export function formatTime(value) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(value);
}

export const dogColor = id => ['#E85F5C', '#397E9B', '#247A61', '#AC7B24', '#8B63A9', '#D17947'][(id - 1) % 6];
export const dogName = (id, aliases) => aliases[id]?.trim() ? `${aliases[id].trim()}（Slave ${id}）` : `狗 ${id}`;
