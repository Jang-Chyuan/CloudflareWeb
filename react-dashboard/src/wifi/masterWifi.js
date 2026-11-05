export const WIFI_SERVICE_UUID = '7f510001-6d9e-4e2f-a671-8f3f2d49a001';
export const WIFI_CHARACTERISTIC_UUID = '7f510003-6d9e-4e2f-a671-8f3f2d49a001';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const fault = code => Object.assign(new Error(code), { wifiCode: code });
export function wifiSupport(env = globalThis) {
  if (!env.isSecureContext) return '請使用 HTTPS 或 localhost 開啟配網頁面。';
  if (!env.navigator?.bluetooth?.requestDevice) return '此瀏覽器不支援 Web Bluetooth，請使用具備藍牙功能的 Chrome 或 Edge；iPhone／iPad 可改用原生配網 App。';
  return '';
}
export function wifiMessage(error) {
  const messages = {
    disconnected: 'Master 已斷線，請重新連線。', timeout: '藍牙操作逾時，已中斷連線，請重新連線。',
    invalid_ssid: 'SSID 必須為 1–32 個 UTF-8 位元組。', invalid_password: '密碼不可超過 63 個 UTF-8 位元組。',
    too_long: '名稱與密碼組合超過裝置的 160 位元組限制，請縮短後再送出。',
    invalid_reply: 'Master 回覆格式不符，請確認韌體支援 Wi-Fi 配網。',
    scan_unsupported: '此 Master 韌體尚未支援附近 Wi-Fi 掃描，請更新韌體；仍可手動輸入 SSID。',
    scan_failed: 'Master 掃描失敗，請稍後重試或手動輸入 SSID。',
    scan_stale: '掃描結果已變更，請重新掃描。', scan_timeout: '等待掃描結果逾時，請稍後重新掃描。',
    queue_unavailable: 'Master 正忙或無法受理設定，請稍後重試。', invalid_credential: 'Master 拒絕此 Wi-Fi 設定，請檢查名稱與密碼。',
  };
  if (messages[error?.wifiCode]) return messages[error.wifiCode];
  if (error?.name === 'NotFoundError') return '未選擇裝置，或裝置沒有 Wi-Fi 配網服務。';
  if (error?.name === 'SecurityError' || error?.name === 'NotAllowedError') return '未取得藍牙權限，請由配網按鈕重新選擇裝置。';
  return '藍牙操作失敗，請靠近 Master、關閉其他 App 的 BLE 連線後再試。';
}
export function encodeWifiCommand(command) {
  if (command.action === 'upsert' || command.action === 'remove') {
    if (typeof command.ssid !== 'string' || !encoder.encode(command.ssid).length || encoder.encode(command.ssid).length > 32) throw fault('invalid_ssid');
  }
  if (command.action === 'upsert' && (typeof command.password !== 'string' || encoder.encode(command.password).length > 63)) throw fault('invalid_password');
  const bytes = encoder.encode(JSON.stringify(command));
  if (bytes.length > 160) throw fault('too_long');
  return bytes;
}
export class MasterWifiClient {
  constructor({ bluetooth = globalThis.navigator?.bluetooth, onDisconnect = () => {}, timeoutMs = 12000, scanTimeoutMs = 45000, scanPollMs = 300 } = {}) {
    this.bluetooth = bluetooth; this.onDisconnect = onDisconnect; this.timeoutMs = timeoutMs; this.scanTimeoutMs = scanTimeoutMs; this.scanPollMs = scanPollMs;
    this.epoch = 0; this.tail = Promise.resolve(); this.device = null; this.characteristic = null;
    this.lost = () => { this.characteristic = null; this.epoch++; this.onDisconnect(); };
  }
  async timed(promise) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => { this.disconnect(); this.onDisconnect(); reject(fault('timeout')); }, this.timeoutMs); })]); }
    finally { clearTimeout(timer); }
  }
  check(epoch) { if (epoch !== this.epoch || !this.device?.gatt?.connected) throw fault('disconnected'); }
  async connect() {
    this.disconnect(); const epoch = this.epoch;
    // requestDevice is called before the first await, preserving user activation.
    const device = await this.bluetooth.requestDevice({ filters: [{ services: [WIFI_SERVICE_UUID] }] });
    if (epoch !== this.epoch) throw fault('disconnected');
    this.device = device; device.addEventListener('gattserverdisconnected', this.lost);
    try {
      const pending = device.gatt.connect();
      pending.then(() => { if (epoch !== this.epoch) device.gatt.disconnect(); }, () => {});
      const server = await this.timed(pending); this.check(epoch);
      const service = await this.timed(server.getPrimaryService(WIFI_SERVICE_UUID)); this.check(epoch);
      this.characteristic = await this.timed(service.getCharacteristic(WIFI_CHARACTERISTIC_UUID)); this.check(epoch);
      return device.name || 'DogTracker Master';
    } catch (error) { this.disconnect(); throw error; }
  }
  disconnect() {
    this.epoch++; this.characteristic = null;
    if (this.device) { this.device.removeEventListener('gattserverdisconnected', this.lost); this.device.gatt.disconnect(); this.device = null; }
  }
  run(operation) {
    const epoch = this.epoch;
    const result = this.tail.then(() => { this.check(epoch); return operation(epoch); });
    this.tail = result.catch(() => {}); return result;
  }
  async exchange(command, epoch) {
    this.check(epoch); const characteristic = this.characteristic;
    if (!characteristic) throw fault('disconnected');
    const bytes = encodeWifiCommand(command);
    await this.timed(characteristic.writeValueWithResponse(bytes)); this.check(epoch);
    const value = await this.timed(characteristic.readValue()); this.check(epoch);
    let reply;
    try { reply = JSON.parse(decoder.decode(value)); } catch { throw fault('invalid_reply'); }
    if (reply?.ok !== true) {
      if (['scan', 'scan_results'].includes(command.action) && reply?.error === 'invalid_action') throw fault('scan_unsupported');
      throw fault(['queue_unavailable', 'invalid_credential', 'scan_stale'].includes(reply?.error) ? reply.error : 'invalid_reply');
    }
    return reply;
  }
  list() {
    return this.run(async epoch => {
      let offset = 0, active = ''; const ssids = [], seen = new Set();
      for (;;) {
        if (seen.has(offset) || seen.size > 10) throw fault('invalid_reply');
        seen.add(offset);
        const reply = await this.exchange({ action: 'list', offset }, epoch);
        if (!Array.isArray(reply.ssids) || reply.ssids.length > 2 || reply.ssids.some(x => typeof x !== 'string' || !encoder.encode(x).length || encoder.encode(x).length > 32) || typeof reply.active !== 'string' || encoder.encode(reply.active).length > 32) throw fault('invalid_reply');
        ssids.push(...reply.ssids); active = reply.active;
        if (ssids.length > 10) throw fault('invalid_reply');
        if (reply.next === null) return { ssids: [...new Set(ssids)], active };
        if (!Number.isInteger(reply.next) || reply.next <= offset || reply.next > 10) throw fault('invalid_reply');
        offset = reply.next;
      }
    });
  }
  scan() {
    return this.run(async epoch => {
      const accepted = await this.exchange({ action: 'scan' }, epoch);
      const id = accepted.scan_id;
      if (accepted.status !== 'accepted' || !Number.isInteger(id) || id < 1 || id > 4294967295) throw fault('invalid_reply');
      const deadline = Date.now() + this.scanTimeoutMs;
      let offset = 0, total = null, truncated = false; const networks = [], names = new Set();
      for (;;) {
        if (Date.now() >= deadline) throw fault('scan_timeout');
        const reply = await this.exchange({ action: 'scan_results', scan_id: id, offset }, epoch);
        if (reply.scan_id !== id) throw fault('scan_stale');
        if (reply.status === 'pending') { await new Promise(resolve => setTimeout(resolve, this.scanPollMs)); this.check(epoch); continue; }
        if (reply.status === 'failed') throw fault('scan_failed');
        if (reply.status !== 'ready' || !Number.isInteger(reply.total) || reply.total < 0 || reply.total > 20 || typeof reply.truncated !== 'boolean' || !Array.isArray(reply.networks)) throw fault('invalid_reply');
        if (total !== null && (reply.total !== total || reply.truncated !== truncated)) throw fault('scan_stale');
        total = reply.total; truncated = reply.truncated;
        if (reply.networks.length !== (total ? 1 : 0) || offset > total) throw fault('invalid_reply');
        for (const ap of reply.networks) {
          if (typeof ap?.ssid !== 'string' || !encoder.encode(ap.ssid).length || encoder.encode(ap.ssid).length > 32 || !Number.isInteger(ap.rssi) || ap.rssi < -128 || ap.rssi > 0 || typeof ap.secure !== 'boolean' || names.has(ap.ssid)) throw fault('invalid_reply');
          names.add(ap.ssid); networks.push({ ssid: ap.ssid, rssi: ap.rssi, secure: ap.secure });
        }
        const expectedNext = offset + 1 < total ? offset + 1 : null;
        if (reply.next !== expectedNext) throw fault('invalid_reply');
        if (reply.next === null) {
          if (networks.length !== total) throw fault('invalid_reply');
          return { networks: networks.sort((a, b) => b.rssi - a.rssi), truncated };
        }
        offset = reply.next;
      }
    });
  }
  upsert(ssid, password) { return this.run(epoch => this.exchange({ action: 'upsert', ssid, password }, epoch)); }
  remove(ssid) { return this.run(epoch => this.exchange({ action: 'remove', ssid }, epoch)); }
}
