
export const DAY = 86400000;
export const LIVE_WINDOW = 35 * 60000;
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

export function buildDogs(rows, fixedLocations = [], now = Date.now(), historicalFixes = []) {
  const groups = new Map();
  for (const row of rows) {
    if (row.track_at > now || now - row.track_at > DAY) continue;
    if (!groups.has(row.slave_id)) groups.set(row.slave_id, []);
    groups.get(row.slave_id).push(row);
  }
  return [...groups].map(([id, samples]) => {
    samples.sort((a, b) => b.track_at - a.track_at || b.received_at - a.received_at || b.id.localeCompare(a.id));
    const packet = samples[0];
    const lastFix = samples.find(row => coordinate(row.slave_lat, row.slave_lon))
      ?? historicalFixes.find(row => row.slave_id === id && row.track_at <= now && coordinate(row.slave_lat, row.slave_lon));
    const charging = packet.usb_present === 1;
    const communicating = now - packet.track_at <= LIVE_WINDOW;
    const noFix = !coordinate(packet.slave_lat, packet.slave_lon);
    const savedFallback = null;
    const position = lastFix ? coordinate(lastFix.slave_lat, lastFix.slave_lon) : null;
    return {
      id, masterId: packet.master_id, packet, position,
      gpsLastPositionAt: lastFix?.track_at ?? null,
      lastPacketAt: packet.track_at, lastPositionAt: lastFix?.track_at ?? null,
      charging,
      retained: noFix && !!lastFix,
      savedFallback: !!savedFallback,
      stale: noFix || !!savedFallback || !position || !communicating || now - (lastFix?.track_at ?? 0) > LIVE_WINDOW,
      status: !communicating ? '未收到新資料' : noFix ? '有通訊／GPS 未定位' : '有通訊／定位正常',
      speed: noFix ? null : packet.speed_kmh,
      battery: packet.battery_valid ? packet.battery_percentage : null,
      fixedReason: null,
      positionSource: 'gps',
    };
  }).sort((a, b) => a.id - b.id);
}

export function positionLabel(dog, now = Date.now()) {
  const state = positionDisplayState(dog, now);
  if (state === 'retained') return `顯示最後有效位置，${formatTime(dog.lastPositionAt)}`;
  if (state === 'unavailable') return '尚無有效定位';
  if (state === 'expired') return `× 未更新／最後顯示位置，${Number.isFinite(dog.lastPositionAt) ? formatTime(dog.lastPositionAt) : '時間未知'}${dog.fixedReason ? `／${dog.fixedReason}` : ''}`;
  return '';
}

export function retainDogPositions(dogs, previous, now) {
  const old = new Map(previous.filter(dog => dog.positionSource !== 'fixed').map(dog => [dog.id, dog]));
  const current = dogs.map(dog => {
    const cached = old.get(dog.id);
    old.delete(dog.id);
    if (!cached?.position || (dog.position && dog.lastPositionAt >= cached.lastPositionAt)) return dog;
    return { ...dog, position: cached.position, lastPositionAt: cached.lastPositionAt,
      positionSource: cached.positionSource,
      retained: true, savedFallback: false,
      lastDisplayed: true,
      stale: dog.stale || now - cached.lastPositionAt > LIVE_WINDOW, speed: null,
      fixedReason: null };
  });
  for (const dog of old.values()) {
    if (dog.position) current.push({ ...dog, stale: true, retained: true, lastDisplayed: true, charging: false, speed: null, status: '未收到新資料', fixedReason: null });
  }
  return current.sort((a, b) => a.id - b.id);
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
    const sections = [], points = [], seen = new Set();
    let section = null, previous = null;
    const finish = () => { section = null; };
    for (const row of samples) {
      const key = `${row.id}:${row.track_at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const point = coordinate(row.slave_lat, row.slave_lon);
      if (!point) { finish(); previous = null; continue; }
      points.push({ position: point, time: row.track_at });
      const gap = previous ? row.track_at - previous.track_at : 0;
      // Cadence describes sampling, not a confirmed device mode. A missing fix,
      // skipped scheduled report or Master switch must never be bridged.
      const kind = gap > 0 && gap <= 120000 ? 'tracking'
        : gap >= 20 * 60000 && gap <= 35 * 60000 ? 'scheduled' : null;
      if (!previous || !kind || row.master_id !== previous.master_id
        || Math.abs(row.slave_lon - previous.slave_lon) > 180) finish();
      else {
        if (!section || section.kind !== kind) {
          section = { kind, points: [coordinate(previous.slave_lat, previous.slave_lon)], distanceMeters: 0 };
          sections.push(section);
        }
        section.points.push(point);
        section.distanceMeters += gpsDistance(coordinate(previous.slave_lat, previous.slave_lon), point);
      }
      previous = row;
    }
    // Keep endpoints exact. Only soften tiny interior deviations in dense tracks;
    // sharp turns and all sparse scheduled coordinates remain untouched.
    for (const part of sections) if (part.kind === 'tracking') {
      const original = part.points;
      part.points = original.map((point, index) => {
        if (!index || index === original.length - 1) return point;
        const before = original[index - 1], after = original[index + 1];
        const mid = [(before[0] + after[0]) / 2, (before[1] + after[1]) / 2];
        if (gpsDistance(point, mid) > 5) return point;
        return [point[0] * 0.8 + mid[0] * 0.2, point[1] * 0.8 + mid[1] * 0.2];
      });
    }
    return { id, points, sections, segments: sections.map(part => part.points),
      trackingMeters: sections.filter(part => part.kind === 'tracking').reduce((sum, part) => sum + part.distanceMeters, 0),
      scheduledMeters: sections.filter(part => part.kind === 'scheduled').reduce((sum, part) => sum + part.distanceMeters, 0) };
  });
}

function gpsDistance(a, b) {
  const rad = Math.PI / 180;
  const value = Math.sin((b[0] - a[0]) * rad / 2) ** 2
    + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin((b[1] - a[1]) * rad / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, value)));
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
export const dogName = (id, aliases) => aliases[id]?.trim() ? `${aliases[id].trim()}(${id})` : `狗 ${id}`;

// Map presentation distinguishes a retained recent fix from an expired position.
export function positionDisplayState(dog, now = Date.now()) {
  if (!dog.position || !Number.isFinite(dog.lastPositionAt)) return 'unavailable';
  if (now - dog.lastPositionAt > LIVE_WINDOW) return 'expired';
  return dog.retained || dog.lastDisplayed || dog.stale ? 'retained' : 'current';
}
