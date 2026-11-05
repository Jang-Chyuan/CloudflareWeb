import test from 'node:test';
import assert from 'node:assert/strict';
import { MasterWifiClient, encodeWifiCommand, wifiMessage, wifiSupport, WIFI_SERVICE_UUID, WIFI_CHARACTERISTIC_UUID } from '../src/wifi/masterWifi.js';
function fixture(respond = command => command.action === 'list' ? { ok: true, ssids: [], active: '', next: null } : { ok: true, status: 'accepted' }, timeoutMs, scanOptions = {}) {
  const calls = []; let latest, inFlight = false;
  const characteristic = {
    async writeValueWithResponse(bytes) { assert.equal(inFlight, false, 'GATT exchanges must be serial'); inFlight = true; latest = JSON.parse(new TextDecoder().decode(bytes)); calls.push(latest); },
    async readValue() { const reply = await respond(latest); inFlight = false; const bytes = new TextEncoder().encode(JSON.stringify(reply)); return new DataView(bytes.buffer); },
  };
  const device = Object.assign(new EventTarget(), { name: 'DogGPS-Master201', gatt: { connected: false,
    async connect() { this.connected = true; return { getPrimaryService: async uuid => { assert.equal(uuid, WIFI_SERVICE_UUID); return { getCharacteristic: async uuid => { assert.equal(uuid, WIFI_CHARACTERISTIC_UUID); return characteristic; } }; } }; },
    disconnect() { this.connected = false; },
  } });
  const bluetooth = { requestDevice: async options => { assert.deepEqual(options.filters, [{ services: [WIFI_SERVICE_UUID] }]); return device; } };
  return { client: new MasterWifiClient({ bluetooth, timeoutMs, ...scanOptions }), device, calls };
}
test('Wi-Fi UTF8 and escaped JSON limits match firmware without trimming credentials', () => {
  assert.throws(() => encodeWifiCommand({ action: 'upsert', ssid: '狗'.repeat(11), password: 'secret' }), /invalid_ssid/);
  assert.throws(() => encodeWifiCommand({ action: 'upsert', ssid: 'net', password: 'é'.repeat(32) }), /invalid_password/);
  assert.throws(() => encodeWifiCommand({ action: 'upsert', ssid: '"'.repeat(32), password: '"'.repeat(63) }), /too_long/);
  const command = { action: 'upsert', ssid: ' net ', password: ' pass ' };
  assert.deepEqual(JSON.parse(new TextDecoder().decode(encodeWifiCommand(command))), command);
  assert.doesNotThrow(() => encodeWifiCommand({ action: 'upsert', ssid: 'open', password: '' }));
});
test('list pagination is bounded, independent of a later write, and preserves current SSID', async () => {
  const { client, calls } = fixture(c => c.action !== 'list' ? { ok: true, status: 'accepted' } : c.offset === 0 ? { ok: true, ssids: ['Home', 'Office'], active: 'Office', next: 2 } : { ok: true, ssids: ['狗屋'], active: 'Office', next: null });
  await client.connect();
  const [list, reply] = await Promise.all([client.list(), client.upsert('new', 'secret')]);
  assert.deepEqual(list, { ssids: ['Home', 'Office', '狗屋'], active: 'Office' });
  assert.deepEqual(calls.map(x => x.action), ['list', 'list', 'upsert']);
  assert.equal(reply.status, 'accepted'); client.disconnect();
});
test('malformed/looping list pages fail without presenting a partial successful list', async () => {
  for (const reply of [{ ok: true, ssids: ['x'], active: '', next: 0 }, { ok: true, ssids: 'secret', active: '', next: null }, { ok: true, ssids: [], active: 1, next: null }]) {
    const { client } = fixture(() => reply); await client.connect(); await assert.rejects(client.list(), /invalid_reply/); client.disconnect();
  }
});
test('device rejection is propagated, disconnect invalidates queued writes', async () => {
  const { client, device, calls } = fixture(() => ({ ok: false, error: 'queue_unavailable' }));
  await client.connect(); await assert.rejects(client.remove('Home'), /queue_unavailable/);
  const pending = client.upsert('Home', 'secret'); device.gatt.connected = false; device.dispatchEvent(new Event('gattserverdisconnected'));
  await assert.rejects(pending, /disconnected/); assert.equal(calls.length, 1); client.disconnect();
});
test('timeout closes transport and queued work cannot write after timeout', async () => {
  const { client, device, calls } = fixture(() => new Promise(() => {}), 20);
  await client.connect(); const a = client.list(), b = client.upsert('Home', 'secret');
  await assert.rejects(a, /timeout/); await assert.rejects(b, /disconnected/);
  assert.equal(device.gatt.connected, false); assert.equal(calls.length, 1);
});
test('cancelling chooser/closing component cannot connect a late chosen device', async () => {
  const { device } = fixture(); let choose;
  const client = new MasterWifiClient({ bluetooth: { requestDevice: () => new Promise(resolve => { choose = resolve; }) } });
  const pending = client.connect(); client.disconnect(); choose(device);
  await assert.rejects(pending, /disconnected/); assert.equal(device.gatt.connected, false);
});
test('capability messages and errors do not echo raw device or password content', () => {
  assert.match(wifiSupport({ isSecureContext: false }), /HTTPS/);
  assert.match(wifiSupport({ isSecureContext: true, navigator: {} }), /Chrome/);
  assert.equal(wifiSupport({ isSecureContext: true, navigator: { bluetooth: { requestDevice() {} } } }), '');
  assert.doesNotMatch(wifiMessage(new Error('password=private')), /private/);
});


test('scan waits for completion, reads an immutable paged snapshot and serializes writes', async () => {
  let polls=0;
  const { client, calls } = fixture(c => {
    if(c.action==='scan') return {ok:true,status:'accepted',scan_id:7};
    if(c.action==='upsert') return {ok:true,status:'accepted'};
    if(++polls===1) return {ok:true,status:'pending',scan_id:7};
    return {ok:true,status:'ready',scan_id:7,total:2,truncated:false,
      networks:[c.offset===0?{ssid:'Garden',rssi:-65,secure:true}:{ssid:'Guest',rssi:-35,secure:false}],next:c.offset===0?1:null};
  }, undefined, {scanPollMs:1});
  await client.connect();
  const [result] = await Promise.all([client.scan(),client.upsert('Home','secret')]);
  assert.deepEqual(result,{networks:[{ssid:'Guest',rssi:-35,secure:false},{ssid:'Garden',rssi:-65,secure:true}],truncated:false});
  assert.deepEqual(calls.map(c=>c.action),['scan','scan_results','scan_results','scan_results','upsert']);
  assert.deepEqual(calls.filter(c=>c.action==='scan_results').map(c=>[c.scan_id,c.offset]),[[7,0],[7,0],[7,1]]);
  client.disconnect();
});
test('old firmware scan error preserves manual credential configuration', async () => {
  const {client}=fixture(c=>c.action==='scan'?{ok:false,error:'invalid_action'}:{ok:true,status:'accepted'});
  await client.connect();await assert.rejects(client.scan(),/scan_unsupported/);
  assert.equal((await client.upsert('Manual','secret')).status,'accepted');client.disconnect();
});
test('scan validates snapshot ID, row data and monotonic pagination', async () => {
  const normal={ok:true,status:'ready',scan_id:8,total:1,truncated:false,networks:[{ssid:'AP',rssi:-50,secure:true}],next:null};
  for(const reply of [{...normal,scan_id:9},{...normal,next:0},{...normal,total:21},
    {...normal,networks:[{ssid:'AP',rssi:'-50',secure:true}]},{...normal,status:'failed'}]) {
    const {client}=fixture(c=>c.action==='scan'?{ok:true,status:'accepted',scan_id:8}:reply);
    await client.connect();await assert.rejects(client.scan(),/scan_stale|invalid_reply|scan_failed/);client.disconnect();
  }
});
test('empty scan is successful; pending scan has a bounded poll deadline', async () => {
  const {client}=fixture(c=>c.action==='scan'?{ok:true,status:'accepted',scan_id:1}:{ok:true,status:'ready',scan_id:1,total:0,truncated:false,networks:[],next:null});
  await client.connect();assert.deepEqual(await client.scan(),{networks:[],truncated:false});client.disconnect();
  const timed=fixture(c=>c.action==='scan'?{ok:true,status:'accepted',scan_id:1}:{ok:true,status:'pending',scan_id:1},undefined,{scanPollMs:2,scanTimeoutMs:8});
  await timed.client.connect();await assert.rejects(timed.client.scan(),/scan_timeout/);timed.client.disconnect();
});
test('disconnect while scan is pending stops subsequent polling', async () => {
  let polls=0, fixtureState;
  fixtureState=fixture(c=>{
    if(c.action==='scan')return {ok:true,status:'accepted',scan_id:1};
    polls++;queueMicrotask(()=>fixtureState.client.disconnect());
    return {ok:true,status:'pending',scan_id:1};
  },undefined,{scanPollMs:1});
  await fixtureState.client.connect();await assert.rejects(fixtureState.client.scan(),/disconnected/);assert.equal(polls,1);
});
