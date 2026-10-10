import { parseTelemetry, DAY } from './telemetry';

const FIELDS = 'event_id,master_id,slave_id,seq,received_at,payload,rssi,snr,upload_source,phone_received_at';
export async function listMasters(client, owner, signal) {
  const masters = new Set();
  for (let offset = 0; ; ) {
    const { data, error } = await client.from('device_members').select('gateway_id,slave_id').eq('user_id', owner)
      .order('gateway_id').order('slave_id').range(offset, offset + 499).abortSignal(signal);
    if (error) throw new Error('無法讀取 Master 授權，請確認登入及 device_members 讀取權限。');
    if (!data?.length) return [...masters].sort((a, b) => a - b);
    for (const row of data) {
      const match = /^master_(\d+)$/.exec(row.gateway_id);
      if (match) masters.add(Number(match[1]));
    }
    offset += data.length;
  }
}

// Page until empty: Supabase can impose a limit below the requested page size.
// Keep timestamp microseconds and UUID in the cursor rather than using offsets.
export async function fetchTelemetry({ client, masterIds, start, end, signal, onProgress = () => {} }) {
  if (!masterIds.length) return [];
  const records = [];
  const seen = new Set();
  let cursor = null;
  for (;;) {
    if (signal.aborted) throw new DOMException('已取消', 'AbortError');
    let query = client.from('dog_telemetry').select(FIELDS).in('master_id', masterIds)
      .gte('received_at', new Date(start).toISOString()).lt('received_at', new Date(end).toISOString())
      .order('received_at').order('event_id').limit(1000);
    if (cursor) query = query.or(`received_at.gt.${cursor.time},and(received_at.eq.${cursor.time},event_id.gt.${cursor.id})`);
    const { data, error } = await query.abortSignal(signal);
    if (error) throw new Error('無法讀取犬隻資料，請確認網路及 dog_telemetry 讀取權限。');
    if (!data?.length) return records;
    for (const raw of data) {
      const record = parseTelemetry(raw);
      if (!seen.has(record.id)) { seen.add(record.id); records.push(record); }
    }
    const last = data[data.length - 1];
    if (cursor?.time === last.received_at && cursor?.id === last.event_id) throw new Error('資料分頁未前進，已停止讀取。');
    cursor = { time: last.received_at, id: last.event_id };
    if (records.length > 250000) throw new Error('查詢資料超過 25 萬筆，請縮小日期範圍或選擇單一 Master。');
    onProgress(records.length);
  }
}

export async function readFixedLocations(client, masterIds, signal) {
  // RLS limits rows to this account's authorized Masters, as in DogTracker.
  const { data, error } = await client.from('slave_fixed_locations')
    .select('slave_id,master_id,name,latitude,longitude,enabled,updated_at').abortSignal(signal);
  return error ? { locations: [], warning: '固定位置設定讀取失敗；保留上次成功讀取的設定。' } : { locations: data ?? [], warning: '' };
}

export function mergeRows(old, incoming, now) {
  const rows = new Map(old.map(row => [row.id, row]));
  for (const row of incoming) rows.set(row.id, row);
  return [...rows.values()].filter(row => row.track_at >= now - DAY && row.track_at <= now)
    .sort((a, b) => a.track_at - b.track_at || a.id.localeCompare(b.id));
}

export function dateRange(startDate, endDate, now = Date.now()) {
  const parse = date => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('請選擇有效日期。');
    const time = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) throw new Error('日期不存在。');
    return time - 8 * 3600000;
  };
  const start = parse(startDate), last = parse(endDate);
  if (last < start || start >= now) throw new Error('請選擇有效的過去日期範圍。');
  if (last - start >= 7 * DAY) throw new Error('每次最多查詢 7 天。');
  return { start, end: Math.min(last + DAY, now) };
}
